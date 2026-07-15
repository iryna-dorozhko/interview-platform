import { spawn as spawnChild } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import {
  assertNoConfiguredMcp,
  type CursorAcpConfig,
} from "./cursor-acp.config";
import {
  AcpProtocolError,
  NdjsonDecoder,
  methodNotFoundError,
  parseInitializeResult,
  parseJsonRpcMessage,
  parsePromptResult,
  parseSessionNewResult,
  parseSessionUpdate,
  rejectedPlanResult,
  selectPermissionRejection,
  skippedQuestionResult,
  type AcpInitializeResult,
  type AcpPermissionOption,
  type AcpSessionNewResult,
  type JsonRpcId,
  type JsonRpcMessage,
} from "./cursor-acp.protocol";

type ProcessState = "idle" | "starting" | "ready" | "stopping" | "closed";

export interface AcpChild {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  kill(signal: NodeJS.Signals): boolean;
}

export type SpawnAcp = (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    stdio: ["pipe", "pipe", "pipe"];
  },
) => AcpChild;

export type AcpClientErrorKind =
  | "closed"
  | "spawn"
  | "authentication"
  | "initialization"
  | "protocol"
  | "transport"
  | "timeout"
  | "cancelled";

export class AcpClientError extends Error {
  constructor(
    readonly kind: AcpClientErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AcpClientError";
  }
}

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer?: ReturnType<typeof setTimeout>;
  stopCollectingSessionId?: string;
};

type SessionState = {
  collecting: boolean;
  chunks: string[];
  cleanupPromise?: Promise<void>;
};

type ClientDependencies = {
  spawn?: SpawnAcp;
  prepareRuntime?: (config: CursorAcpConfig) => Promise<void>;
};

const defaultSpawn: SpawnAcp = (executable, args, options) =>
  spawnChild(executable, args, options) as AcpChild;

async function defaultPrepareRuntime(config: CursorAcpConfig): Promise<void> {
  await mkdir(config.cwd, { recursive: true, mode: 0o700 });
  await chmod(config.cwd, 0o700);
  await assertNoConfiguredMcp(config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class CursorAcpClient {
  private readonly spawn: SpawnAcp;
  private readonly prepareRuntime: (config: CursorAcpConfig) => Promise<void>;
  private state: ProcessState = "idle";
  private child: AcpChild | null = null;
  private childExited = false;
  private decoder: NdjsonDecoder | null = null;
  private initializeResult: AcpInitializeResult | null = null;
  private startPromise: Promise<void> | null = null;
  private recyclePromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private permanentlyClosed = false;
  private completedSessionCount = 0;
  private stderrTail = "";
  private nextRequestId = 0;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly sessions = new Map<string, SessionState>();

  private readonly onStdoutData = (chunk: Buffer): void => {
    try {
      const decoder = this.decoder;
      if (!decoder) throw new AcpProtocolError("ACP decoder is unavailable");
      for (const line of decoder.push(chunk)) {
        this.handleMessage(parseJsonRpcMessage(line));
      }
    } catch (error) {
      this.failTransport(error);
    }
  };

  private readonly onStdoutEnd = (): void => {
    try {
      this.decoder?.finish();
    } catch (error) {
      this.failTransport(error);
      return;
    }
    if (this.state !== "stopping" && this.state !== "closed") {
      this.failTransport(
        new AcpClientError("transport", "Cursor ACP stdout closed unexpectedly"),
      );
    }
  };

  private readonly onStderrData = (chunk: Buffer): void => {
    this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4_096);
  };

  private readonly onChildError = (error: Error): void => {
    this.failTransport(
      new AcpClientError("spawn", "Cursor ACP process error", { cause: error }),
    );
  };

  private readonly onChildExit = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    this.childExited = true;
    if (this.state === "stopping" || this.state === "closed") return;
    this.failTransport(
      new AcpClientError(
        "transport",
        `Cursor ACP process exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
      ),
      false,
    );
  };

  constructor(
    private readonly config: CursorAcpConfig,
    dependencies: ClientDependencies = {},
  ) {
    this.spawn = dependencies.spawn ?? defaultSpawn;
    this.prepareRuntime = dependencies.prepareRuntime ?? defaultPrepareRuntime;
  }

  async completePrompt(prompt: string): Promise<string> {
    await this.ensureReady();
    const created = parseSessionNewResult(
      await this.request("session/new", {
        cwd: this.config.cwd,
        mcpServers: [],
      }),
    );

    if (this.sessions.has(created.sessionId)) {
      throw new AcpClientError(
        "protocol",
        `Cursor ACP returned duplicate active sessionId: ${created.sessionId}`,
      );
    }
    this.sessions.set(created.sessionId, { collecting: false, chunks: [] });

    try {
      await this.confirmAskMode(created);
      const session = this.sessions.get(created.sessionId);
      if (!session) {
        throw new AcpClientError("transport", "Cursor ACP session was lost");
      }
      session.collecting = true;
      const result = parsePromptResult(
        await this.request("session/prompt", {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: prompt }],
        }, {
          timeoutMs: this.config.promptTimeoutMs,
          timeoutError: new AcpClientError(
            "timeout",
            `Cursor ACP prompt timed out after ${this.config.promptTimeoutMs}ms`,
          ),
          onTimeout: () => this.cleanupSession(created.sessionId, true),
          stopCollectingSessionId: created.sessionId,
        }),
      );
      session.collecting = false;
      if (result.stopReason === "cancelled") {
        throw new AcpClientError(
          "cancelled",
          "Cursor ACP prompt was cancelled",
        );
      }
      if (result.stopReason === "error") {
        throw new AcpClientError(
          "protocol",
          "Cursor ACP prompt terminated with error",
        );
      }
      return session.chunks.join("");
    } finally {
      await this.releaseSession(created.sessionId);
    }
  }

  close(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.permanentlyClosed = true;
    this.state = "stopping";
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async ensureReady(): Promise<void> {
    if (this.permanentlyClosed || this.state === "closed") {
      throw new AcpClientError("closed", "Cursor ACP provider is closed");
    }
    if (this.state === "stopping" && this.recyclePromise) {
      await this.recyclePromise;
      return this.ensureReady();
    }
    if (this.state === "stopping") {
      throw new AcpClientError("closed", "Cursor ACP provider is closed");
    }
    if (this.state === "ready") return;
    if (this.startPromise) return this.startPromise;

    this.state = "starting";
    const timeoutError = new AcpClientError(
      "timeout",
      `Cursor ACP startup timed out after ${this.config.startupTimeoutMs}ms`,
    );
    this.startPromise = this.withTimeout(
      this.start(),
      this.config.startupTimeoutMs,
      timeoutError,
      () => this.abortCurrentProcess(timeoutError),
    )
      .catch((error) => {
        this.failTransport(error);
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  private async start(): Promise<void> {
    await this.prepareRuntime(this.config);
    if (this.permanentlyClosed) {
      throw new AcpClientError("closed", "Cursor ACP provider is closed");
    }

    try {
      this.child = this.spawn(this.config.executable, ["acp"], {
        cwd: this.config.cwd,
        env: this.config.childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.childExited = false;
    } catch (error) {
      throw new AcpClientError(
        "spawn",
        "Failed to start Cursor ACP process",
        { cause: error },
      );
    }

    this.decoder = new NdjsonDecoder(this.config.maxLineBytes);
    this.stderrTail = "";
    this.attachChildListeners(this.child);

    const initialized = parseInitializeResult(
      await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
          terminal: false,
          session: {
            configOptions: {
              boolean: {},
            },
          },
        },
        clientInfo: {
          name: "interview-platform-backend",
          version: "0.1.0",
        },
      }),
    );

    if (initialized.protocolVersion !== 1) {
      throw new AcpClientError(
        "initialization",
        `Cursor ACP protocol version ${initialized.protocolVersion} is unsupported`,
      );
    }
    if (!initialized.authMethods?.some((method) => method.id === "cursor_login")) {
      throw new AcpClientError(
        "authentication",
        "Cursor ACP did not advertise cursor_login authentication",
      );
    }

    await this.request("authenticate", { methodId: "cursor_login" });
    this.initializeResult = initialized;
    this.state = "ready";
  }

  private attachChildListeners(child: AcpChild): void {
    child.stdout.on("data", this.onStdoutData);
    child.stdout.on("end", this.onStdoutEnd);
    child.stderr.on("data", this.onStderrData);
    child.on("error", this.onChildError);
    child.on("exit", this.onChildExit);
  }

  private detachChildListeners(child: AcpChild): void {
    child.stdout.off("data", this.onStdoutData);
    child.stdout.off("end", this.onStdoutEnd);
    child.stderr.off("data", this.onStderrData);
    child.off("error", this.onChildError);
    child.off("exit", this.onChildExit);
  }

  private request(
    method: string,
    params: unknown,
    timeout?: {
      timeoutMs: number;
      timeoutError: AcpClientError;
      onTimeout(): Promise<void> | void;
      stopCollectingSessionId?: string;
    },
  ): Promise<unknown> {
    const id = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject };
      pending.stopCollectingSessionId = timeout?.stopCollectingSessionId;
      if (timeout) {
        pending.timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          this.stopCollecting(pending);
          reject(timeout.timeoutError);
          void Promise.resolve(timeout.onTimeout()).catch((error) => {
            this.failTransport(error);
          });
        }, timeout.timeoutMs);
      }
      this.pending.set(id, pending);
      void this.write({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }).catch((error) => {
        const removed = this.pending.get(id);
        if (removed?.timer) clearTimeout(removed.timer);
        this.pending.delete(id);
        this.stopCollecting(pending);
        reject(error);
      });
    });
  }

  private write(message: unknown): Promise<void> {
    const child = this.child;
    if (!child || child.stdin.destroyed || child.stdin.writableEnded) {
      return Promise.reject(
        new AcpClientError("transport", "Cursor ACP stdin is unavailable"),
      );
    }

    return new Promise((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error?: Error | null) => {
        if (error) {
          reject(
            new AcpClientError("transport", "Failed to write Cursor ACP message", {
              cause: error,
            }),
          );
        } else {
          resolve();
        }
      });
    });
  }

  private handleMessage(message: JsonRpcMessage): void {
    if ("method" in message) {
      if ("id" in message) {
        this.handleAgentRequest(message.id, message.method, message.params);
      } else if (message.method === "session/update") {
        this.handleSessionUpdate(message.params);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    this.stopCollecting(pending);
    if (message.error) {
      const kind =
        message.error.code === -32000 &&
        /auth|login|credential|unauthori[sz]ed|token/i.test(message.error.message)
          ? "authentication"
          : "protocol";
      pending.reject(
        new AcpClientError(
          kind,
          `Cursor ACP request failed: ${message.error.message}`,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private stopCollecting(pending: PendingRequest): void {
    if (!pending.stopCollectingSessionId) return;
    const session = this.sessions.get(pending.stopCollectingSessionId);
    if (session) session.collecting = false;
  }

  private handleSessionUpdate(params: unknown): void {
    const { sessionId, update } = parseSessionUpdate(params);
    const session = this.sessions.get(sessionId);
    if (
      session?.collecting &&
      update.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text"
    ) {
      session.chunks.push(update.content.text ?? "");
    }
  }

  private handleAgentRequest(
    id: JsonRpcId,
    method: string,
    params: unknown,
  ): void {
    if (method === "session/request_permission") {
      const options = this.parsePermissionOptions(params);
      this.respond(id, selectPermissionRejection(options));
      return;
    }
    if (method === "cursor/ask_question") {
      this.respond(id, skippedQuestionResult);
      return;
    }
    if (method === "cursor/create_plan") {
      this.respond(id, rejectedPlanResult);
      return;
    }
    this.respondWithError(id, methodNotFoundError);
  }

  private parsePermissionOptions(params: unknown): AcpPermissionOption[] {
    if (!isRecord(params) || !Array.isArray(params.options)) {
      throw new AcpProtocolError("invalid session/request_permission params");
    }
    if (typeof params.sessionId !== "string" || !params.sessionId) {
      throw new AcpProtocolError("invalid session/request_permission params");
    }
    return params.options.map((value) => {
      if (
        !isRecord(value) ||
        typeof value.optionId !== "string" ||
        !value.optionId ||
        typeof value.kind !== "string" ||
        !value.kind
      ) {
        throw new AcpProtocolError("invalid session/request_permission params");
      }
      return {
        optionId: value.optionId,
        kind: value.kind,
        name: typeof value.name === "string" ? value.name : undefined,
      };
    });
  }

  private respond(id: JsonRpcId, result: unknown): void {
    void this.write({ jsonrpc: "2.0", id, result }).catch((error) => {
      this.failTransport(error);
    });
  }

  private respondWithError(id: JsonRpcId, error: unknown): void {
    void this.write({ jsonrpc: "2.0", id, error }).catch((writeError) => {
      this.failTransport(writeError);
    });
  }

  private async confirmAskMode(created: AcpSessionNewResult): Promise<void> {
    const modeOption = created.configOptions?.find(
      (option) => option.category === "mode",
    );
    if (
      modeOption?.options?.some((option) => option.value === "ask")
    ) {
      if (modeOption.currentValue === "ask") return;

      const result = await this.request("session/set_config_option", {
        sessionId: created.sessionId,
        configId: modeOption.id,
        value: "ask",
      });
      if (!this.configResultConfirmsAsk(result)) {
        throw new AcpClientError(
          "protocol",
          "Cursor ACP did not confirm ask mode",
        );
      }
      return;
    }

    const askMode = created.modes?.availableModes.find(
      (mode) => mode.id === "ask",
    );
    if (!askMode) {
      throw new AcpClientError(
        "protocol",
        "Cursor ACP session does not support ask mode",
      );
    }
    if (created.modes?.currentModeId === "ask") return;

    await this.request("session/set_mode", {
      sessionId: created.sessionId,
      modeId: askMode.id,
    });
  }

  private configResultConfirmsAsk(value: unknown): boolean {
    if (!isRecord(value) || !Array.isArray(value.configOptions)) return false;
    return value.configOptions.some(
      (option) =>
        isRecord(option) &&
        option.category === "mode" &&
        option.currentValue === "ask",
    );
  }

  private withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    timeoutError: AcpClientError,
    onTimeout: () => Promise<void> | void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(timeoutError);
        void Promise.resolve(onTimeout()).catch(() => undefined);
      }, timeoutMs);

      operation.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private abortCurrentProcess(error: Error): void {
    this.failTransport(error);
  }

  private supportsSessionClose(): boolean {
    const capabilities =
      this.initializeResult?.agentCapabilities.sessionCapabilities;
    return Boolean(capabilities && hasOwn(capabilities, "close"));
  }

  private async releaseSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.collecting = false;
    await this.cleanupSession(sessionId, false);
    this.completedSessionCount += 1;

    if (
      !this.supportsSessionClose() &&
      this.completedSessionCount >= this.config.maxSessions &&
      this.sessions.size === 0 &&
      !this.permanentlyClosed
    ) {
      await this.recycleProcess();
    }
  }

  private cleanupSession(
    sessionId: string,
    cancel: boolean,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.resolve();
    if (session.cleanupPromise) return session.cleanupPromise;

    session.collecting = false;
    session.cleanupPromise = (async () => {
      if (cancel) {
        await this.write({
          jsonrpc: "2.0",
          method: "session/cancel",
          params: { sessionId },
        });
      }
      if (this.supportsSessionClose()) {
        await this.request("session/close", { sessionId });
      }
    })().finally(() => {
      this.sessions.delete(sessionId);
    });
    return session.cleanupPromise;
  }

  private async recycleProcess(): Promise<void> {
    if (this.recyclePromise) return this.recyclePromise;
    this.state = "stopping";
    this.recyclePromise = this.stopChildWithFallback().finally(() => {
      this.clearProcessState();
      this.completedSessionCount = 0;
      this.state = this.permanentlyClosed ? "closed" : "idle";
      this.recyclePromise = null;
    });
    return this.recyclePromise;
  }

  private failTransport(error: unknown, terminateChild = true): void {
    const normalized =
      error instanceof Error
        ? error
        : new AcpClientError("transport", String(error));

    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(normalized);
    }
    this.pending.clear();
    this.sessions.clear();

    const child = this.child;
    if (child) {
      this.detachChildListeners(child);
      if (terminateChild && !this.childExited) {
        this.state = "stopping";
        const recovery = this.terminateDetachedChild(child).finally(() => {
          if (this.recyclePromise === recovery) {
            this.recyclePromise = null;
            this.state = this.permanentlyClosed ? "closed" : "idle";
          }
        });
        this.recyclePromise = recovery;
      }
    }
    this.child = null;
    this.childExited = false;
    this.decoder = null;
    this.initializeResult = null;
    this.stderrTail = "";
    this.completedSessionCount = 0;
    if (
      !this.recyclePromise &&
      this.state !== "stopping" &&
      this.state !== "closed"
    ) {
      this.state = "idle";
    }
  }

  private async performShutdown(): Promise<void> {
    if (this.recyclePromise) {
      await this.recyclePromise;
    }
    if (!this.child) {
      this.state = "closed";
      return;
    }

    const cleanup = Promise.allSettled(
      [...this.sessions.keys()].map((sessionId) =>
        this.cleanupSession(sessionId, true),
      ),
    );
    await this.waitWithin(cleanup, this.config.shutdownGraceMs);

    const closedError = new AcpClientError(
      "closed",
      "Cursor ACP provider is closed",
    );
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(closedError);
    }
    this.pending.clear();
    this.sessions.clear();

    await this.stopChildWithFallback();
    this.clearProcessState();
    this.state = "closed";
  }

  private async stopChildWithFallback(): Promise<void> {
    const child = this.child;
    if (!child) return;

    child.stdin.end();
    if (await this.waitForExit(child, this.config.shutdownGraceMs)) return;

    child.kill("SIGTERM");
    if (await this.waitForExit(child, this.config.terminateGraceMs)) return;

    child.kill("SIGKILL");
    await this.waitForExit(child, this.config.terminateGraceMs);
  }

  private waitForExit(child: AcpChild, timeoutMs: number): Promise<boolean> {
    if (this.child !== child || this.childExited) return Promise.resolve(true);

    return new Promise((resolve) => {
      const onExit = (): void => {
        clearTimeout(timer);
        child.off("exit", onExit);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      child.once("exit", onExit);
    });
  }

  private async terminateDetachedChild(child: AcpChild): Promise<void> {
    child.kill("SIGTERM");
    if (await this.waitForDetachedExit(child, this.config.terminateGraceMs)) {
      return;
    }
    child.kill("SIGKILL");
    await this.waitForDetachedExit(child, this.config.terminateGraceMs);
  }

  private waitForDetachedExit(
    child: AcpChild,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const onExit = (): void => {
        clearTimeout(timer);
        child.off("exit", onExit);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      child.once("exit", onExit);
    });
  }

  private waitWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      void operation.finally(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private clearProcessState(): void {
    const child = this.child;
    if (child) this.detachChildListeners(child);
    this.child = null;
    this.childExited = false;
    this.decoder = null;
    this.initializeResult = null;
    this.stderrTail = "";
  }
}

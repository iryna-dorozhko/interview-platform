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
};

type SessionState = {
  collecting: boolean;
  chunks: string[];
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
  private decoder: NdjsonDecoder | null = null;
  private initializeResult: AcpInitializeResult | null = null;
  private startPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
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

  private readonly onChildError = (error: Error): void => {
    this.failTransport(
      new AcpClientError("spawn", "Cursor ACP process error", { cause: error }),
    );
  };

  private readonly onChildExit = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    if (this.state === "stopping" || this.state === "closed") return;
    this.failTransport(
      new AcpClientError(
        "transport",
        `Cursor ACP process exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
      ),
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
        }),
      );
      session.collecting = false;
      if (result.stopReason === "cancelled") {
        throw new AcpClientError(
          "cancelled",
          "Cursor ACP prompt was cancelled",
        );
      }
      return session.chunks.join("");
    } finally {
      await this.releaseSession(created.sessionId);
    }
  }

  close(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.state = "stopping";
    this.shutdownPromise = this.closeCurrentProcess();
    return this.shutdownPromise;
  }

  private async ensureReady(): Promise<void> {
    if (this.state === "closed" || this.state === "stopping") {
      throw new AcpClientError("closed", "Cursor ACP provider is closed");
    }
    if (this.state === "ready") return;
    if (this.startPromise) return this.startPromise;

    this.state = "starting";
    this.startPromise = this.start()
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

    try {
      this.child = this.spawn(this.config.executable, ["acp"], {
        cwd: this.config.cwd,
        env: this.config.childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      throw new AcpClientError(
        "spawn",
        "Failed to start Cursor ACP process",
        { cause: error },
      );
    }

    this.decoder = new NdjsonDecoder(this.config.maxLineBytes);
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
    child.on("error", this.onChildError);
    child.on("exit", this.onChildExit);
  }

  private detachChildListeners(child: AcpChild): void {
    child.stdout.off("data", this.onStdoutData);
    child.stdout.off("end", this.onStdoutEnd);
    child.off("error", this.onChildError);
    child.off("exit", this.onChildExit);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void this.write({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }).catch((error) => {
        this.pending.delete(id);
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
    if (message.error) {
      const kind =
        message.error.code === -32000 ? "authentication" : "protocol";
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

  private supportsSessionClose(): boolean {
    const capabilities =
      this.initializeResult?.agentCapabilities.sessionCapabilities;
    return Boolean(capabilities && hasOwn(capabilities, "close"));
  }

  private async releaseSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.collecting = false;
    try {
      if (this.supportsSessionClose()) {
        await this.request("session/close", { sessionId });
      }
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  private failTransport(error: unknown): void {
    const normalized =
      error instanceof Error
        ? error
        : new AcpClientError("transport", String(error));

    for (const pending of this.pending.values()) {
      pending.reject(normalized);
    }
    this.pending.clear();
    this.sessions.clear();

    const child = this.child;
    if (child) this.detachChildListeners(child);
    this.child = null;
    this.decoder = null;
    this.initializeResult = null;
    if (this.state !== "stopping" && this.state !== "closed") {
      this.state = "idle";
    }
  }

  private async closeCurrentProcess(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.state = "closed";
      return;
    }

    for (const sessionId of this.sessions.keys()) {
      await this.write({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId },
      });
    }

    child.stdin.end();
    child.kill("SIGTERM");
    this.detachChildListeners(child);
    this.pending.clear();
    this.sessions.clear();
    this.child = null;
    this.decoder = null;
    this.initializeResult = null;
    this.state = "closed";
  }
}

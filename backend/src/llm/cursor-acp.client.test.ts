import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import readline from "node:readline";
import {
  CursorAcpClient,
  type AcpChild,
  type SpawnAcp,
} from "./cursor-acp.client";
import {
  readCursorAcpConfig,
  type CursorAcpConfig,
} from "./cursor-acp.config";

type JsonObject = Record<string, unknown>;

class FakeAcpProcess extends EventEmitter implements AcpChild {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly messages: JsonObject[] = [];
  readonly signals: NodeJS.Signals[] = [];

  constructor(
    private readonly onMessage: (
      message: JsonObject,
      process: FakeAcpProcess,
    ) => void,
  ) {
    super();
    readline.createInterface({ input: this.stdin }).on("line", (line) => {
      const message = JSON.parse(line) as JsonObject;
      this.messages.push(message);
      this.onMessage(message, this);
    });
  }

  send(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    queueMicrotask(() => this.emit("exit", 0, signal));
    return true;
  }
}

type HarnessOptions = {
  closeCapability?: boolean;
  legacyModes?: boolean;
  duplicateSessionId?: boolean;
  interleavePrompts?: boolean;
  onPrompt?: (process: FakeAcpProcess, request: JsonObject) => void;
};

function makeHarness(options: HarnessOptions = {}) {
  let spawnCount = 0;
  let nextSession = 0;
  const processes: FakeAcpProcess[] = [];
  const pendingPrompts: Array<{
    request: JsonObject;
    process: FakeAcpProcess;
  }> = [];

  const spawn: SpawnAcp = () => {
    spawnCount += 1;
    const process = new FakeAcpProcess((message, current) => {
      if (typeof message.method !== "string") return;
      const id = message.id as number;
      const params = (message.params ?? {}) as JsonObject;

      if (message.method === "initialize") {
        current.send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              sessionCapabilities: options.closeCapability ? { close: {} } : {},
            },
            authMethods: [{ id: "cursor_login", name: "Cursor Login" }],
          },
        });
        return;
      }
      if (message.method === "authenticate") {
        current.send({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (message.method === "session/new") {
        nextSession += 1;
        const sessionId = options.duplicateSessionId
          ? "duplicate"
          : `session-${nextSession}`;
        current.send({
          jsonrpc: "2.0",
          id,
          result: options.legacyModes
            ? {
                sessionId,
                modes: {
                  currentModeId: "agent",
                  availableModes: [
                    { id: "agent", name: "Agent" },
                    { id: "ask", name: "Ask" },
                  ],
                },
              }
            : {
                sessionId,
                configOptions: [
                  {
                    id: "mode",
                    name: "Mode",
                    category: "mode",
                    type: "select",
                    currentValue: "agent",
                    options: [
                      { value: "agent", name: "Agent" },
                      { value: "ask", name: "Ask" },
                    ],
                  },
                ],
              },
        });
        return;
      }
      if (message.method === "session/set_config_option") {
        current.send({
          jsonrpc: "2.0",
          id,
          result: {
            configOptions: [
              {
                id: "mode",
                name: "Mode",
                category: "mode",
                type: "select",
                currentValue: "ask",
                options: [{ value: "ask", name: "Ask" }],
              },
            ],
          },
        });
        return;
      }
      if (message.method === "session/set_mode") {
        current.send({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (message.method === "session/close") {
        current.send({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (message.method === "session/prompt") {
        if (options.onPrompt) {
          options.onPrompt(current, message);
          return;
        }
        if (options.interleavePrompts) {
          pendingPrompts.push({ process: current, request: message });
          if (pendingPrompts.length === 2) {
            const [first, second] = pendingPrompts;
            const firstSession = ((first.request.params as JsonObject)
              .sessionId) as string;
            const secondSession = ((second.request.params as JsonObject)
              .sessionId) as string;
            sendChunk(first.process, firstSession, "A1");
            sendChunk(second.process, secondSession, "B1");
            first.process.send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: firstSession,
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: { type: "text", text: "ignored thought" },
                },
              },
            });
            sendChunk(first.process, firstSession, "A2");
            second.process.send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: secondSession,
                update: { sessionUpdate: "tool_call", title: "ignored tool" },
              },
            });
            sendChunk(second.process, secondSession, "B2");
            first.process.send({
              jsonrpc: "2.0",
              id: first.request.id,
              result: { stopReason: "end_turn" },
            });
            second.process.send({
              jsonrpc: "2.0",
              id: second.request.id,
              result: { stopReason: "end_turn" },
            });
          }
          return;
        }

        const sessionId = params.sessionId as string;
        sendChunk(current, sessionId, sessionId.toUpperCase());
        current.send({
          jsonrpc: "2.0",
          id,
          result: { stopReason: "end_turn" },
        });
      }
    });
    processes.push(process);
    return process;
  };

  return {
    spawn,
    get spawnCount() {
      return spawnCount;
    },
    get process() {
      return processes.at(-1)!;
    },
    methods(method: string): JsonObject[] {
      return processes.flatMap((process) =>
        process.messages.filter((message) => message.method === method),
      );
    },
    responses(id: number): JsonObject[] {
      return processes.flatMap((process) =>
        process.messages.filter(
          (message) => message.id === id && typeof message.method !== "string",
        ),
      );
    },
  };
}

function sendChunk(
  process: FakeAcpProcess,
  sessionId: string,
  text: string,
): void {
  process.send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function makeConfig(
  overrides: Partial<CursorAcpConfig> = {},
): CursorAcpConfig {
  return {
    ...readCursorAcpConfig(
      {
        CURSOR_ACP_CWD: "/tmp/interview-platform-cursor-acp-test",
      },
      { tmpdir: () => "/tmp" },
    ),
    ...overrides,
  };
}

function makeClient(
  harness: ReturnType<typeof makeHarness>,
): CursorAcpClient {
  return new CursorAcpClient(makeConfig(), {
    spawn: harness.spawn,
    prepareRuntime: async () => undefined,
  });
}

test("multiple completions share one process initialization", async () => {
  const harness = makeHarness();
  const client = makeClient(harness);

  const [first, second] = await Promise.all([
    client.completePrompt("first"),
    client.completePrompt("second"),
  ]);

  assert.deepEqual([first, second], ["SESSION-1", "SESSION-2"]);
  assert.equal(harness.spawnCount, 1);
  assert.equal(harness.methods("initialize").length, 1);
  assert.equal(harness.methods("authenticate").length, 1);
  assert.deepEqual(harness.methods("authenticate")[0].params, {
    methodId: "cursor_login",
  });

  const capabilities = (
    harness.methods("initialize")[0].params as JsonObject
  ).clientCapabilities;
  assert.deepEqual(capabilities, {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    session: { configOptions: { boolean: {} } },
  });
  assert.deepEqual(harness.methods("session/new")[0].params, {
    cwd: "/tmp/interview-platform-cursor-acp-test",
    mcpServers: [],
  });
  await client.close();
});

test("parallel sessions route text chunks without mixing thought or tool updates", async () => {
  const harness = makeHarness({ interleavePrompts: true });
  const client = makeClient(harness);

  assert.deepEqual(
    await Promise.all([
      client.completePrompt("A"),
      client.completePrompt("B"),
    ]),
    ["A1A2", "B1B2"],
  );
  const sessionIds = harness
    .methods("session/prompt")
    .map((request) => (request.params as JsonObject).sessionId);
  assert.equal(new Set(sessionIds).size, 2);
  await client.close();
});

test("client prefers configOptions and falls back to legacy ask mode", async () => {
  const modern = makeHarness();
  const modernClient = makeClient(modern);
  await modernClient.completePrompt("modern");
  assert.equal(modern.methods("session/set_config_option").length, 1);
  assert.equal(modern.methods("session/set_mode").length, 0);
  await modernClient.close();

  const legacy = makeHarness({ legacyModes: true });
  const legacyClient = makeClient(legacy);
  await legacyClient.completePrompt("legacy");
  assert.equal(legacy.methods("session/set_config_option").length, 0);
  assert.deepEqual(legacy.methods("session/set_mode")[0].params, {
    sessionId: "session-1",
    modeId: "ask",
  });
  await legacyClient.close();
});

test("client rejects permissions and interactive requests with exact responses", async () => {
  const harness = makeHarness({
    onPrompt(process, request) {
      const sessionId = ((request.params as JsonObject).sessionId) as string;
      process.send({
        jsonrpc: "2.0",
        id: 101,
        method: "session/request_permission",
        params: {
          sessionId,
          options: [
            { optionId: "allow", kind: "allow_once", name: "Allow" },
            { optionId: "deny", kind: "reject_always", name: "Reject" },
          ],
        },
      });
      process.send({
        jsonrpc: "2.0",
        id: 102,
        method: "cursor/ask_question",
        params: { toolCallId: "ask" },
      });
      process.send({
        jsonrpc: "2.0",
        id: 103,
        method: "cursor/create_plan",
        params: { toolCallId: "plan" },
      });
      process.send({
        jsonrpc: "2.0",
        id: 104,
        method: "unknown/request",
        params: {},
      });
      sendChunk(process, sessionId, "done");
      process.send({
        jsonrpc: "2.0",
        id: request.id,
        result: { stopReason: "end_turn" },
      });
    },
  });
  const client = makeClient(harness);

  assert.equal(await client.completePrompt("permissions"), "done");
  assert.deepEqual(harness.responses(101)[0].result, {
    outcome: { outcome: "selected", optionId: "deny" },
  });
  assert.deepEqual(harness.responses(102)[0].result, {
    outcome: {
      outcome: "skipped",
      reason: "Non-interactive backend LLM client",
    },
  });
  assert.deepEqual(harness.responses(103)[0].result, {
    outcome: {
      outcome: "rejected",
      reason: "Non-interactive backend LLM client",
    },
  });
  assert.deepEqual(harness.responses(104)[0].error, {
    code: -32601,
    message: "Method not found",
  });
  await client.close();
});

test("normal completion closes only when capability is advertised", async () => {
  const supported = makeHarness({ closeCapability: true });
  const supportedClient = makeClient(supported);
  await supportedClient.completePrompt("A");
  assert.equal(supported.methods("session/close").length, 1);
  await supportedClient.close();

  const unsupported = makeHarness({ closeCapability: false });
  const unsupportedClient = makeClient(unsupported);
  await unsupportedClient.completePrompt("B");
  assert.equal(unsupported.methods("session/close").length, 0);
  await unsupportedClient.close();
});

test("client rejects duplicate active session IDs", async () => {
  const harness = makeHarness({
    duplicateSessionId: true,
  });
  const client = makeClient(harness);

  const results = await Promise.allSettled([
    client.completePrompt("A"),
    client.completePrompt("B"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  await client.close();
});

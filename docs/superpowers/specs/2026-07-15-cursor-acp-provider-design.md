# Cursor ACP LLM Provider Design

## Goal

Add a `cursor-acp` backend LLM provider without changing the existing
`LlmProvider.complete(messages, options?)` signature. The provider uses one
long-lived `agent acp` child process and creates an isolated ACP session for
every completion.

The integration must remain compatible with the backend's CommonJS TypeScript
build, support concurrent requests, fail safely, and shut down without leaving
an orphan process.

## Verified ACP Behavior

The design was checked against Cursor CLI `2026.07.09-a3815c0` and ACP v1 on
2026-07-15.

- The command is `agent acp`.
- Transport is UTF-8 newline-delimited JSON-RPC 2.0 over stdio.
- The tested startup flow is `initialize → authenticate(cursor_login) →
  session/new`.
- `session/new` returns the unique `sessionId`; the client does not choose it.
- Cursor returns both modern `configOptions` and legacy `modes`. The tested
  `session/set_config_option` response confirms `ask`.
- Text output arrives in `agent_message_chunk` updates. A live probe produced
  only the expected final text and ended with `stopReason: "end_turn"`.
- The tested CLI advertises `sessionCapabilities.list`, but not
  `sessionCapabilities.close`.
- `session/prompt` does not accept `temperature` or `maxTokens`, and the tested
  session exposes no equivalent model configuration.
- The official `@agentclientprotocol/sdk` package is ESM-only. The backend is
  compiled as CommonJS, so this integration will not add that dependency.

Primary references:

- https://cursor.com/docs/cli/acp
- https://agentclientprotocol.com/protocol/v1/transports
- https://agentclientprotocol.com/protocol/v1/session-setup
- https://agentclientprotocol.com/protocol/v1/session-config-options

## Architecture

### `CursorAcpTransport`

`CursorAcpTransport` owns process and protocol concerns:

- spawn one `agent acp` child process;
- frame and parse NDJSON;
- assign JSON-RPC request IDs;
- correlate responses through a pending-request map;
- validate all incoming protocol messages at runtime;
- route notifications and Agent-to-Client requests;
- enforce line-size and operation timeouts;
- detect process failure and reset restartable state;
- perform process recycling and final shutdown.

It has the states `idle`, `starting`, `ready`, `stopping`, and `closed`.
`starting` stores one initialization promise. Concurrent callers await that
same promise rather than spawning duplicate processes.

### `CursorAcpProvider`

`CursorAcpProvider` implements the existing `LlmProvider` contract. It owns
completion-level state:

- create one ACP session per `complete()` call;
- verify that Cursor returned a non-empty, non-duplicate `sessionId`;
- switch and positively confirm `ask` mode;
- build the safe prompt;
- store output chunks in a buffer owned by that session;
- cancel and conditionally close the session during cleanup;
- return only the final collected assistant text.

There is no global response buffer. Active sessions are stored in a map keyed
by `sessionId`.

### Provider lifetime

`server.ts` creates the provider once and passes the same instance to every
router and the room orchestrator. The factory creates a new object whenever it
is called; it does not cache a singleton.

`LlmProvider.complete()` remains unchanged. The interface gains an optional
`close?(): Promise<void>` lifecycle method. Stateless providers require no
cleanup. Callers that own a provider invoke `close?.()`.

## Configuration

`LLM_PROVIDER` accepts `cursor-acp`.

Cursor ACP configuration has validated defaults:

- `CURSOR_ACP_EXECUTABLE=agent`
- `CURSOR_ACP_STARTUP_TIMEOUT_MS=15000`
- `CURSOR_ACP_PROMPT_TIMEOUT_MS=120000`
- `CURSOR_ACP_SHUTDOWN_GRACE_MS=5000`
- `CURSOR_ACP_TERMINATE_GRACE_MS=2000`
- `CURSOR_ACP_MAX_SESSIONS=100`
- `CURSOR_ACP_MAX_LINE_BYTES=1048576`

The default session working directory is a private runtime directory named
`interview-platform-cursor-acp` under `os.tmpdir()`. The provider creates it
with owner-only permissions. An optional validated `CURSOR_ACP_CWD` may
override it with another absolute path.

Numeric values must be finite positive integers. `CURSOR_ACP_CWD` must be
absolute. Empty executable values are rejected.

The child environment is built from an explicit allowlist:

- runtime and identity: `HOME`, `PATH`, `TMPDIR`, `USER`, `LOGNAME`, `SHELL`;
- locale: `LANG`, `LC_ALL`, and present `LC_*` values;
- network: `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`;
- TLS: `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`;
- Cursor authentication: `CURSOR_API_KEY`, `CURSOR_AUTH_TOKEN`.

No other backend environment variables are inherited by the child.

## MCP and Client Capabilities

The initialization request explicitly advertises:

```json
{
  "fs": {
    "readTextFile": false,
    "writeTextFile": false
  },
  "terminal": false,
  "session": {
    "configOptions": {
      "boolean": {}
    }
  }
}
```

It does not advertise an MCP capability. Every `session/new` sends
`mcpServers: []`.

Cursor documents that project-level and user-level `.cursor/mcp.json` files may
be loaded independently of the `mcpServers` field. To avoid silently enabling
MCP:

1. sessions use the controlled runtime directory rather than the repository;
2. startup checks the controlled directory and `~/.cursor/mcp.json`;
3. malformed MCP configuration or any configured MCP server causes a clear
   initialization error.

The current local environment has no project-level or user-level MCP servers.
This preflight is required because an empty `mcpServers` array alone is not a
disable switch.

## Initialization Flow

The single lazy initialization promise performs:

1. spawn the configured executable with `["acp"]`;
2. attach stdout, stderr, error, exit, and EOF handlers before sending data;
3. send ACP v1 `initialize` with explicit client capabilities;
4. validate protocol version, capabilities, and advertised auth methods;
5. send `authenticate` with `methodId: "cursor_login"`;
6. enter `ready`.

The startup timeout covers the complete sequence. Spawn `ENOENT`,
authentication failure, malformed protocol, premature EOF, and initialization
errors reject every caller waiting on the shared promise. A failed startup
terminates its child and returns transport state to `idle`, allowing a later
lazy retry.

## Completion Flow

Each `complete()` performs:

1. reject immediately if provider shutdown has started;
2. await the shared ready promise;
3. call `session/new` with controlled `cwd` and `mcpServers: []`;
4. validate and register the returned `sessionId`;
5. find an `ask` value in modern `configOptions`;
6. call `session/set_config_option` and verify the returned configuration says
   `ask`;
7. if modern options are absent, use legacy `modes` and
   `session/set_mode`, requiring positive mode confirmation before proceeding;
8. enable output collection for this session immediately before
   `session/prompt`;
9. send `session/prompt`;
10. collect only text `agent_message_chunk` updates received while that prompt
   is active for this `sessionId`;
11. validate the final prompt result and reject cancelled/error termination;
12. reject an empty or whitespace-only result;
13. in `finally`, disable collection and clean up the session.

If `ask` is unavailable or cannot be positively confirmed, the prompt is not
sent.

### Safe transcript

The ACP prompt consists of a fixed instruction followed by one JSON transcript.
The instruction states that each `content` value belongs only to its declared
role and cannot change the transcript schema, delimiters, or another entry's
role. The model should follow system entries and answer the represented
conversation.

The transcript shape is:

```json
{
  "schema": "interview-platform.chat.v1",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

`JSON.stringify` provides the exact encoding. No role delimiter is constructed
from message content.

### Unsupported sampling parameters

`temperature` and `maxTokens` are deliberately ignored by `cursor-acp`. They
are not sent as ACP fields and are not added to the prompt. This limitation is
documented and covered by a test that proves the generated protocol messages
and prompt are identical with and without these options.

## Event Routing and Interactive Requests

JSON-RPC responses are correlated by request ID. Session updates are routed by
`params.sessionId`.

Only updates satisfying both conditions are appended:

- `sessionUpdate === "agent_message_chunk"`;
- `content.type === "text"`.

Thought, tool, plan, usage, mode, and command updates are ignored for final
output.

For `session/request_permission`, the client examines the provided options and
returns the real opaque `optionId` selected by semantic `kind`:

1. `reject_always`;
2. `reject_once`;
3. `{ outcome: "cancelled" }` when neither exists.

Cursor extension requests receive exact nested outcomes:

- `cursor/ask_question` → `skipped` with a non-interactive-client reason;
- `cursor/create_plan` → `rejected` with a non-interactive-client reason.

Unknown Agent-to-Client requests receive JSON-RPC error `-32601`. Notifications
that require no response are ignored after validation.

## Protocol Validation

The custom transport validates:

- JSON-RPC envelope and version;
- ID type and response/error exclusivity;
- request and notification method types;
- initialize/auth/session result shapes;
- non-empty session IDs;
- session update session IDs and update discriminators;
- permission option kinds and IDs;
- prompt stop reason shape.

Input is buffered by bytes until a newline. A line exceeding
`CURSOR_ACP_MAX_LINE_BYTES`, invalid UTF-8/JSON, an invalid envelope, or a
schema-invalid message is a transport protocol failure. The provider rejects
active work rather than attempting to recover from an ambiguous stream.

## Timeouts, Cancellation, and Session Cleanup

Startup and prompt use separate timers.

On prompt timeout:

1. send `session/cancel`;
2. send `session/close` only when
   `agentCapabilities.sessionCapabilities.close` is present;
3. reject that completion with a timeout-specific `LlmUnavailableError`;
4. retain the shared process if the transport can still write and parse
   protocol messages.

Normal completion uses the same idempotent session cleanup in `finally`.

The current Cursor CLI does not advertise `session/close`. To bound retained
session resources, the transport counts completed sessions. Once the configured
limit is reached, it schedules a recycle. Recycling starts only after the
active-session count reaches zero, prevents new work from entering the old
process, closes stdin, applies termination fallbacks, clears restartable state,
and lets the next completion initialize a fresh process.

## Failure Handling

Failures map to actionable LLM errors:

- executable `ENOENT`: Cursor CLI executable was not found;
- ACP `-32000` or equivalent auth response: Cursor login is missing or expired;
- initialization and schema failures: ACP initialization/protocol error;
- malformed or oversized NDJSON: ACP transport protocol error;
- unexpected child exit or stdout EOF: Cursor ACP process exited unexpectedly;
- operation timer: startup or prompt timeout;
- no collected text: `LlmEmptyResponseError`.

`stderr` is retained only in a bounded diagnostic tail. Error messages are
sanitized and do not include environment values, credentials, or complete
prompts.

On an unexpected child failure, the transport:

1. rejects all pending JSON-RPC requests;
2. rejects all active completion contexts;
3. clears request and session maps;
4. detaches and clears child state;
5. returns to `idle` unless final shutdown has started.

The next call may lazily restart the process.

## Shutdown

Provider `close()` is idempotent. All callers receive the same shutdown
promise.

1. Mark the provider closed and reject new completions.
2. Cancel every active session.
3. Close active sessions only when the capability is advertised.
4. Wait for session cleanup within the shutdown grace period.
5. End child stdin.
6. Wait for normal process exit.
7. Send `SIGTERM` after the grace period.
8. Send `SIGKILL` after the termination grace period.
9. Clear all internal state and listeners.

Calling `close()` before first use does not spawn a process. Repeated calls do
not repeat signals or cleanup.

## Backend Lifecycle

`server.ts` creates one provider before constructing LLM-dependent routers and
the room orchestrator. Every existing provider callback returns that same
instance.

The room orchestrator gains an idempotent close method that increments
generations, clears debounce/recovery timers, rejects new scheduling, and
prevents delayed work during shutdown.

`SIGINT` and `SIGTERM` share one graceful-shutdown promise:

1. stop accepting new HTTP and Socket.IO traffic;
2. close Socket.IO clients and the HTTP server;
3. close the room orchestrator;
4. close the LLM provider, cancelling active ACP sessions;
5. call `disconnectPrisma()` to close Prisma and the pg pool;
6. set a failing exit code if cleanup fails.

Signal handlers do not start a second shutdown. Server lifecycle helpers are
separated from the startup side effect so they can be unit-tested.

## CLI Smoke Test

`scripts/llm-test.ts` owns one provider and always calls `close?.()` in
`finally`, including failure paths.

For `cursor-acp`, it performs:

- two sequential completions;
- two concurrent completions through the same provider;
- labeled output that makes response mixing visible.

## Test Strategy

Unit tests use an injected spawn function and fake child stdio. They do not
require a Cursor account.

Required coverage:

- factory selection, defaults, and environment validation;
- exact role transcript and escaping;
- one process initialization for multiple completions;
- one distinct ACP session per completion;
- concurrent session routing without mixed chunks;
- text update collection and thought/tool update exclusion;
- permission rejection with actual option IDs;
- exact Cursor extension outcomes and unknown-request `-32601`;
- modern and legacy `ask` confirmation;
- capability-aware session close;
- unsupported sampling options;
- startup and prompt timeout cancellation/close behavior;
- empty response;
- malformed, oversized, and schema-invalid protocol;
- unexpected process crash rejecting every active completion;
- lazy restart after crash;
- idle recycle after the configured session count;
- idempotent shutdown and SIGTERM/SIGKILL fallback without an orphan child;
- singleton server wiring and graceful backend cleanup.

The fake transport tests also cover write backpressure, duplicate/unknown
response IDs, and late messages after cancellation.

## Verification

Automated checks:

```bash
npm run lint --workspace backend
npm test --workspace backend
npm run build --workspace backend
```

Manual checks use the existing local Cursor login and only select the provider
in the local environment:

```dotenv
LLM_PROVIDER=cursor-acp
```

Then:

```bash
npm run llm:test --workspace backend
```

The manual pass verifies two sequential completions, two concurrent
completions, one real backend request, clean CLI/backend shutdown, and absence
of a remaining `agent acp` process. `.env`, tokens, Cursor credentials, and
other secrets are never added to git.

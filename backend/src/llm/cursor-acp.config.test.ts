import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoConfiguredMcp,
  readCursorAcpConfig,
  type CursorAcpConfig,
} from "./cursor-acp.config";

type ReadFile = (path: string, encoding: "utf8") => Promise<string>;

function makeConfig(overrides: Partial<CursorAcpConfig> = {}): CursorAcpConfig {
  return {
    ...readCursorAcpConfig(
      {
        HOME: "/home/test",
        PATH: "/usr/bin",
      },
      { tmpdir: () => "/tmp" },
    ),
    ...overrides,
  };
}

function missingFile(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

test("readCursorAcpConfig returns safe defaults and an allowlisted child env", () => {
  const config = readCursorAcpConfig(
    {
      HOME: "/home/test",
      PATH: "/usr/bin",
      TMPDIR: "/private/tmp",
      USER: "tester",
      LOGNAME: "tester",
      SHELL: "/bin/zsh",
      LANG: "uk_UA.UTF-8",
      LC_CTYPE: "UTF-8",
      HTTPS_PROXY: "https://proxy.example",
      SSL_CERT_FILE: "/certs/ca.pem",
      CURSOR_AUTH_TOKEN: "cursor-token",
      DATABASE_URL: "secret-db",
      JWT_SECRET: "secret-jwt",
    },
    { tmpdir: () => "/tmp" },
  );

  assert.equal(config.executable, "agent");
  assert.equal(config.cwd, "/tmp/interview-platform-cursor-acp");
  assert.equal(config.startupTimeoutMs, 15_000);
  assert.equal(config.promptTimeoutMs, 120_000);
  assert.equal(config.shutdownGraceMs, 5_000);
  assert.equal(config.terminateGraceMs, 2_000);
  assert.equal(config.maxSessions, 100);
  assert.equal(config.maxLineBytes, 1_048_576);
  assert.deepEqual(config.childEnv, {
    HOME: "/home/test",
    PATH: "/usr/bin",
    TMPDIR: "/private/tmp",
    USER: "tester",
    LOGNAME: "tester",
    SHELL: "/bin/zsh",
    LANG: "uk_UA.UTF-8",
    LC_CTYPE: "UTF-8",
    HTTPS_PROXY: "https://proxy.example",
    SSL_CERT_FILE: "/certs/ca.pem",
    CURSOR_AUTH_TOKEN: "cursor-token",
  });
  assert.equal("DATABASE_URL" in config.childEnv, false);
  assert.equal("JWT_SECRET" in config.childEnv, false);
});

test("readCursorAcpConfig reads explicit executable, cwd, and numeric values", () => {
  const config = readCursorAcpConfig({
    CURSOR_ACP_EXECUTABLE: "/opt/cursor/agent",
    CURSOR_ACP_CWD: "/srv/cursor-acp",
    CURSOR_ACP_STARTUP_TIMEOUT_MS: "111",
    CURSOR_ACP_PROMPT_TIMEOUT_MS: "222",
    CURSOR_ACP_SHUTDOWN_GRACE_MS: "333",
    CURSOR_ACP_TERMINATE_GRACE_MS: "444",
    CURSOR_ACP_MAX_SESSIONS: "5",
    CURSOR_ACP_MAX_LINE_BYTES: "666",
  });

  assert.equal(config.executable, "/opt/cursor/agent");
  assert.equal(config.cwd, "/srv/cursor-acp");
  assert.equal(config.startupTimeoutMs, 111);
  assert.equal(config.promptTimeoutMs, 222);
  assert.equal(config.shutdownGraceMs, 333);
  assert.equal(config.terminateGraceMs, 444);
  assert.equal(config.maxSessions, 5);
  assert.equal(config.maxLineBytes, 666);
});

test("readCursorAcpConfig rejects invalid numeric values", () => {
  const cases = [
    ["CURSOR_ACP_STARTUP_TIMEOUT_MS", "0"],
    ["CURSOR_ACP_PROMPT_TIMEOUT_MS", "-1"],
    ["CURSOR_ACP_SHUTDOWN_GRACE_MS", "1.5"],
    ["CURSOR_ACP_TERMINATE_GRACE_MS", "NaN"],
    ["CURSOR_ACP_MAX_SESSIONS", "Infinity"],
    ["CURSOR_ACP_MAX_LINE_BYTES", ""],
  ] as const;

  for (const [name, value] of cases) {
    assert.throws(
      () => readCursorAcpConfig({ [name]: value }),
      new RegExp(`${name} must be a positive integer`),
    );
  }
});

test("readCursorAcpConfig rejects empty executable and relative cwd", () => {
  assert.throws(
    () => readCursorAcpConfig({ CURSOR_ACP_EXECUTABLE: "  " }),
    /CURSOR_ACP_EXECUTABLE must not be empty/,
  );
  assert.throws(
    () => readCursorAcpConfig({ CURSOR_ACP_CWD: "relative/path" }),
    /CURSOR_ACP_CWD must be absolute/,
  );
});

test("assertNoConfiguredMcp ignores missing and empty MCP config files", async () => {
  const emptyUserConfig = async (path: string): Promise<string> => {
    if (path === "/home/test/.cursor/mcp.json") {
      return JSON.stringify({ mcpServers: {} });
    }
    throw missingFile();
  };

  await assert.doesNotReject(
    assertNoConfiguredMcp(makeConfig(), {
      readFile: emptyUserConfig as ReadFile,
    }),
  );
});

test("assertNoConfiguredMcp rejects configured project or user MCP servers", async () => {
  for (const configuredPath of [
    "/tmp/interview-platform-cursor-acp/.cursor/mcp.json",
    "/home/test/.cursor/mcp.json",
  ]) {
    const readFile = async (path: string): Promise<string> => {
      if (path === configuredPath) {
        return JSON.stringify({
          mcpServers: { github: { command: "server" } },
        });
      }
      throw missingFile();
    };

    await assert.rejects(
      assertNoConfiguredMcp(makeConfig(), {
        readFile: readFile as ReadFile,
      }),
      /MCP servers are configured/,
    );
  }
});

test("assertNoConfiguredMcp rejects malformed or invalid MCP config", async () => {
  const invalidContents = [
    "{",
    JSON.stringify({ mcpServers: [] }),
    JSON.stringify({ mcpServers: null }),
  ];

  for (const content of invalidContents) {
    await assert.rejects(
      assertNoConfiguredMcp(makeConfig(), {
        readFile: (async () => content) as ReadFile,
      }),
      /invalid MCP configuration/,
    );
  }
});

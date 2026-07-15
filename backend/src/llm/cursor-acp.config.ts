import { readFile as defaultReadFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type EnvSource = Record<string, string | undefined>;

type FileReader = {
  readFile(path: string, encoding: "utf8"): Promise<string>;
};

export interface CursorAcpConfig {
  executable: string;
  cwd: string;
  startupTimeoutMs: number;
  promptTimeoutMs: number;
  shutdownGraceMs: number;
  terminateGraceMs: number;
  maxSessions: number;
  maxLineBytes: number;
  childEnv: Record<string, string>;
}

const CHILD_ENV_NAMES = [
  "HOME",
  "PATH",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "CURSOR_API_KEY",
  "CURSOR_AUTH_TOKEN",
] as const;

function readPositiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function buildChildEnv(env: EnvSource): Record<string, string> {
  const childEnv: Record<string, string> = {};

  for (const name of CHILD_ENV_NAMES) {
    const value = env[name];
    if (value !== undefined) childEnv[name] = value;
  }

  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("LC_") && value !== undefined) {
      childEnv[name] = value;
    }
  }

  return childEnv;
}

export function readCursorAcpConfig(
  env: EnvSource = process.env,
  runtime: { tmpdir(): string } = { tmpdir: os.tmpdir },
): CursorAcpConfig {
  const executableRaw = env.CURSOR_ACP_EXECUTABLE;
  const executable = executableRaw === undefined ? "agent" : executableRaw.trim();
  if (!executable) {
    throw new Error("CURSOR_ACP_EXECUTABLE must not be empty");
  }

  const cwd =
    env.CURSOR_ACP_CWD ??
    path.join(runtime.tmpdir(), "interview-platform-cursor-acp");
  if (!path.isAbsolute(cwd)) {
    throw new Error("CURSOR_ACP_CWD must be absolute");
  }

  return {
    executable,
    cwd,
    startupTimeoutMs: readPositiveInteger(
      "CURSOR_ACP_STARTUP_TIMEOUT_MS",
      env.CURSOR_ACP_STARTUP_TIMEOUT_MS,
      15_000,
    ),
    promptTimeoutMs: readPositiveInteger(
      "CURSOR_ACP_PROMPT_TIMEOUT_MS",
      env.CURSOR_ACP_PROMPT_TIMEOUT_MS,
      120_000,
    ),
    shutdownGraceMs: readPositiveInteger(
      "CURSOR_ACP_SHUTDOWN_GRACE_MS",
      env.CURSOR_ACP_SHUTDOWN_GRACE_MS,
      5_000,
    ),
    terminateGraceMs: readPositiveInteger(
      "CURSOR_ACP_TERMINATE_GRACE_MS",
      env.CURSOR_ACP_TERMINATE_GRACE_MS,
      2_000,
    ),
    maxSessions: readPositiveInteger(
      "CURSOR_ACP_MAX_SESSIONS",
      env.CURSOR_ACP_MAX_SESSIONS,
      100,
    ),
    maxLineBytes: readPositiveInteger(
      "CURSOR_ACP_MAX_LINE_BYTES",
      env.CURSOR_ACP_MAX_LINE_BYTES,
      1_048_576,
    ),
    childEnv: buildChildEnv(env),
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function parseMcpServers(content: string, configPath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`invalid MCP configuration at ${configPath}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid MCP configuration at ${configPath}`);
  }

  const mcpServers = (parsed as Record<string, unknown>).mcpServers;
  if (
    mcpServers === undefined ||
    (typeof mcpServers === "object" &&
      mcpServers !== null &&
      !Array.isArray(mcpServers))
  ) {
    return (mcpServers ?? {}) as Record<string, unknown>;
  }

  throw new Error(`invalid MCP configuration at ${configPath}`);
}

export async function assertNoConfiguredMcp(
  config: CursorAcpConfig,
  io: FileReader = { readFile: defaultReadFile },
): Promise<void> {
  const configPaths = [
    path.join(config.cwd, ".cursor", "mcp.json"),
    config.childEnv.HOME
      ? path.join(config.childEnv.HOME, ".cursor", "mcp.json")
      : null,
  ];

  for (const configPath of configPaths) {
    if (!configPath) continue;

    let content: string;
    try {
      content = await io.readFile(configPath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }

    if (Object.keys(parseMcpServers(content, configPath)).length > 0) {
      throw new Error(`MCP servers are configured in ${configPath}`);
    }
  }
}

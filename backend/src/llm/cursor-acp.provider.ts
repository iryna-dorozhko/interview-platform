import {
  AcpClientError,
  CursorAcpClient,
} from "./cursor-acp.client";
import type { CursorAcpConfig } from "./cursor-acp.config";
import { buildCursorAcpPrompt } from "./cursor-acp.protocol";
import {
  LlmEmptyResponseError,
  LlmError,
  LlmUnavailableError,
} from "./errors";
import type { LlmProvider } from "./types";

export interface CursorAcpClientLike {
  completePrompt(prompt: string): Promise<string>;
  close(): Promise<void>;
}

type CursorAcpProviderDependencies = {
  client?: CursorAcpClientLike;
};

function hasErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function mapCursorAcpError(error: unknown): LlmUnavailableError {
  if (hasErrorCode(error, "ENOENT")) {
    return new LlmUnavailableError(
      "Cursor CLI executable was not found. Install Cursor CLI and ensure `agent` is available in PATH.",
    );
  }

  if (error instanceof AcpClientError) {
    if (error.kind === "authentication") {
      return new LlmUnavailableError(
        "Cursor authentication is missing or expired. Run `agent login` and try again.",
      );
    }
    if (error.kind === "initialization") {
      return new LlmUnavailableError(
        `Cursor ACP initialization failed: ${error.message}`,
      );
    }
    if (error.kind === "protocol") {
      return new LlmUnavailableError(
        `Cursor ACP protocol error: ${error.message}`,
      );
    }
    if (error.kind === "cancelled") {
      return new LlmUnavailableError("Cursor ACP prompt was cancelled");
    }
    if (error.kind === "closed") {
      return new LlmUnavailableError("Cursor ACP provider is closed");
    }
    return new LlmUnavailableError(
      `Cursor ACP is unavailable: ${error.message}`,
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new LlmUnavailableError(`Cursor ACP is unavailable: ${detail}`);
}

export function createCursorAcpProvider(
  config: CursorAcpConfig,
  dependencies: CursorAcpProviderDependencies = {},
): LlmProvider {
  const client = dependencies.client ?? new CursorAcpClient(config);

  return {
    name: "cursor-acp",
    async complete(messages) {
      try {
        const text = await client.completePrompt(buildCursorAcpPrompt(messages));
        if (!text.trim()) throw new LlmEmptyResponseError();
        return text;
      } catch (error) {
        if (error instanceof LlmError) throw error;
        throw mapCursorAcpError(error);
      }
    },
    close: () => client.close(),
  };
}

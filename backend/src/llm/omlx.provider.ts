import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import type { ChatMessage, LlmProvider } from "./types";

const REQUEST_TIMEOUT_MS = 120_000;

type OmlxConfig = {
  baseUrl: string;
  model: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export function createOmlxProvider(config: OmlxConfig): LlmProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  return {
    name: "omlx",

    async complete(messages: ChatMessage[]): Promise<string> {
      const url = `${baseUrl}/v1/chat/completions`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: false,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const causeCode =
          typeof error === "object" &&
          error !== null &&
          "cause" in error &&
          typeof (error as { cause?: { code?: string } }).cause?.code === "string"
            ? (error as { cause: { code: string } }).cause.code
            : undefined;

        if (causeCode === "ECONNREFUSED" || detail.includes("ECONNREFUSED")) {
          throw new LlmUnavailableError(
            `omlx server not reachable at ${baseUrl}`
          );
        }

        if (error instanceof Error && error.name === "TimeoutError") {
          throw new LlmUnavailableError("LLM request timed out");
        }

        throw new LlmUnavailableError(detail);
      }

      if (!response.ok) {
        const body = await response.text();
        throw new LlmUnavailableError(
          `omlx request failed (${response.status}): ${body}`
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new LlmEmptyResponseError();
      }

      return content;
    },
  };
}

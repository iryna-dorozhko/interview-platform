import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import type { ChatMessage, LlmCompleteOptions, LlmProvider } from "./types";

const REQUEST_TIMEOUT_MS = 120_000;

type OpenAiConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export function createOpenAiProvider(config: OpenAiConfig): LlmProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  return {
    name: "openai",

    async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
      const url = `${baseUrl}/chat/completions`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: false,
            ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        if (error instanceof Error && error.name === "TimeoutError") {
          throw new LlmUnavailableError("LLM request timed out");
        }

        throw new LlmUnavailableError(detail);
      }

      if (!response.ok) {
        const body = await response.text();
        throw new LlmUnavailableError(
          `openai request failed (${response.status}): ${body}`
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

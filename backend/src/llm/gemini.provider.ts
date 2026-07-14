import { GoogleGenerativeAI } from "@google/generative-ai";
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import type { ChatMessage, LlmCompleteOptions, LlmProvider } from "./types";

type GeminiConfig = {
  apiKey: string;
  model: string;
};

const HISTORY_START_PLACEHOLDER = "(start)";
const HISTORY_CONTINUE_PLACEHOLDER = "(continue)";
const MAX_RATE_LIMIT_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT_DELAY_MS = 10_000;
const MAX_RATE_LIMIT_DELAY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isGeminiRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Requests") || /quota exceeded/i.test(msg);
}

export function parseGeminiRetryDelayMs(error: unknown): number {
  const msg = error instanceof Error ? error.message : String(error);
  const match = msg.match(/Please retry in (\d+(?:\.\d+)?)s/i);
  if (match) {
    return Math.min(Math.ceil(parseFloat(match[1]) * 1000) + 500, MAX_RATE_LIMIT_DELAY_MS);
  }
  return DEFAULT_RATE_LIMIT_DELAY_MS;
}

type GeminiTurn = { role: "user" | "model"; parts: [{ text: string }] };

/** Gemini sendMessage requires a user turn; use a placeholder when history ends with assistant. */
export function resolveGeminiPrompt(chatMessages: ChatMessage[]): {
  historyMessages: ChatMessage[];
  promptContent: string;
} {
  const lastMessage = chatMessages[chatMessages.length - 1];
  if (lastMessage.role === "user") {
    return {
      historyMessages: chatMessages.slice(0, -1),
      promptContent: lastMessage.content,
    };
  }

  return {
    historyMessages: chatMessages,
    promptContent: HISTORY_CONTINUE_PLACEHOLDER,
  };
}

/**
 * Gemini requires chat history passed to startChat() to begin with a "user"
 * turn. Our agents can legitimately speak first (e.g. greeting before any
 * user message exists), which would otherwise start the history with
 * "model" — prepend a synthetic user turn so the request is well-formed.
 */
export function buildGeminiHistory(chatMessagesExcludingLast: ChatMessage[]): GeminiTurn[] {
  const historyTurns: GeminiTurn[] = chatMessagesExcludingLast.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  if (historyTurns.length > 0 && historyTurns[0].role === "model") {
    return [{ role: "user", parts: [{ text: HISTORY_START_PLACEHOLDER }] }, ...historyTurns];
  }

  return historyTurns;
}

export function createGeminiProvider(config: GeminiConfig): LlmProvider {
  return {
    name: "gemini",

    async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
      if (messages.length === 0) {
        throw new Error("at least one message required");
      }

      const systemInstruction = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n");

      const chatMessages = messages.filter((message) => message.role !== "system");

      if (chatMessages.length === 0) {
        throw new Error("at least one user or assistant message required");
      }

      const { historyMessages, promptContent } = resolveGeminiPrompt(chatMessages);

      const genAI = new GoogleGenerativeAI(config.apiKey);
      const model = genAI.getGenerativeModel({
        model: config.model,
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(options?.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      });

      const history = buildGeminiHistory(historyMessages);

      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_RATE_LIMIT_ATTEMPTS; attempt++) {
        try {
          const chat = model.startChat({ history });
          const result = await chat.sendMessage(promptContent);
          const text = result.response.text().trim();

          if (!text) {
            throw new LlmEmptyResponseError();
          }

          return text;
        } catch (error) {
          lastError = error;
          const canRetry =
            isGeminiRateLimitError(error) && attempt < MAX_RATE_LIMIT_ATTEMPTS - 1;
          if (!canRetry) break;
          const retryDelayMs = parseGeminiRetryDelayMs(error);
          await sleep(retryDelayMs);
        }
      }

      if (isGeminiRateLimitError(lastError)) {
        throw new LlmUnavailableError(
          "Gemini API: перевищено ліміт запитів. Змініть LLM_PROVIDER у .env або зачекайте.",
        );
      }

      throw lastError;
    },
  };
}

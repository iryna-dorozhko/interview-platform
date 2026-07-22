import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import { isGeminiRateLimitError, parseGeminiRetryDelayMs } from "./gemini.provider";

export const SAFE_LLM_ERROR_UK =
  "AI тимчасово не відповів. Можна спробувати ще раз.";

const DEFAULT_MAX_ATTEMPTS = 3;

export type WithLlmRetryOptions = {
  label?: string;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof LlmUnavailableError) return true;
  if (error instanceof LlmEmptyResponseError) return true;
  if (isGeminiRateLimitError(error)) return true;
  if (error instanceof Error) {
    if (error.name.endsWith("ContextError")) return false;
    if (error.name.endsWith("ReplyParseError")) return true;
    if (error.name.endsWith("ExtractionError")) return true;
  }
  return false;
}

export function toSafeLlmErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("перевищено ліміт")) {
    return error.message;
  }
  return SAFE_LLM_ERROR_UK;
}

function backoffMs(attemptIndex: number, error: unknown): number {
  if (isGeminiRateLimitError(error)) {
    return parseGeminiRetryDelayMs(error);
  }
  return Math.min(500 * 2 ** attemptIndex, 8_000);
}

export async function withLlmRetry<T>(
  fn: () => Promise<T>,
  options: WithLlmRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const label = options.label ?? "llm";
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableLlmError(error);
      const hasMore = attempt < maxAttempts - 1;
      if (!retryable || !hasMore) break;

      const delay = backoffMs(attempt, error);
      console.warn(
        `[llm-retry:${label}] attempt ${attempt + 1}/${maxAttempts} failed:`,
        error instanceof Error ? error.message : error,
        `— retry in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  if (isGeminiRateLimitError(lastError)) {
    throw new LlmUnavailableError(
      "Gemini API: перевищено ліміт запитів. Змініть LLM_PROVIDER у .env або зачекайте.",
    );
  }

  console.error(
    `[llm-retry:${label}] exhausted:`,
    lastError instanceof Error ? lastError.message : lastError,
  );
  throw lastError;
}

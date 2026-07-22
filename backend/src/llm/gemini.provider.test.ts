import test from "node:test";
import assert from "node:assert/strict";
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import {
  buildGeminiHistory,
  isGeminiRateLimitError,
  mapGeminiCompleteError,
  parseGeminiRetryDelayMs,
  resolveGeminiPrompt,
} from "./gemini.provider";
import { isRetryableLlmError } from "./retry";

test("buildGeminiHistory prepends synthetic user turn when history starts with agent message", () => {
  const history = buildGeminiHistory([
    { role: "assistant", content: "Вітаю! Розкажіть про вакансію." },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].role, "user");
  assert.equal(history[1].role, "model");
  assert.equal(history[1].parts[0].text, "Вітаю! Розкажіть про вакансію.");
});

test("buildGeminiHistory leaves history untouched when it already starts with user", () => {
  const history = buildGeminiHistory([
    { role: "user", content: "Привіт" },
    { role: "assistant", content: "Привіт! Як можу допомогти?" },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].role, "user");
  assert.equal(history[0].parts[0].text, "Привіт");
  assert.equal(history[1].role, "model");
});

test("buildGeminiHistory returns empty array for empty input", () => {
  const history = buildGeminiHistory([]);
  assert.deepEqual(history, []);
});

test("resolveGeminiPrompt uses last user message as prompt when history ends with user", () => {
  const resolved = resolveGeminiPrompt([
    { role: "user", content: "Привіт" },
    { role: "assistant", content: "Вітаю!" },
    { role: "user", content: "Почнемо?" },
  ]);

  assert.equal(resolved.promptContent, "Почнемо?");
  assert.deepEqual(resolved.historyMessages, [
    { role: "user", content: "Привіт" },
    { role: "assistant", content: "Вітаю!" },
  ]);
});

test("resolveGeminiPrompt uses continue placeholder when history ends with assistant", () => {
  const resolved = resolveGeminiPrompt([
    { role: "user", content: "Привіт" },
    { role: "assistant", content: "Давайте почнемо співбесіду." },
  ]);

  assert.equal(resolved.promptContent, "(continue)");
  assert.deepEqual(resolved.historyMessages, [
    { role: "user", content: "Привіт" },
    { role: "assistant", content: "Давайте почнемо співбесіду." },
  ]);
});

test("parseGeminiRetryDelayMs reads retry hint from 429 error", () => {
  const delay = parseGeminiRetryDelayMs(
    new Error("[429 Too Many Requests] Please retry in 9.743665662s"),
  );
  assert.equal(delay, 10_244);
});

test("isGeminiRateLimitError detects quota errors", () => {
  assert.equal(isGeminiRateLimitError(new Error("[429 Too Many Requests] quota exceeded")), true);
  assert.equal(isGeminiRateLimitError(new Error("network timeout")), false);
});

test("mapGeminiCompleteError wraps non-429 failures as retryable LlmUnavailableError", () => {
  const wrapped = mapGeminiCompleteError(new Error("fetch failed"));
  assert.ok(wrapped instanceof LlmUnavailableError);
  assert.equal(isRetryableLlmError(wrapped), true);
  assert.match(wrapped.message, /fetch failed/);
});

test("mapGeminiCompleteError keeps rate-limit and empty errors as-is", () => {
  const rateLimit = new Error("[429 Too Many Requests] Please retry in 1.0s");
  assert.equal(mapGeminiCompleteError(rateLimit), rateLimit);
  assert.equal(isGeminiRateLimitError(mapGeminiCompleteError(rateLimit)), true);

  const empty = new LlmEmptyResponseError();
  assert.equal(mapGeminiCompleteError(empty), empty);
});

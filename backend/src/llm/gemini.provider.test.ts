import test from "node:test";
import assert from "node:assert/strict";
import { buildGeminiHistory, isGeminiRateLimitError, parseGeminiRetryDelayMs, resolveGeminiPrompt } from "./gemini.provider";

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

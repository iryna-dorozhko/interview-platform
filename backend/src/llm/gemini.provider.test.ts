import test from "node:test";
import assert from "node:assert/strict";
import { buildGeminiHistory } from "./gemini.provider";

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

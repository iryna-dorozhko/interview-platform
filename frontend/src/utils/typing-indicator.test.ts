import assert from "node:assert/strict";
import { test } from "node:test";
import { createTypingEmitter, typingLabelFor } from "./typing-indicator";

test("typingLabelFor maps roles", () => {
  assert.equal(typingLabelFor("CANDIDATE"), "Кандидат друкує");
  assert.equal(typingLabelFor("HR"), "Рекрутер друкує");
});

test("createTypingEmitter emits true then idle false", async () => {
  const calls: boolean[] = [];
  const emitter = createTypingEmitter({
    emit: (v) => calls.push(v),
    throttleMs: 50,
    idleMs: 80,
  });
  emitter.onInput("a");
  assert.deepEqual(calls, [true]);
  emitter.onInput("ab");
  assert.deepEqual(calls, [true]); // throttled — no second true yet
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(calls, [true, false]);
  emitter.dispose();
});

test("createTypingEmitter onSend clears immediately", () => {
  const calls: boolean[] = [];
  const emitter = createTypingEmitter({
    emit: (v) => calls.push(v),
    throttleMs: 50,
    idleMs: 5000,
  });
  emitter.onInput("hi");
  emitter.onSend();
  assert.deepEqual(calls, [true, false]);
  emitter.dispose();
});

test("createTypingEmitter empty text emits false if was typing", () => {
  const calls: boolean[] = [];
  const emitter = createTypingEmitter({
    emit: (v) => calls.push(v),
    throttleMs: 50,
    idleMs: 5000,
  });
  emitter.onInput("x");
  emitter.onInput("");
  assert.deepEqual(calls, [true, false]);
  emitter.dispose();
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentReply } from "./agent-reply";

test("parseAgentReply extracts READY:true marker and strips it from message", () => {
  const raw = "Дякую! Це все, що потрібно.\nREADY:true";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую! Це все, що потрібно.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply extracts READY:false marker and strips it from message", () => {
  const raw = "Розкажіть більше про вимоги до кандидата.\nREADY:false";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Розкажіть більше про вимоги до кандидата.");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply falls back to readyForConfirmation=false when marker is missing", () => {
  const raw = "Яка це посада?";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Яка це посада?");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply is case-insensitive and tolerates trailing whitespace", () => {
  const raw = "Дякую.\nready:TRUE  \n";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply handles marker with no preceding newline", () => {
  const raw = "Питання?READY:false";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Питання?");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply handles marker wrapped in square brackets with no preceding newline", () => {
  const raw = "Добрий день! Розкажіть про вакансію. [READY:false]";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Добрий день! Розкажіть про вакансію.");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply handles marker wrapped in square brackets after newline, readyForConfirmation=true", () => {
  const raw = "Дякую, цього достатньо.\n[READY:true]";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую, цього достатньо.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply handles marker wrapped in parentheses", () => {
  const raw = "Ще одне питання. (READY:false)";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Ще одне питання.");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply handles bracketed marker followed by trailing period", () => {
  const raw = "Дякую за відповідь. [READY:true].";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую за відповідь.");
  assert.equal(result.readyForConfirmation, true);
});

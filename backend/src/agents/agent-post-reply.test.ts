import test from "node:test";
import assert from "node:assert/strict";
import { AgentPostReplyParseError, parsePostReply } from "./agent-post-reply";

test("parsePostReply parses post:false", () => {
  const result = parsePostReply('{ "post": false }');
  assert.equal(result.post, false);
  assert.equal(result.message, undefined);
});

test("parsePostReply parses post:true with message", () => {
  const result = parsePostReply('{ "post": true, "message": "Питання про досвід?" }');
  assert.equal(result.post, true);
  assert.equal(result.message, "Питання про досвід?");
});

test("parsePostReply strips markdown code fences", () => {
  const raw = "```json\n{ \"post\": false }\n```";
  const result = parsePostReply(raw);
  assert.equal(result.post, false);
});

test("parsePostReply throws on invalid JSON", () => {
  assert.throws(() => parsePostReply("not json"), AgentPostReplyParseError);
});

test("parsePostReply throws when post:true but message is empty", () => {
  assert.throws(
    () => parsePostReply('{ "post": true, "message": "   " }'),
    AgentPostReplyParseError,
  );
});

test("parsePostReply throws when post field is missing", () => {
  assert.throws(() => parsePostReply('{ "message": "hi" }'), AgentPostReplyParseError);
});

test("parsePostReply parses needsHuman:true with message", () => {
  const result = parsePostReply(
    '{ "post": true, "message": "У профілі немає відповіді. Ірино, дай відповідь.", "needsHuman": true }',
  );
  assert.equal(result.post, true);
  assert.equal(result.needsHuman, true);
  assert.match(result.message ?? "", /Ірино/);
});

test("parsePostReply defaults needsHuman to false when omitted", () => {
  const result = parsePostReply('{ "post": true, "message": "Я працював з Node.js." }');
  assert.equal(result.needsHuman, false);
});

test("parsePostReply accepts kind clarifying", () => {
  const result = parsePostReply(
    '{ "post": true, "message": "Уточніть стек?", "kind": "clarifying" }',
  );
  assert.equal(result.kind, "clarifying");
});

test("parsePostReply defaults kind to normal when omitted", () => {
  const result = parsePostReply('{ "post": true, "message": "Привіт" }');
  assert.equal(result.kind, "normal");
});

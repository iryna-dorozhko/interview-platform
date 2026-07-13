import test from "node:test";
import assert from "node:assert/strict";
import { ArbiterReplyParseError, parseArbiterReply } from "./arbiter-agent";

test("parseArbiterReply parses post:false", () => {
  const result = parseArbiterReply('{ "post": false }');
  assert.equal(result.post, false);
  assert.equal(result.message, undefined);
});

test("parseArbiterReply parses post:true with message", () => {
  const result = parseArbiterReply('{ "post": true, "message": "Продовжуйте тему досвіду." }');
  assert.equal(result.post, true);
  assert.equal(result.message, "Продовжуйте тему досвіду.");
});

test("parseArbiterReply strips markdown code fences", () => {
  const raw = "```json\n{ \"post\": false }\n```";
  const result = parseArbiterReply(raw);
  assert.equal(result.post, false);
});

test("parseArbiterReply throws on invalid JSON", () => {
  assert.throws(() => parseArbiterReply("not json"), ArbiterReplyParseError);
});

test("parseArbiterReply throws when post:true but message is empty", () => {
  assert.throws(
    () => parseArbiterReply('{ "post": true, "message": "   " }'),
    ArbiterReplyParseError,
  );
});

test("parseArbiterReply throws when post field is missing", () => {
  assert.throws(() => parseArbiterReply('{ "message": "hi" }'), ArbiterReplyParseError);
});

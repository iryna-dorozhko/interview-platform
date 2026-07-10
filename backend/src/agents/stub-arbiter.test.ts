import test from "node:test";
import assert from "node:assert/strict";
import { buildStubArbiterReply, runStubArbiter, STUB_AGENT_DELAY_MS } from "./stub-arbiter";

test("buildStubArbiterReply includes truncated quote", () => {
  const long = "а".repeat(100);
  const reply = buildStubArbiterReply(long);
  assert.match(reply, /^\[Arbiter stub\]/);
  assert.match(reply, /Почув вас/);
  assert.match(reply, /«а{80}»/);
  assert.doesNotMatch(reply, /а{81}/);
});

test("buildStubArbiterReply handles short content", () => {
  const reply = buildStubArbiterReply("Привіт");
  assert.equal(reply, "[Arbiter stub] Почув вас. Продовжуйте розмову. (Останнє: «Привіт»)");
});

test("runStubArbiter resolves after delay", async () => {
  const start = Date.now();
  const reply = await runStubArbiter("Тест");
  const elapsed = Date.now() - start;
  assert.match(reply, /\[Arbiter stub\]/);
  assert.ok(elapsed >= STUB_AGENT_DELAY_MS - 50);
});

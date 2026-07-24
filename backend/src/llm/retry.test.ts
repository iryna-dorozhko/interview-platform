import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import {
  isRetryableLlmError,
  toSafeLlmErrorMessage,
  withLlmRetry,
  SAFE_LLM_ERROR_UK,
} from "./retry";

test("isRetryableLlmError accepts unavailable, empty, parse, extraction", () => {
  assert.equal(isRetryableLlmError(new LlmUnavailableError("down")), true);
  assert.equal(isRetryableLlmError(new LlmEmptyResponseError()), true);
  const parseErr = new Error("bad json");
  parseErr.name = "ArbiterReplyParseError";
  assert.equal(isRetryableLlmError(parseErr), true);
  const extractErr = new Error("bad profile");
  extractErr.name = "ProfileExtractionError";
  assert.equal(isRetryableLlmError(extractErr), true);
});

test("isRetryableLlmError rejects context and generic errors", () => {
  const ctx = new Error("Missing company profile");
  ctx.name = "ArbiterContextError";
  assert.equal(isRetryableLlmError(ctx), false);
  assert.equal(isRetryableLlmError(new Error("boom")), false);
});

test("isRetryableLlmError rejects LLM timeout errors", () => {
  assert.equal(
    isRetryableLlmError(
      new LlmUnavailableError("Cursor ACP prompt timed out after 120000ms"),
    ),
    false,
  );
  assert.equal(
    isRetryableLlmError(
      new LlmUnavailableError("Cursor ACP session/new timed out after 30000ms"),
    ),
    false,
  );
  assert.equal(
    isRetryableLlmError(new LlmUnavailableError("Cursor ACP is unavailable: down")),
    true,
  );
});

test("toSafeLlmErrorMessage keeps rate-limit Ukrainian text", () => {
  const err = new LlmUnavailableError(
    "LLM API: перевищено ліміт запитів. Змініть LLM_PROVIDER у .env або зачекайте.",
  );
  assert.equal(toSafeLlmErrorMessage(err), err.message);
  assert.equal(toSafeLlmErrorMessage(new Error("ECONNRESET")), SAFE_LLM_ERROR_UK);
});

test("withLlmRetry succeeds after transient failures", async () => {
  let attempts = 0;
  const result = await withLlmRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new LlmUnavailableError("tmp");
    return "ok";
  }, { maxAttempts: 3 });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withLlmRetry does not retry context errors", async () => {
  let attempts = 0;
  const ctx = new Error("missing");
  ctx.name = "CompanyLiveContextError";
  await assert.rejects(
    () =>
      withLlmRetry(async () => {
        attempts += 1;
        throw ctx;
      }),
    (err: unknown) => err === ctx,
  );
  assert.equal(attempts, 1);
});

test("withLlmRetry exhausts attempts then throws last error", async () => {
  await assert.rejects(
    () =>
      withLlmRetry(
        async () => {
          throw new LlmEmptyResponseError();
        },
        { maxAttempts: 3 },
      ),
    LlmEmptyResponseError,
  );
});

test("withLlmRetry uses Gemini retry hint delay", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  await withLlmRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("[429 Too Many Requests] Please retry in 1.0s");
      }
      return "ok";
    },
    {
      maxAttempts: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  assert.equal(attempts, 2);
  assert.ok(sleeps[0]! >= 1000);
});

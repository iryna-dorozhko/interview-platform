import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bumpAgentMessage,
  bumpAutoRetry,
  bumpHrControl,
  bumpManualRetry,
  clearCounters,
  getCounters,
  resetAllEvalCounters,
} from "./interview-eval-counters";

test.beforeEach(() => {
  resetAllEvalCounters();
});

test("bumps accumulate per interviewId", () => {
  bumpAutoRetry("i1");
  bumpAutoRetry("i1");
  bumpManualRetry("i1");
  bumpHrControl("i1");
  bumpAgentMessage("i1", "normal");
  bumpAgentMessage("i1", "clarifying");
  assert.deepEqual(getCounters("i1"), {
    autoRetryCount: 2,
    manualRetryCount: 1,
    hrControlActionCount: 1,
    clarifyingQuestionCount: 1,
    agentMessageCount: 2,
  });
  assert.deepEqual(getCounters("missing"), {
    autoRetryCount: 0,
    manualRetryCount: 0,
    hrControlActionCount: 0,
    clarifyingQuestionCount: 0,
    agentMessageCount: 0,
  });
});

test("clearCounters zeroes one interview", () => {
  bumpAutoRetry("i1");
  clearCounters("i1");
  assert.equal(getCounters("i1").autoRetryCount, 0);
});

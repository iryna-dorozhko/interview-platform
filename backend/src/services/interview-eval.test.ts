import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeEvalSnapshots } from "./interview-eval";
import {
  bumpAutoRetry,
  clearCounters,
  getCounters,
  resetAllEvalCounters,
} from "./interview-eval-counters";

test.beforeEach(() => {
  resetAllEvalCounters();
});

test("summarizeEvalSnapshots computes averages and clarifying rate", () => {
  const summary = summarizeEvalSnapshots([
    {
      prepCandidateDurationMs: 1000,
      prepVacancyDurationMs: 2000,
      liveDurationMs: 3000,
      autoRetryCount: 1,
      manualRetryCount: 2,
      hrMessageCount: 3,
      hrControlActionCount: 1,
      clarifyingQuestionCount: 1,
      agentMessageCount: 4,
      finalMatchScore: 80,
      hrAgreedWithArbiter: true,
    },
    {
      prepCandidateDurationMs: null,
      prepVacancyDurationMs: 4000,
      liveDurationMs: null,
      autoRetryCount: 3,
      manualRetryCount: 0,
      hrMessageCount: 1,
      hrControlActionCount: 1,
      clarifyingQuestionCount: 1,
      agentMessageCount: 1,
      finalMatchScore: 60,
      hrAgreedWithArbiter: false,
    },
  ]);

  assert.equal(summary.snapshotCount, 2);
  assert.equal(summary.withDecisionCount, 2);
  assert.equal(summary.avgPrepCandidateDurationMs, 1000);
  assert.equal(summary.avgPrepVacancyDurationMs, 3000);
  assert.equal(summary.avgLiveDurationMs, 3000);
  assert.equal(summary.avgAutoRetryCount, 2);
  assert.equal(summary.clarifyingRate, 2 / 5);
  assert.equal(summary.avgFinalMatchScore, 70);
  assert.equal(summary.agreementRate, 0.5);
});

test("summarizeEvalSnapshots empty agreementRate null and clarifying 0", () => {
  const summary = summarizeEvalSnapshots([
    {
      prepCandidateDurationMs: null,
      prepVacancyDurationMs: null,
      liveDurationMs: null,
      autoRetryCount: 0,
      manualRetryCount: 0,
      hrMessageCount: 0,
      hrControlActionCount: 0,
      clarifyingQuestionCount: 0,
      agentMessageCount: 0,
      finalMatchScore: null,
      hrAgreedWithArbiter: null,
    },
  ]);
  assert.equal(summary.withDecisionCount, 0);
  assert.equal(summary.agreementRate, null);
  assert.equal(summary.clarifyingRate, 0);
  assert.equal(summary.avgFinalMatchScore, null);
});

test("clearCounters used after merge pattern", () => {
  bumpAutoRetry("i1");
  assert.equal(getCounters("i1").autoRetryCount, 1);
  clearCounters("i1");
  assert.equal(getCounters("i1").autoRetryCount, 0);
});

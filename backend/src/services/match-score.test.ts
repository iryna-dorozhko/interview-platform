import test from "node:test";
import assert from "node:assert/strict";
import { computeMatchScore } from "./match-score";

test("computeMatchScore weights critical 75 and desired 25 then blends context 20", () => {
  const result = computeMatchScore(
    [
      { requirement: "A", priority: "critical", status: "met", evidence: "є" },
      { requirement: "B", priority: "critical", status: "met", evidence: "є" },
      { requirement: "C", priority: "critical", status: "unknown", evidence: "немає даних" },
      { requirement: "D", priority: "desired", status: "met", evidence: "є" },
      { requirement: "E", priority: "desired", status: "unmet", evidence: "немає" },
    ],
    80,
  );
  // criticalFit=83.333..., desiredFit=50, requirementsFit=75, raw≈76
  assert.equal(result.matchScore, 76);
  assert.equal(result.cappedByCriticalUnmet, false);
});

test("computeMatchScore caps at 69 when any critical is unmet", () => {
  const result = computeMatchScore(
    [
      { requirement: "Must", priority: "critical", status: "unmet", evidence: "немає" },
      { requirement: "Core", priority: "critical", status: "met", evidence: "є" },
      { requirement: "Nice", priority: "desired", status: "met", evidence: "є" },
    ],
    100,
  );
  assert.ok(result.rawScore > 69);
  assert.equal(result.matchScore, 69);
  assert.equal(result.cappedByCriticalUnmet, true);
});

test("computeMatchScore unknown critical does not cap", () => {
  const result = computeMatchScore(
    [{ requirement: "Must", priority: "critical", status: "unknown", evidence: "немає даних" }],
    100,
  );
  assert.equal(result.cappedByCriticalUnmet, false);
  assert.equal(result.matchScore, 60); // requirementsFit=50 → 0.8*50+0.2*100=60
});

test("computeMatchScore uses only present category when other empty", () => {
  const result = computeMatchScore(
    [{ requirement: "Nice", priority: "desired", status: "met", evidence: "є" }],
    50,
  );
  assert.equal(result.requirementsFit, 100);
  assert.equal(result.matchScore, 90);
});

test("computeMatchScore with no requirements uses contextFit only", () => {
  const result = computeMatchScore([], 77);
  assert.equal(result.matchScore, 77);
  assert.equal(result.requirementsFit, null);
});

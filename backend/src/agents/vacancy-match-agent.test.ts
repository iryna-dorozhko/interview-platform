import test from "node:test";
import assert from "node:assert/strict";
import { parseVacancyMatchScores, parseCandidateSummary } from "./vacancy-match-agent";

test("parseVacancyMatchScores accepts valid JSON array and clamps scores", () => {
  const raw = JSON.stringify({
    scores: [
      { vacancyId: "v1", matchScore: 95 },
      { vacancyId: "v2", matchScore: 150 },
      { vacancyId: "unknown", matchScore: 10 },
    ],
  });
  const parsed = parseVacancyMatchScores(raw, new Set(["v1", "v2"]));
  assert.deepEqual(parsed, [
    { vacancyId: "v1", matchScore: 95 },
    { vacancyId: "v2", matchScore: 100 },
  ]);
});

test("parseVacancyMatchScores throws on invalid JSON", () => {
  assert.throws(() => parseVacancyMatchScores("not-json", new Set(["v1"])));
});

test("parseCandidateSummary returns trimmed Ukrainian text", () => {
  const text = parseCandidateSummary(JSON.stringify({ summary: "  Сильний бекенд-досвід.  " }));
  assert.equal(text, "Сильний бекенд-досвід.");
});

import test from "node:test";
import assert from "node:assert/strict";
import { pickNextOffer, sortScoresDesc } from "./vacancy-match";

test("sortScoresDesc orders by matchScore descending", () => {
  const sorted = sortScoresDesc([
    { vacancyId: "a", title: "A", matchScore: 40 },
    { vacancyId: "b", title: "B", matchScore: 90 },
    { vacancyId: "c", title: "C", matchScore: 70 },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.vacancyId),
    ["b", "c", "a"],
  );
});

test("pickNextOffer skips rejected and returns highest remaining", () => {
  const next = pickNextOffer(
    [
      { vacancyId: "b", title: "B", matchScore: 90 },
      { vacancyId: "c", title: "C", matchScore: 70 },
      { vacancyId: "a", title: "A", matchScore: 40 },
    ],
    new Set(["b"]),
  );
  assert.deepEqual(next, { vacancyId: "c", title: "C", matchScore: 70 });
});

test("pickNextOffer returns null when all rejected", () => {
  const next = pickNextOffer(
    [{ vacancyId: "a", title: "A", matchScore: 50 }],
    new Set(["a"]),
  );
  assert.equal(next, null);
});

test("candidate offer payload has only vacancyId, title, matchScore", () => {
  const offer = { vacancyId: "v1", title: "Backend", matchScore: 88 };
  assert.deepEqual(Object.keys(offer).sort(), ["matchScore", "title", "vacancyId"]);
});

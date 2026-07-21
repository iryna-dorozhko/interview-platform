import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVacancyRequirements,
  assertNonEmptyRequirements,
} from "./vacancy-requirements";

test("normalizeVacancyRequirements maps legacy string[] to desired", () => {
  assert.deepEqual(normalizeVacancyRequirements(["Node.js", "TypeScript"]), {
    critical: [],
    desired: ["Node.js", "TypeScript"],
  });
});

test("normalizeVacancyRequirements accepts structured object", () => {
  assert.deepEqual(
    normalizeVacancyRequirements({
      critical: ["  Node.js  ", "TypeScript"],
      desired: ["Docker", "node.js"],
    }),
    { critical: ["Node.js", "TypeScript"], desired: ["Docker"] },
  );
});

test("normalizeVacancyRequirements prefers critical on case-insensitive overlap", () => {
  assert.deepEqual(
    normalizeVacancyRequirements({
      critical: ["React"],
      desired: ["react", "GraphQL"],
    }),
    { critical: ["React"], desired: ["GraphQL"] },
  );
});

test("normalizeVacancyRequirements drops empty strings and rejects invalid shapes", () => {
  assert.deepEqual(normalizeVacancyRequirements({ critical: [""], desired: ["SQL"] }), {
    critical: [],
    desired: ["SQL"],
  });
  assert.equal(normalizeVacancyRequirements(null), null);
  assert.equal(normalizeVacancyRequirements({ critical: "x" }), null);
});

test("assertNonEmptyRequirements requires at least one item", () => {
  assert.equal(assertNonEmptyRequirements({ critical: [], desired: [] }), false);
  assert.equal(assertNonEmptyRequirements({ critical: ["A"], desired: [] }), true);
  assert.equal(assertNonEmptyRequirements({ critical: [], desired: ["B"] }), true);
});

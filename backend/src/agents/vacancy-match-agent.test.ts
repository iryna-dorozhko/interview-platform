import test from "node:test";
import assert from "node:assert/strict";
import { parseVacancyMatchAssessments, parseCandidateSummary } from "./vacancy-match-agent";

const sampleVacancy = {
  vacancyId: "v1",
  title: "BE",
  role: "BE",
  requirements: { critical: ["Node.js"], desired: ["Docker"] },
  culture: [],
  expectations: [],
};

test("parseVacancyMatchAssessments accepts full coverage and contextFit", () => {
  const raw = JSON.stringify({
    results: [
      {
        vacancyId: "v1",
        contextFit: 80,
        assessments: [
          {
            requirement: "Node.js",
            priority: "critical",
            status: "met",
            evidence: "Вказано Node.js у skills",
          },
          {
            requirement: "Docker",
            priority: "desired",
            status: "unknown",
            evidence: "Не згадується",
          },
        ],
      },
    ],
  });
  const parsed = parseVacancyMatchAssessments(raw, [
    {
      vacancyId: "v1",
      title: "BE",
      role: "BE",
      requirements: { critical: ["Node.js"], desired: ["Docker"] },
      culture: [],
      expectations: [],
    },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.contextFit, 80);
  assert.equal(parsed[0]?.assessments.length, 2);
});

test("parseVacancyMatchAssessments rejects missing requirement or invalid status", () => {
  assert.throws(() =>
    parseVacancyMatchAssessments(
      JSON.stringify({
        results: [
          {
            vacancyId: "v1",
            contextFit: 50,
            assessments: [
              {
                requirement: "Node.js",
                priority: "critical",
                status: "maybe",
                evidence: "x",
              },
            ],
          },
        ],
      }),
      [
        {
          vacancyId: "v1",
          title: "BE",
          role: "BE",
          requirements: { critical: ["Node.js"], desired: [] },
          culture: [],
          expectations: [],
        },
      ],
    ),
  );
});

test("parseVacancyMatchAssessments rejects duplicate requirement assessment", () => {
  assert.throws(() =>
    parseVacancyMatchAssessments(
      JSON.stringify({
        results: [
          {
            vacancyId: "v1",
            contextFit: 50,
            assessments: [
              {
                requirement: "Node.js",
                priority: "critical",
                status: "met",
                evidence: "a",
              },
              {
                requirement: "Node.js",
                priority: "critical",
                status: "unknown",
                evidence: "b",
              },
            ],
          },
        ],
      }),
      [{ ...sampleVacancy, requirements: { critical: ["Node.js"], desired: [] } }],
    ),
  );
});

test("parseVacancyMatchAssessments rejects wrong priority", () => {
  assert.throws(() =>
    parseVacancyMatchAssessments(
      JSON.stringify({
        results: [
          {
            vacancyId: "v1",
            contextFit: 50,
            assessments: [
              {
                requirement: "Node.js",
                priority: "desired",
                status: "met",
                evidence: "a",
              },
            ],
          },
        ],
      }),
      [{ ...sampleVacancy, requirements: { critical: ["Node.js"], desired: [] } }],
    ),
  );
});

test("parseVacancyMatchAssessments throws on invalid JSON", () => {
  assert.throws(() => parseVacancyMatchAssessments("not-json", [sampleVacancy]));
});

test("parseCandidateSummary returns trimmed Ukrainian text", () => {
  const text = parseCandidateSummary(JSON.stringify({ summary: "  Сильний бекенд-досвід.  " }));
  assert.equal(text, "Сильний бекенд-досвід.");
});

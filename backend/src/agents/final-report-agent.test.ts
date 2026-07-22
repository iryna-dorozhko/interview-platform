import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFinalReportMessages,
  FinalReportExtractionError,
  formatLiveTranscript,
  parseFinalReport,
} from "./final-report-agent";
import { FINAL_REPORT_SYSTEM_PROMPT_UK } from "./prompts/final-report.uk";
import { computeMatchScore } from "../services/match-score";

const sampleRequirements = {
  critical: ["Node.js"],
  desired: ["Docker"],
};

function sampleReportJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    reportMarkdown:
      "## Підсумок\n\nДобре.\n## Відповідність вимогам\n### Критичні\n- Node.js\n### Бажані\n- Docker",
    recommendation: "MAYBE",
    contextFit: 80,
    assessments: [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "met",
        evidence: "Підтверджено в стенограмі",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "unmet",
        evidence: "Немає досвіду",
      },
    ],
    strengths: ["Досвід Node.js"],
    risks: ["Немає Docker"],
    ...overrides,
  });
}

test("formatLiveTranscript maps author types to Ukrainian labels", () => {
  const text = formatLiveTranscript([
    { authorType: "HUMAN_HR", content: "Вітаю!" },
    { authorType: "AGENT_ARBITER", content: "Почнемо." },
  ]);
  assert.match(text, /\[HR\] Вітаю!/);
  assert.match(text, /\[Arbiter\] Почнемо./);
});

test("formatLiveTranscript includes confidence labels for AGENT_CANDIDATE", () => {
  const text = formatLiveTranscript([
    {
      authorType: "AGENT_CANDIDATE",
      content: "Кандидат має досвід.",
      candidateConfidence: "CONFIRMED",
    },
    {
      authorType: "AGENT_CANDIDATE",
      content: "З анкети видно…",
      candidateConfidence: "INFERRED",
    },
    {
      authorType: "AGENT_CANDIDATE",
      content: "Ірино, відповідай.",
      candidateConfidence: "UNKNOWN",
    },
  ]);
  assert.match(text, /\[Кандидат \(AI\) · confirmed\]/);
  assert.match(text, /\[Кандидат \(AI\) · inferred\]/);
  assert.match(text, /\[Кандидат \(AI\) · unknown\]/);
});

test("parseFinalReport parses valid JSON", () => {
  const result = parseFinalReport(sampleReportJson({ recommendation: "HIRE" }), sampleRequirements);
  assert.equal(result.recommendation, "HIRE");
  assert.equal(
    result.matchScore,
    computeMatchScore(
      [
        {
          requirement: "Node.js",
          priority: "critical",
          status: "met",
          evidence: "Підтверджено в стенограмі",
        },
        {
          requirement: "Docker",
          priority: "desired",
          status: "unmet",
          evidence: "Немає досвіду",
        },
      ],
      80,
    ).matchScore,
  );
  assert.equal(result.strengths[0], "Досвід Node.js");
  assert.match(result.reportMarkdown, /Підсумок/);
});

test("parseFinalReport strips markdown code fences", () => {
  const raw = `\`\`\`json\n${sampleReportJson()}\n\`\`\``;
  const result = parseFinalReport(raw, sampleRequirements);
  assert.equal(result.recommendation, "MAYBE");
});

test("parseFinalReport throws on invalid recommendation", () => {
  const raw = sampleReportJson({ recommendation: "YES" });
  assert.throws(() => parseFinalReport(raw, sampleRequirements), FinalReportExtractionError);
});

test("parseFinalReport computes matchScore via computeMatchScore", () => {
  const result = parseFinalReport(sampleReportJson(), sampleRequirements);
  const expected = computeMatchScore(
    [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "met",
        evidence: "Підтверджено в стенограмі",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "unmet",
        evidence: "Немає досвіду",
      },
    ],
    80,
  );
  assert.equal(result.matchScore, expected.matchScore);
  assert.equal(result.recommendation, "MAYBE");
});

test("parseFinalReport caps matchScore at 69 when critical is unmet", () => {
  const raw = sampleReportJson({
    recommendation: "REJECT",
    contextFit: 100,
    assessments: [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "unmet",
        evidence: "Немає",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "met",
        evidence: "Є",
      },
    ],
    risks: ["Немає Node.js"],
  });
  const result = parseFinalReport(raw, sampleRequirements);
  assert.ok(result.matchScore <= 69);
  const expected = computeMatchScore(
    [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "unmet",
        evidence: "Немає",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "met",
        evidence: "Є",
      },
    ],
    100,
  );
  assert.equal(result.matchScore, expected.matchScore);
  assert.equal(expected.cappedByCriticalUnmet, true);
});

test("parseFinalReport rejects incomplete assessments", () => {
  const raw = sampleReportJson({
    assessments: [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "met",
        evidence: "ok",
      },
    ],
  });
  assert.throws(
    () => parseFinalReport(raw, sampleRequirements),
    FinalReportExtractionError,
  );
});

test("parseFinalReport rejects wrong priority", () => {
  const raw = sampleReportJson({
    assessments: [
      {
        requirement: "Node.js",
        priority: "desired",
        status: "met",
        evidence: "ok",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "met",
        evidence: "ok",
      },
    ],
  });
  assert.throws(
    () => parseFinalReport(raw, sampleRequirements),
    FinalReportExtractionError,
  );
});

test("parseFinalReport with empty requirements uses contextFit as matchScore", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## Підсумок\n\nOK",
    recommendation: "MAYBE",
    contextFit: 73,
    assessments: [],
    strengths: ["a"],
    risks: ["b"],
  });
  const result = parseFinalReport(raw, { critical: [], desired: [] });
  assert.equal(result.matchScore, 73);
});

test("parseFinalReport rejects contextFit out of range", () => {
  assert.throws(
    () => parseFinalReport(sampleReportJson({ contextFit: 101 }), sampleRequirements),
    FinalReportExtractionError,
  );
});

test("buildFinalReportMessages includes explicit critical/desired requirements block", () => {
  const messages = buildFinalReportMessages({
    transcript: "[HR] hi",
    companyProfile: { role: "Backend" },
    candidateProfile: { summary: "Dev" },
    requirements: { critical: ["TypeScript"], desired: ["K8s"] },
  });
  const user = messages.find((m) => m.role === "user");
  assert.ok(user);
  assert.match(user.content, /=== ВИМОГИ ВАКАНСІЇ/);
  assert.match(user.content, /critical/);
  assert.match(user.content, /TypeScript/);
  assert.match(user.content, /desired/);
  assert.match(user.content, /K8s/);
});

test("FINAL_REPORT_SYSTEM_PROMPT_UK requires assessments and contextFit without matchScore", () => {
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /contextFit/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /assessments/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /critical/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /desired/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /Критичні|критичн/i);
  assert.match(
    FINAL_REPORT_SYSTEM_PROMPT_UK,
    /не повертай поле matchScore|Не повертай поле matchScore/i,
  );
  assert.doesNotMatch(
    FINAL_REPORT_SYSTEM_PROMPT_UK,
    /\{"reportMarkdown":".*","recommendation":"HIRE\|MAYBE\|REJECT","matchScore":0-100/,
  );
});

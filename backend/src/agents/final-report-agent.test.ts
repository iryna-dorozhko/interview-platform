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

const VALID_REASON = "Сильний red flag по комунікації під час live.";

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
  assert.equal(result.recommendation, "HIRE");
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
  assert.equal(result.recommendation, "HIRE");
});

test("parseFinalReport forces HIRE when all critical are met even if LLM returned MAYBE", () => {
  const result = parseFinalReport(
    sampleReportJson({ recommendation: "MAYBE" }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
});

test("parseFinalReport keeps MAYBE with exception when all critical met", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "MAYBE",
      overrideKind: "soft_skills",
      overrideReason: VALID_REASON,
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "MAYBE");
  assert.equal(result.overrideKind, "soft_skills");
  assert.equal(result.overrideReason, VALID_REASON);
});

test("parseFinalReport keeps REJECT with exception when all critical met", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "REJECT",
      overrideKind: "red_flag",
      overrideReason: VALID_REASON,
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "REJECT");
  assert.equal(result.overrideKind, "red_flag");
});

test("parseFinalReport keeps HIRE with exception when critical unmet", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "HIRE",
      overrideKind: "critical_gap_ok",
      overrideReason: VALID_REASON,
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
      risks: ["Немає Node.js — прийнятний gap"],
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.overrideKind, "critical_gap_ok");
  assert.equal(result.overrideReason, VALID_REASON);
});

test("parseFinalReport ignores short overrideReason and applies baseline", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "MAYBE",
      overrideKind: "culture_fit",
      overrideReason: "коротко",
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.overrideKind, null);
  assert.equal(result.overrideReason, null);
});

test("parseFinalReport ignores invalid overrideKind and applies baseline", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "MAYBE",
      overrideKind: "nope",
      overrideReason: VALID_REASON,
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.overrideKind, null);
});

test("parseFinalReport strips unused exception when LLM matches baseline", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "REJECT",
      overrideKind: "other",
      overrideReason: VALID_REASON,
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
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "REJECT");
  assert.equal(result.overrideKind, null);
  assert.equal(result.overrideReason, null);
});

test("parseFinalReport returns null override when fields omitted", () => {
  const result = parseFinalReport(
    sampleReportJson({ recommendation: "HIRE" }),
    sampleRequirements,
  );
  assert.equal(result.overrideKind, null);
  assert.equal(result.overrideReason, null);
});

test("parseFinalReport downgrades HIRE to MAYBE when any critical is unmet", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "HIRE",
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
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "MAYBE");
});

test("parseFinalReport downgrades HIRE to MAYBE when any critical is unknown", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "HIRE",
      assessments: [
        {
          requirement: "Node.js",
          priority: "critical",
          status: "unknown",
          evidence: "Не зʼясовано",
        },
        {
          requirement: "Docker",
          priority: "desired",
          status: "met",
          evidence: "Є",
        },
      ],
      risks: ["Node.js unknown"],
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "MAYBE");
});

test("parseFinalReport keeps REJECT when critical unmet and LLM returned REJECT", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "REJECT",
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
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "REJECT");
});

test("parseFinalReport forces HIRE when desired unmet but all critical met", () => {
  const result = parseFinalReport(
    sampleReportJson({ recommendation: "REJECT" }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
});

test("parseFinalReport forces HIRE when critical list is empty", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## Підсумок\n\nOK",
    recommendation: "MAYBE",
    contextFit: 73,
    assessments: [
      {
        requirement: "Docker",
        priority: "desired",
        status: "unmet",
        evidence: "Немає",
      },
    ],
    strengths: ["a"],
    risks: ["b"],
  });
  const result = parseFinalReport(raw, { critical: [], desired: ["Docker"] });
  assert.equal(result.recommendation, "HIRE");
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
  assert.equal(result.recommendation, "HIRE");
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
  assert.match(
    FINAL_REPORT_SYSTEM_PROMPT_UK,
    /всі critical мають status met.*МАЄ бути HIRE|МАЄ бути HIRE/i,
  );
  assert.match(
    FINAL_REPORT_SYSTEM_PROMPT_UK,
    /unmet або unknown — recommendation НЕ може бути HIRE/i,
  );
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /overrideKind/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /overrideReason/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /critical_gap_ok/);
  assert.match(
    FINAL_REPORT_SYSTEM_PROMPT_UK,
    /відхилитись від цього правила ЛИШЕ|можна відхилитись/i,
  );
  assert.doesNotMatch(
    FINAL_REPORT_SYSTEM_PROMPT_UK,
    /\{"reportMarkdown":".*","recommendation":"HIRE\|MAYBE\|REJECT","matchScore":0-100/,
  );
});

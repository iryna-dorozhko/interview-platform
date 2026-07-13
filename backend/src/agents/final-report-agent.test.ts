import test from "node:test";
import assert from "node:assert/strict";
import {
  FinalReportExtractionError,
  formatLiveTranscript,
  parseFinalReport,
} from "./final-report-agent";

test("formatLiveTranscript maps author types to Ukrainian labels", () => {
  const text = formatLiveTranscript([
    { authorType: "HUMAN_HR", content: "Вітаю!" },
    { authorType: "AGENT_ARBITER", content: "Почнемо." },
  ]);
  assert.match(text, /\[HR\] Вітаю!/);
  assert.match(text, /\[Arbiter\] Почнемо./);
});

test("parseFinalReport parses valid JSON", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## Підсумок\n\nДобре.",
    recommendation: "HIRE",
    matchScore: 82,
    strengths: ["Досвід Node.js"],
    risks: ["Мало leadership"],
  });
  const result = parseFinalReport(raw);
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.matchScore, 82);
  assert.equal(result.strengths[0], "Досвід Node.js");
  assert.match(result.reportMarkdown, /Підсумок/);
});

test("parseFinalReport strips markdown code fences", () => {
  const raw = "```json\n{\"reportMarkdown\":\"## OK\",\"recommendation\":\"MAYBE\",\"matchScore\":50,\"strengths\":[\"a\"],\"risks\":[\"b\"]}\n```";
  const result = parseFinalReport(raw);
  assert.equal(result.recommendation, "MAYBE");
});

test("parseFinalReport throws on invalid recommendation", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## X",
    recommendation: "YES",
    matchScore: 50,
    strengths: ["a"],
    risks: ["b"],
  });
  assert.throws(() => parseFinalReport(raw), FinalReportExtractionError);
});

test("parseFinalReport throws when matchScore out of range", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## X",
    recommendation: "HIRE",
    matchScore: 101,
    strengths: ["a"],
    risks: ["b"],
  });
  assert.throws(() => parseFinalReport(raw), FinalReportExtractionError);
});

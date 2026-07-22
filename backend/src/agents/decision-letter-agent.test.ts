import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionLetterMessages,
  normalizeDecisionLetter,
} from "./decision-letter-agent";

test("buildDecisionLetterMessages includes type and vacancy", () => {
  const messages = buildDecisionLetterMessages({
    type: "REJECT",
    vacancyTitle: "Backend Engineer",
    reportMarkdown: "## Підсумок\nСлабко",
    recommendation: "REJECT",
    matchScore: 40,
    strengths: ["Комунікація"],
    risks: ["Немає досвіду Nest"],
    companyProfileJson: "{}",
    candidateProfileJson: "{}",
  });
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[1]?.content ?? "", /REJECT/);
  assert.match(messages[1]?.content ?? "", /Backend Engineer/);
});

test("normalizeDecisionLetter strips fences and rejects empty", () => {
  assert.equal(normalizeDecisionLetter("```\nПривіт\n```"), "Привіт");
  assert.throws(() => normalizeDecisionLetter("   "));
});

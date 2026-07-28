import test from "node:test";
import assert from "node:assert/strict";
import {
  extractVacancyOffer,
  buildDecisionLetterMessages,
  normalizeDecisionLetter,
} from "./decision-letter-agent";

test("extractVacancyOffer includes salary and all specified workConditions", () => {
  const result = extractVacancyOffer({
    compensation: { displayText: "$4000 gross, USD" },
    workConditions: [
      "Формат: remote",
      "Графік: гнучкий",
      "Бенефіти: страховка",
      "Релокація: не вказано",
      "Випробувальний: 3 місяці",
      "Обладнання: ноутбук",
    ],
  });
  assert.equal(result.offerAvailable, true);
  assert.deepEqual(result.offerLines, [
    "Зарплата: $4000 gross, USD",
    "Формат: remote",
    "Графік: гнучкий",
    "Бенефіти: страховка",
    "Випробувальний: 3 місяці",
    "Обладнання: ноутбук",
  ]);
});

test("extractVacancyOffer returns empty when all unspecified", () => {
  const result = extractVacancyOffer({
    compensation: { displayText: "не вказано" },
    workConditions: [
      "Формат: не вказано",
      "Графік: не вказано",
    ],
  });
  assert.equal(result.offerAvailable, false);
  assert.deepEqual(result.offerLines, []);
});

test("extractVacancyOffer handles invalid profile", () => {
  assert.deepEqual(extractVacancyOffer(null), {
    offerAvailable: false,
    offerLines: [],
  });
  assert.deepEqual(extractVacancyOffer("x"), {
    offerAvailable: false,
    offerLines: [],
  });
});

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

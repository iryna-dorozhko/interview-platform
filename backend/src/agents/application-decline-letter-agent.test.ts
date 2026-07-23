import test from "node:test";
import assert from "node:assert/strict";
import { buildApplicationDeclineLetterMessages } from "./application-decline-letter-agent";

test("buildApplicationDeclineLetterMessages includes vacancy and summary", () => {
  const messages = buildApplicationDeclineLetterMessages({
    vacancyTitle: "Backend Engineer",
    candidateSummary: "Досвід з Node, мало Nest.",
    matchScore: 72,
  });
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[1]?.content ?? "", /Backend Engineer/);
  assert.match(messages[1]?.content ?? "", /Досвід з Node/);
  assert.match(messages[1]?.content ?? "", /72/);
});

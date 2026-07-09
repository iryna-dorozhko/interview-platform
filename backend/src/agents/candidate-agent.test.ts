import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidateAgentMessages,
  parseCandidateProfileExtraction,
} from "./candidate-agent";
import { CANDIDATE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-agent.uk";

test("buildCandidateAgentMessages prepends system prompt and maps author types", () => {
  const history = [
    { authorType: "HUMAN_CANDIDATE" as const, content: "Привіт" },
    { authorType: "AGENT_CANDIDATE" as const, content: "Розкажіть про досвід." },
  ];
  const messages = buildCandidateAgentMessages(history);

  assert.deepEqual(messages[0], { role: "system", content: CANDIDATE_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "Привіт" });
  assert.deepEqual(messages[2], { role: "assistant", content: "Розкажіть про досвід." });
});

test("buildCandidateAgentMessages appends placeholder user turn for empty history", () => {
  const messages = buildCandidateAgentMessages([]);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: CANDIDATE_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "(порожнє повідомлення)" });
});

test("buildCandidateAgentMessages appends placeholder when history ends with agent", () => {
  const history = [
    { authorType: "HUMAN_CANDIDATE" as const, content: "3 роки backend" },
    { authorType: "AGENT_CANDIDATE" as const, content: "Які ваші сильні сторони?" },
  ];
  const messages = buildCandidateAgentMessages(history);
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[3], { role: "user", content: "(порожнє повідомлення)" });
});

test("candidate system prompt mentions experience, strengths, weaknesses, and goals", () => {
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /досвід/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /сильн/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /слабк/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /ціл/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /READY:true/);
});

test("parseCandidateProfileExtraction parses plain JSON", () => {
  const raw = JSON.stringify({
    experience: ["3 роки backend", "Node.js, PostgreSQL"],
    skills: { strong: ["TypeScript"], growth: ["Public speaking"] },
    goals: ["Senior role"],
    summary: "Досвідчений backend-розробник.",
  });
  const result = parseCandidateProfileExtraction(raw);
  assert.deepEqual(result, {
    experience: ["3 роки backend", "Node.js, PostgreSQL"],
    skills: { strong: ["TypeScript"], growth: ["Public speaking"] },
    goals: ["Senior role"],
    summary: "Досвідчений backend-розробник.",
  });
});

test("parseCandidateProfileExtraction strips markdown code fences around JSON", () => {
  const raw = [
    "```json",
    JSON.stringify({
      experience: ["2 роки QA"],
      skills: { strong: ["Manual testing"], growth: ["не вказано"] },
      goals: ["не вказано"],
      summary: "QA-інженер з 2 роками досвіду.",
    }),
    "```",
  ].join("\n");
  const result = parseCandidateProfileExtraction(raw);
  assert.deepEqual(result.experience, ["2 роки QA"]);
  assert.deepEqual(result.skills.strong, ["Manual testing"]);
});

test("parseCandidateProfileExtraction throws when response is not valid JSON", () => {
  assert.throws(() => parseCandidateProfileExtraction("це не json, а звичайний текст"));
});

test("parseCandidateProfileExtraction throws when skills.strong is missing", () => {
  const raw = JSON.stringify({
    experience: ["3 роки backend"],
    skills: { growth: ["Public speaking"] },
    goals: ["Senior role"],
    summary: "Backend-розробник.",
  });
  assert.throws(() => parseCandidateProfileExtraction(raw));
});

test("parseCandidateProfileExtraction throws when summary is empty", () => {
  const raw = JSON.stringify({
    experience: ["3 роки backend"],
    skills: { strong: ["TypeScript"], growth: ["Public speaking"] },
    goals: ["Senior role"],
    summary: "",
  });
  assert.throws(() => parseCandidateProfileExtraction(raw));
});

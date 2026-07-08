import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateAgentMessages } from "./candidate-agent";
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

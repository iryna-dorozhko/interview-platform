import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanyAgentMessages, parseAgentReply } from "./company-agent";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";

test("parseAgentReply extracts READY:true marker and strips it from message", () => {
  const raw = "Дякую! Це все, що потрібно.\nREADY:true";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую! Це все, що потрібно.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply extracts READY:false marker and strips it from message", () => {
  const raw = "Розкажіть більше про вимоги до кандидата.\nREADY:false";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Розкажіть більше про вимоги до кандидата.");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply falls back to readyForConfirmation=false when marker is missing", () => {
  const raw = "Яка це посада?";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Яка це посада?");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply is case-insensitive and tolerates trailing whitespace", () => {
  const raw = "Дякую.\nready:TRUE  \n";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply handles marker with no preceding newline", () => {
  const raw = "Питання?READY:false";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Питання?");
  assert.equal(result.readyForConfirmation, false);
});

test("buildCompanyAgentMessages prepends system prompt and maps author types", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Привіт" },
    { authorType: "AGENT_COMPANY" as const, content: "Яка це посада?" },
  ];
  const messages = buildCompanyAgentMessages(history);

  assert.deepEqual(messages[0], { role: "system", content: COMPANY_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "Привіт" });
  assert.deepEqual(messages[2], { role: "assistant", content: "Яка це посада?" });
});

test("buildCompanyAgentMessages returns only system prompt for empty history", () => {
  const messages = buildCompanyAgentMessages([]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "system");
});

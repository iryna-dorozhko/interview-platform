import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyAgentMessages,
  buildProfileExtractionMessages,
  parseAgentReply,
  parseProfileExtraction,
} from "./company-agent";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";
import { PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/company-profile-extraction.uk";

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

test("parseAgentReply handles marker wrapped in square brackets with no preceding newline", () => {
  const raw = "Добрий день! Розкажіть про вакансію. [READY:false]";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Добрий день! Розкажіть про вакансію.");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply handles marker wrapped in square brackets after newline, readyForConfirmation=true", () => {
  const raw = "Дякую, цього достатньо.\n[READY:true]";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую, цього достатньо.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply handles marker wrapped in parentheses", () => {
  const raw = "Ще одне питання. (READY:false)";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Ще одне питання.");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply handles bracketed marker followed by trailing period", () => {
  const raw = "Дякую за відповідь. [READY:true].";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую за відповідь.");
  assert.equal(result.readyForConfirmation, true);
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

test("parseProfileExtraction parses plain JSON", () => {
  const raw = JSON.stringify({
    role: "Middle Backend Developer",
    requirements: ["Node.js", "PostgreSQL"],
    culture: ["Гнучкий графік"],
    expectations: ["Старт за 2 тижні"],
  });
  const result = parseProfileExtraction(raw);
  assert.deepEqual(result, {
    role: "Middle Backend Developer",
    requirements: ["Node.js", "PostgreSQL"],
    culture: ["Гнучкий графік"],
    expectations: ["Старт за 2 тижні"],
  });
});

test("parseProfileExtraction strips markdown code fences around JSON", () => {
  const raw = [
    "```json",
    JSON.stringify({
      role: "QA Engineer",
      requirements: ["3+ роки"],
      culture: ["не вказано"],
      expectations: ["не вказано"],
    }),
    "```",
  ].join("\n");
  const result = parseProfileExtraction(raw);
  assert.equal(result.role, "QA Engineer");
  assert.deepEqual(result.requirements, ["3+ роки"]);
});

test("parseProfileExtraction throws when response is not valid JSON", () => {
  assert.throws(() => parseProfileExtraction("це не json, а звичайний текст"));
});

test("parseProfileExtraction throws when a required field is missing", () => {
  const raw = JSON.stringify({ role: "Designer", requirements: ["Figma"] });
  assert.throws(() => parseProfileExtraction(raw));
});

test("parseProfileExtraction throws when role is empty", () => {
  const raw = JSON.stringify({
    role: "",
    requirements: ["Figma"],
    culture: ["не вказано"],
    expectations: ["не вказано"],
  });
  assert.throws(() => parseProfileExtraction(raw));
});

test("buildProfileExtractionMessages prepends extraction system prompt and joins transcript as one user message", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Middle Backend Developer" },
    { authorType: "AGENT_COMPANY" as const, content: "Які вимоги?" },
  ];
  const messages = buildProfileExtractionMessages(history);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: PROFILE_EXTRACTION_SYSTEM_PROMPT_UK });
  assert.equal(messages[1].role, "user");
  assert.equal(
    messages[1].content,
    "HR: Middle Backend Developer\nАгент: Які вимоги?"
  );
});

test("buildProfileExtractionMessages handles empty history with a placeholder transcript", () => {
  const messages = buildProfileExtractionMessages([]);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "(розмова порожня)");
});

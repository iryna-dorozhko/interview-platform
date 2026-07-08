import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyAgentMessages,
  buildProfileExtractionMessages,
  parseProfileExtraction,
} from "./company-agent";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";
import { PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/company-profile-extraction.uk";

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

test("buildCompanyAgentMessages appends a placeholder user turn for empty history", () => {
  const messages = buildCompanyAgentMessages([]);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: COMPANY_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "(порожнє повідомлення)" });
});

test("buildCompanyAgentMessages appends a placeholder user turn when history ends with the agent", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Привіт" },
    { authorType: "AGENT_COMPANY" as const, content: "Яка це посада?" },
  ];
  const messages = buildCompanyAgentMessages(history);

  assert.equal(messages.length, 4);
  assert.deepEqual(messages[3], { role: "user", content: "(порожнє повідомлення)" });
});

test("buildCompanyAgentMessages does not append a placeholder when history already ends with the user", () => {
  const history = [{ authorType: "HUMAN_HR" as const, content: "Привіт" }];
  const messages = buildCompanyAgentMessages(history);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1], { role: "user", content: "Привіт" });
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

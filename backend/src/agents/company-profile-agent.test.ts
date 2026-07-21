import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyProfileAgentMessages,
  buildHrCompanyProfileExtractionMessages,
  parseHrCompanyProfileExtraction,
} from "./company-profile-agent";
import { COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-profile-agent.uk";
import { HR_COMPANY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/hr-company-profile-extraction.uk";

test("buildCompanyProfileAgentMessages uses company profile system prompt", () => {
  const messages = buildCompanyProfileAgentMessages([]);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK);
  assert.equal(messages[1].role, "user");
});

test("buildCompanyProfileAgentMessages prepends system prompt and maps author types", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Привіт" },
    { authorType: "AGENT_COMPANY" as const, content: "Яка культура компанії?" },
  ];
  const messages = buildCompanyProfileAgentMessages(history);

  assert.deepEqual(messages[0], { role: "system", content: COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "Привіт" });
  assert.deepEqual(messages[2], { role: "assistant", content: "Яка культура компанії?" });
});

test("buildCompanyProfileAgentMessages appends a placeholder user turn for empty history", () => {
  const messages = buildCompanyProfileAgentMessages([]);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "(порожнє повідомлення)" });
});

test("buildCompanyProfileAgentMessages appends a placeholder user turn when history ends with the agent", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Привіт" },
    { authorType: "AGENT_COMPANY" as const, content: "Яка культура компанії?" },
  ];
  const messages = buildCompanyProfileAgentMessages(history);

  assert.equal(messages.length, 4);
  assert.deepEqual(messages[3], { role: "user", content: "(порожнє повідомлення)" });
});

test("buildCompanyProfileAgentMessages does not append a placeholder when history already ends with the user", () => {
  const history = [{ authorType: "HUMAN_HR" as const, content: "Привіт" }];
  const messages = buildCompanyProfileAgentMessages(history);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1], { role: "user", content: "Привіт" });
});

test("parseHrCompanyProfileExtraction parses companyName and all five universal fields", () => {
  const raw = JSON.stringify({
    companyName: "Acme Corp",
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
    onboardingApproach: ["Buddy 2 тижні"],
  });
  assert.deepEqual(parseHrCompanyProfileExtraction(raw), {
    companyName: "Acme Corp",
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
    onboardingApproach: ["Buddy 2 тижні"],
  });
});

test("parseHrCompanyProfileExtraction trims companyName", () => {
  const raw = JSON.stringify({
    companyName: "  SoftServe  ",
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
    onboardingApproach: ["Buddy 2 тижні"],
  });
  assert.equal(parseHrCompanyProfileExtraction(raw).companyName, "SoftServe");
});

test("parseHrCompanyProfileExtraction strips markdown code fences around JSON", () => {
  const raw = [
    "```json",
    JSON.stringify({
      companyName: "Acme Corp",
      culture: ["Відкритість"],
      companyDirection: ["EdTech"],
      policies: ["Remote-first"],
      workFormat: ["Гібрид"],
      onboardingApproach: ["Buddy 2 тижні"],
    }),
    "```",
  ].join("\n");
  const result = parseHrCompanyProfileExtraction(raw);
  assert.equal(result.companyName, "Acme Corp");
  assert.deepEqual(result.culture, ["Відкритість"]);
  assert.deepEqual(result.companyDirection, ["EdTech"]);
});

test("parseHrCompanyProfileExtraction throws when response is not valid JSON", () => {
  assert.throws(() => parseHrCompanyProfileExtraction("це не json, а звичайний текст"));
});

test("parseHrCompanyProfileExtraction throws when a required field is missing", () => {
  const raw = JSON.stringify({
    companyName: "Acme Corp",
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
  });
  assert.throws(() => parseHrCompanyProfileExtraction(raw));
});

test("parseHrCompanyProfileExtraction throws when companyName is missing", () => {
  const raw = JSON.stringify({
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
    onboardingApproach: ["Buddy 2 тижні"],
  });
  assert.throws(() => parseHrCompanyProfileExtraction(raw));
});

test("parseHrCompanyProfileExtraction throws when companyName is blank", () => {
  const raw = JSON.stringify({
    companyName: "   ",
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
    onboardingApproach: ["Buddy 2 тижні"],
  });
  assert.throws(() => parseHrCompanyProfileExtraction(raw));
});

test("buildHrCompanyProfileExtractionMessages prepends extraction system prompt and joins transcript as one user message", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Відкрита культура" },
    { authorType: "AGENT_COMPANY" as const, content: "Який напрямок компанії?" },
  ];
  const messages = buildHrCompanyProfileExtractionMessages(history);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: HR_COMPANY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK });
  assert.equal(messages[1].role, "user");
  assert.equal(
    messages[1].content,
    "HR: Відкрита культура\nАгент: Який напрямок компанії?"
  );
});

test("buildHrCompanyProfileExtractionMessages handles empty history with a placeholder transcript", () => {
  const messages = buildHrCompanyProfileExtractionMessages([]);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "(розмова порожня)");
});

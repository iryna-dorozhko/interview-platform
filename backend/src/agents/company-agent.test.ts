import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyAgentMessages,
  buildProfileExtractionMessages,
  parseVacancyProfileExtraction,
} from "./company-agent";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";
import { VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/vacancy-profile-extraction.uk";

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

test("company agent system prompt includes work conditions block with seven subtopics", () => {
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /умови роботи/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /зарплат/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /формат/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /графік/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /бенефіт/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /релокац/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /випробувальн/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /обладнан/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /чотир/i); // 4 themes
});

test("extraction prompt encodes workConditions and compensation", () => {
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /workConditions/i);
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /compensation/i);
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /displayText/i);
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /Формат:/);
});

test("parseVacancyProfileExtraction parses workConditions and compensation", () => {
  const raw = JSON.stringify({
    role: "Backend Developer",
    requirements: ["Node.js"],
    expectations: ["Ownership"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: 24 дні відпустки",
      "Релокація: не вказано",
      "Випробувальний: 3 місяці",
      "Обладнання: MacBook Pro",
    ],
    compensation: {
      min: 3000,
      max: 4500,
      currency: "USD",
      grossNet: "gross",
      displayText: "$3000–4500 gross, USD",
    },
  });
  const result = parseVacancyProfileExtraction(raw);
  assert.equal(result.workConditions.length, 6);
  assert.equal(result.compensation.displayText, "$3000–4500 gross, USD");
  assert.equal(result.compensation.min, 3000);
});

test("parseVacancyProfileExtraction parses structured critical/desired requirements", () => {
  const raw = JSON.stringify({
    role: "Backend Developer",
    requirements: { critical: ["Node.js"], desired: ["Docker"] },
    expectations: ["Ownership"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: не вказано",
      "Релокація: не вказано",
      "Випробувальний: не вказано",
      "Обладнання: не вказано",
    ],
    compensation: { displayText: "не вказано" },
  });
  const result = parseVacancyProfileExtraction(raw);
  assert.deepEqual(result.requirements, {
    critical: ["Node.js"],
    desired: ["Docker"],
  });
});

test("parseVacancyProfileExtraction rejects empty critical and desired", () => {
  const raw = JSON.stringify({
    role: "Backend Developer",
    requirements: { critical: [], desired: [] },
    expectations: ["Ownership"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: не вказано",
      "Релокація: не вказано",
      "Випробувальний: не вказано",
      "Обладнання: не вказано",
    ],
    compensation: { displayText: "не вказано" },
  });
  assert.throws(() => parseVacancyProfileExtraction(raw));
});

test("parseVacancyProfileExtraction parses vacancy-only fields", () => {
  const raw = JSON.stringify({
    role: "Middle Backend Developer",
    requirements: ["Node.js"],
    expectations: ["Перший реліз за місяць"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: не вказано",
      "Релокація: не вказано",
      "Випробувальний: не вказано",
      "Обладнання: не вказано",
    ],
    compensation: { displayText: "не вказано" },
  });
  const result = parseVacancyProfileExtraction(raw);
  assert.deepEqual(result, {
    role: "Middle Backend Developer",
    requirements: { critical: [], desired: ["Node.js"] },
    expectations: ["Перший реліз за місяць"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: не вказано",
      "Релокація: не вказано",
      "Випробувальний: не вказано",
      "Обладнання: не вказано",
    ],
    compensation: { displayText: "не вказано" },
  });
});

test("parseVacancyProfileExtraction strips markdown code fences around JSON", () => {
  const raw = [
    "```json",
    JSON.stringify({
      role: "QA Engineer",
      requirements: ["3+ роки"],
      expectations: ["не вказано"],
      workConditions: [
        "Формат: офіс",
        "Графік: повний день",
        "Бенефіти: не вказано",
        "Релокація: не вказано",
        "Випробувальний: не вказано",
        "Обладнання: не вказано",
      ],
      compensation: { displayText: "не вказано" },
    }),
    "```",
  ].join("\n");
  const result = parseVacancyProfileExtraction(raw);
  assert.equal(result.role, "QA Engineer");
  assert.deepEqual(result.requirements, { critical: [], desired: ["3+ роки"] });
});

test("parseVacancyProfileExtraction throws when response is not valid JSON", () => {
  assert.throws(() => parseVacancyProfileExtraction("це не json, а звичайний текст"));
});

test("parseVacancyProfileExtraction throws when a required field is missing", () => {
  const raw = JSON.stringify({ role: "Designer", requirements: ["Figma"] });
  assert.throws(() => parseVacancyProfileExtraction(raw));
});

test("parseVacancyProfileExtraction throws when role is empty", () => {
  const raw = JSON.stringify({
    role: "",
    requirements: ["Figma"],
    expectations: ["не вказано"],
    workConditions: [
      "Формат: не вказано",
      "Графік: не вказано",
      "Бенефіти: не вказано",
      "Релокація: не вказано",
      "Випробувальний: не вказано",
      "Обладнання: не вказано",
    ],
    compensation: { displayText: "не вказано" },
  });
  assert.throws(() => parseVacancyProfileExtraction(raw));
});

test("buildProfileExtractionMessages prepends extraction system prompt and joins transcript as one user message", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Middle Backend Developer" },
    { authorType: "AGENT_COMPANY" as const, content: "Які вимоги?" },
  ];
  const messages = buildProfileExtractionMessages(history);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK });
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

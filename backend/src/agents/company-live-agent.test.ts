import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import { buildCompanyLiveMessages, runCompanyLiveTurn } from "./company-live-agent";
import { COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-live-agent.uk";

const companyProfile = {
  role: "Backend Developer",
  requirements: ["Node.js", "PostgreSQL"],
  culture: ["remote-first"],
  expectations: ["ownership у перші 3 місяці"],
};

test("buildCompanyLiveMessages includes company profile and maps history", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Доброго дня!" },
    { authorType: "AGENT_ARBITER", content: "Давайте почнемо співбесіду." },
  ];

  const messages = buildCompanyLiveMessages({ companyProfile, history });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Backend Developer/);
  assert.match(messages[0].content, /Node\.js/);
  assert.ok(
    messages[0].content.includes(
      COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK.split("{{COMPANY_PROFILE}}")[0].trimEnd(),
    ),
  );
  assert.deepEqual(messages[1], { role: "user", content: "[HR] Доброго дня!" });
  assert.deepEqual(messages[2], { role: "assistant", content: "Давайте почнемо співбесіду." });
});

test("runCompanyLiveTurn loads profile, calls LLM, parses reply", async () => {
  const prisma = {
    interview: {
      findUnique: async () => ({
        vacancy: {
          companyProfile: {
            role: companyProfile.role,
            requirements: companyProfile.requirements,
            culture: companyProfile.culture,
            expectations: companyProfile.expectations,
          },
        },
      }),
    },
    liveMessage: {
      findMany: async () => [
        { authorType: "HUMAN_HR", content: "Доброго дня!" },
        { authorType: "AGENT_ARBITER", content: "Давайте почнемо співбесіду." },
      ],
    },
  } as unknown as PrismaClient;

  const provider: LlmProvider = {
    name: "test",
    complete: async () => '{ "post": true, "message": "Розкажіть про досвід з Node.js." }',
  };

  const result = await runCompanyLiveTurn(prisma, "interview_1", "session_1", provider);
  assert.equal(result.post, true);
  assert.equal(result.message, "Розкажіть про досвід з Node.js.");
});

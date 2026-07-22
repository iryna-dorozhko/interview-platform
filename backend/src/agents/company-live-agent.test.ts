import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import { LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";
import {
  buildCompanyLiveMessages,
  CompanyLiveContextError,
  formatCompanyTurnNudge,
  runCompanyLiveTurn,
} from "./company-live-agent";
import { COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-live-agent.uk";

const companyProfile = {
  role: "Backend Developer",
  requirements: ["Node.js", "PostgreSQL"],
  culture: ["remote-first"],
  expectations: ["ownership у перші 3 місяці"],
  workConditions: [] as string[],
  compensation: null as { displayText: string } | null,
};

test("company live prompt requires greeting on first message", () => {
  assert.match(COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK, /перше повідомлення|AGENT_COMPANY/i);
  assert.match(COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK, /привіт/i);
});

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

test("buildCompanyLiveMessages includes workConditions and compensation in profile block", () => {
  const messages = buildCompanyLiveMessages({
    companyProfile: {
      ...companyProfile,
      workConditions: ["Формат: remote"],
      compensation: { displayText: "$4000 gross" },
    },
    history: [],
  });
  assert.match(messages[0].content, /workConditions/);
  assert.match(messages[0].content, /remote/);
  assert.match(messages[0].content, /\$4000 gross/);
});

test("formatCompanyTurnNudge handles ANSWER_CANDIDATE", () => {
  const nudge = formatCompanyTurnNudge({ action: "ANSWER_CANDIDATE", briefUk: "Бенефіти" });
  assert.match(nudge, /ANSWER_CANDIDATE/);
  assert.match(nudge, /Бенефіти/);
});

test("buildCompanyLiveMessages appends turnContext nudge", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_CANDIDATE", content: "Працював з Node.js." },
  ];

  const messages = buildCompanyLiveMessages({
    companyProfile,
    history,
    turnContext: { action: "CLARIFY", briefUk: "Уточни глибину PostgreSQL" },
  });

  assert.equal(
    messages.at(-1)?.content,
    formatCompanyTurnNudge({ action: "CLARIFY", briefUk: "Уточни глибину PostgreSQL" }),
  );
  assert.match(messages.at(-1)!.content, /CLARIFY/);
  assert.match(messages.at(-1)!.content, /PostgreSQL/);
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
            workConditions: [],
            compensation: null,
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
    complete: async (messages) => {
      assert.match(messages.at(-1)!.content, /NEXT_QUESTION/);
      return '{ "post": true, "message": "Розкажіть про досвід з Node.js." }';
    },
  };

  const result = await runCompanyLiveTurn(prisma, "interview_1", "session_1", provider, {
    action: "NEXT_QUESTION",
  });
  assert.equal(result.post, true);
  assert.equal(result.message, "Розкажіть про досвід з Node.js.");
});

test("runCompanyLiveTurn throws when company profile is missing without calling LLM", async () => {
  let completeCalls = 0;
  const prisma = {
    interview: {
      findUnique: async () => ({ vacancy: { companyProfile: null } }),
    },
  } as unknown as PrismaClient;

  const provider: LlmProvider = {
    name: "test",
    complete: async () => {
      completeCalls += 1;
      return "";
    },
  };

  await assert.rejects(
    () => runCompanyLiveTurn(prisma, "interview_1", "session_1", provider),
    (err: unknown) => {
      assert.ok(err instanceof CompanyLiveContextError);
      return true;
    },
  );
  assert.equal(completeCalls, 0);
});

test("runCompanyLiveTurn retries transient LLM failure then succeeds", async () => {
  let completeCalls = 0;
  const prisma = {
    interview: {
      findUnique: async () => ({
        vacancy: {
          companyProfile: {
            role: companyProfile.role,
            requirements: companyProfile.requirements,
            culture: companyProfile.culture,
            expectations: companyProfile.expectations,
            workConditions: [],
            compensation: null,
          },
        },
      }),
    },
    liveMessage: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;

  const provider: LlmProvider = {
    name: "test",
    complete: async () => {
      completeCalls += 1;
      if (completeCalls === 1) {
        throw new LlmUnavailableError("temporary outage");
      }
      return '{ "post": true, "message": "Яке ваше питання?" }';
    },
  };

  const result = await runCompanyLiveTurn(prisma, "interview_1", "session_1", provider, {
    action: "NEXT_QUESTION",
  });

  assert.equal(completeCalls, 2);
  assert.equal(result.post, true);
  assert.equal(result.message, "Яке ваше питання?");
});

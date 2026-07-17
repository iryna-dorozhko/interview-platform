import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import {
  ANSWER_NUDGE_UK,
  buildCandidateLiveMessages,
  CANDIDATE_QUESTIONS_NUDGE_UK,
  COMPANY_QUESTION_NUDGE_UK,
  formatCandidateTurnNudge,
  runCandidateLiveTurn,
} from "./candidate-live-agent";
import { CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-live-agent.uk";

const candidateProfile = {
  summary: "5 років досвіду з Node.js",
  experience: ["Acme Corp — backend 3 роки"],
  skills: { strong: ["TypeScript", "PostgreSQL"], growth: ["DevOps"] },
  goals: ["senior backend role"],
};

test("buildCandidateLiveMessages includes candidate profile and HR/Company prefixes", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід з Node.js." },
  ];

  const messages = buildCandidateLiveMessages({ candidateProfile, history });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /5 років досвіду/);
  assert.match(messages[0].content, /AI-представник кандидата/i);
  assert.ok(
    messages[0].content.includes(
      CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK.split("{{CANDIDATE_PROFILE}}")[0].trimEnd(),
    ),
  );
  assert.deepEqual(messages[1], { role: "assistant", content: "Розкажіть про досвід з Node.js." });
});

test("buildCandidateLiveMessages appends nudge when last message is from Company Agent", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Почнемо?" },
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід з Node.js." },
  ];

  const messages = buildCandidateLiveMessages({ candidateProfile, history });

  assert.equal(messages.at(-1)?.role, "user");
  assert.equal(messages.at(-1)?.content, COMPANY_QUESTION_NUDGE_UK);
});

test("buildCandidateLiveMessages does not append company nudge when candidate already replied", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід?" },
    { authorType: "AGENT_CANDIDATE", content: "Я працював з Node.js 5 років." },
  ];

  const messages = buildCandidateLiveMessages({ candidateProfile, history });

  assert.equal(messages.at(-1)?.role, "assistant");
});

test("buildCandidateLiveMessages uses turnContext ANSWER nudge", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Який стек?" },
  ];

  const messages = buildCandidateLiveMessages({
    candidateProfile,
    history,
    turnContext: { action: "ANSWER", briefUk: "Стек з профілю" },
  });

  assert.equal(
    messages.at(-1)?.content,
    formatCandidateTurnNudge({ action: "ANSWER", briefUk: "Стек з профілю" }),
  );
  assert.match(messages.at(-1)!.content, new RegExp(ANSWER_NUDGE_UK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("buildCandidateLiveMessages uses CANDIDATE_QUESTIONS nudge", () => {
  const messages = buildCandidateLiveMessages({
    candidateProfile,
    history: [],
    turnContext: { action: "CANDIDATE_QUESTIONS" },
  });

  assert.equal(messages.at(-1)?.content, CANDIDATE_QUESTIONS_NUDGE_UK);
});

test("candidate live prompt requires third person and three ANSWER modes", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /трет(я|ій) особ/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /підтверд/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /needsHuman:\s*true/);
  assert.doesNotMatch(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /Відповідай від імені кандидата \(перша особа/,
  );
  assert.doesNotMatch(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /Я не знаю відповіді з профілю\. Ірино, дай відповідь сама\./,
  );
});

test("candidate live prompt forbids repeating information from chat history", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /без повтор/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /AGENT_CANDIDATE/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /HUMAN_CANDIDATE/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /лише нові для чату/i);
});

test("ANSWER nudge mentions third person and confirmation deferral", () => {
  assert.match(ANSWER_NUDGE_UK, /про кандидата|трет/i);
  assert.match(ANSWER_NUDGE_UK, /needsHuman:true/);
  assert.match(ANSWER_NUDGE_UK, /підтверд|доповн/i);
  assert.match(ANSWER_NUDGE_UK, /не дублюй/i);
});

test("company and candidate question nudges discourage repetition", () => {
  assert.match(COMPANY_QUESTION_NUDGE_UK, /Не повторюй/i);
  assert.match(CANDIDATE_QUESTIONS_NUDGE_UK, /нове питання/i);
});

test("runCandidateLiveTurn loads profile, calls LLM, parses reply", async () => {
  const prisma = {
    interview: {
      findUnique: async () => ({
        candidateProfile: {
          summary: candidateProfile.summary,
          experience: candidateProfile.experience,
          skills: candidateProfile.skills,
          goals: candidateProfile.goals,
        },
      }),
    },
    liveMessage: {
      findMany: async () => [
        { authorType: "HUMAN_HR", content: "Який ваш досвід з Node.js?" },
      ],
    },
  } as unknown as PrismaClient;

  const provider: LlmProvider = {
    name: "test",
    complete: async (messages) => {
      assert.match(messages.at(-1)!.content, /ANSWER/);
      return '{ "post": true, "message": "Я працював з Node.js понад 5 років." }';
    },
  };

  const result = await runCandidateLiveTurn(prisma, "interview_1", "session_1", provider, {
    action: "ANSWER",
  });
  assert.equal(result.post, true);
  assert.equal(result.message, "Я працював з Node.js понад 5 років.");
});

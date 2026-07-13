import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import { buildCandidateLiveMessages, runCandidateLiveTurn } from "./candidate-live-agent";
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
  assert.match(messages[0].content, /відповідати на питання Company Agent або HR/i);
  assert.ok(
    messages[0].content.includes(
      CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK.split("{{CANDIDATE_PROFILE}}")[0].trimEnd(),
    ),
  );
  assert.deepEqual(messages[1], { role: "assistant", content: "Розкажіть про досвід з Node.js." });
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
    complete: async () =>
      '{ "post": true, "message": "Я працював з Node.js понад 5 років." }',
  };

  const result = await runCandidateLiveTurn(prisma, "interview_1", "session_1", provider);
  assert.equal(result.post, true);
  assert.equal(result.message, "Я працював з Node.js понад 5 років.");
});

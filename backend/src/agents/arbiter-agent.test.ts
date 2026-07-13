import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import {
  ArbiterReplyParseError,
  buildArbiterMessages,
  parseArbiterReply,
  runArbiterTurn,
} from "./arbiter-agent";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";

const companyProfile = {
  role: "Backend Developer",
  requirements: ["Node.js", "PostgreSQL"],
  culture: ["remote-first"],
  expectations: ["ownership"],
};

const candidateProfile = {
  summary: "5 років досвіду",
  experience: ["Acme Corp"],
  skills: { strong: ["TypeScript"], growth: ["DevOps"] },
  goals: ["senior role"],
};

test("arbiter prompt includes interview start and end guidance", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /сигнал початку співбесіди/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /запропонувати завершення/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /Company Agent|Candidate Agent/i);
});

test("parseArbiterReply parses post:false", () => {
  const result = parseArbiterReply('{ "post": false }');
  assert.equal(result.post, false);
  assert.equal(result.message, undefined);
});

test("parseArbiterReply parses post:true with message", () => {
  const result = parseArbiterReply('{ "post": true, "message": "Продовжуйте тему досвіду." }');
  assert.equal(result.post, true);
  assert.equal(result.message, "Продовжуйте тему досвіду.");
});

test("parseArbiterReply strips markdown code fences", () => {
  const raw = "```json\n{ \"post\": false }\n```";
  const result = parseArbiterReply(raw);
  assert.equal(result.post, false);
});

test("parseArbiterReply throws on invalid JSON", () => {
  assert.throws(() => parseArbiterReply("not json"), ArbiterReplyParseError);
});

test("parseArbiterReply throws when post:true but message is empty", () => {
  assert.throws(
    () => parseArbiterReply('{ "post": true, "message": "   " }'),
    ArbiterReplyParseError,
  );
});

test("parseArbiterReply throws when post field is missing", () => {
  assert.throws(() => parseArbiterReply('{ "message": "hi" }'), ArbiterReplyParseError);
});

test("buildArbiterMessages includes profiles in system prompt and maps history", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Розкажіть про досвід." },
    { authorType: "HUMAN_CANDIDATE", content: "Працював з Node.js." },
    { authorType: "AGENT_ARBITER", content: "Короткий підсумок." },
  ];

  const messages = buildArbiterMessages({ companyProfile, candidateProfile, history });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Backend Developer/);
  assert.match(messages[0].content, /5 років досвіду/);
  assert.ok(
    messages[0].content.includes(
      ARBITER_AGENT_SYSTEM_PROMPT_UK.split("{{COMPANY_PROFILE}}")[0].trimEnd(),
    ),
  );

  assert.deepEqual(messages[1], { role: "user", content: "[HR] Розкажіть про досвід." });
  assert.deepEqual(messages[2], { role: "user", content: "[Кандидат] Працював з Node.js." });
  assert.deepEqual(messages[3], { role: "assistant", content: "Короткий підсумок." });
});

test("runArbiterTurn loads context, calls LLM, and parses reply", async () => {
  let llmCalled = false;
  const fakeProvider: LlmProvider = {
    name: "fake",
    async complete(messages) {
      llmCalled = true;
      assert.equal(messages[0].role, "system");
      assert.match(messages[0].content, /Backend Developer/);
      assert.equal(messages.at(-1)?.content, "[HR] Привіт");
      return '{ "post": true, "message": "Продовжуйте." }';
    },
  };

  const fakePrisma = {
    interview: {
      findUnique: async () => ({
        vacancy: {
          companyProfile: {
            role: "Backend Developer",
            requirements: ["Node.js"],
            culture: ["remote"],
            expectations: ["ship features"],
          },
        },
        candidateProfile: {
          summary: "5 років",
          experience: ["Acme"],
          skills: { strong: ["TS"], growth: [] },
          goals: ["grow"],
        },
      }),
    },
    liveMessage: {
      findMany: async () => [{ authorType: "HUMAN_HR", content: "Привіт" }],
    },
  } as unknown as PrismaClient;

  const result = await runArbiterTurn(fakePrisma, "interview_1", "session_1", fakeProvider);

  assert.equal(llmCalled, true);
  assert.deepEqual(result, { post: true, message: "Продовжуйте." });
});

test("runArbiterTurn throws when profiles are missing", async () => {
  const fakePrisma = {
    interview: {
      findUnique: async () => ({ vacancy: { companyProfile: null }, candidateProfile: null }),
    },
  } as unknown as PrismaClient;

  const fakeProvider: LlmProvider = { name: "fake", complete: async () => "" };

  await assert.rejects(
    () => runArbiterTurn(fakePrisma, "interview_1", "session_1", fakeProvider),
    /Missing profiles/,
  );
});

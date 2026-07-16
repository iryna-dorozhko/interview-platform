import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import {
  ArbiterReplyParseError,
  NO_PENDING_QUESTION_NUDGE_UK,
  PENDING_QUESTION_NUDGE_UK,
  buildArbiterMessages,
  parseArbiterCommand,
  runArbiterTurn,
} from "./arbiter-agent";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";

const companyProfile = {
  role: "Backend Developer",
  requirements: ["Node.js", "PostgreSQL"],
  culture: ["remote-first"],
  expectations: ["ownership"],
};

test("arbiter prompt includes conductor actions and start/end guidance", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /START/);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /ANSWER/);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /NEXT_QUESTION/);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /CLARIFY/);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /CANDIDATE_QUESTIONS/);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /SUGGEST_END/);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /Company Agent|Candidate/i);
});

test("parseArbiterCommand parses WAIT", () => {
  const result = parseArbiterCommand(
    '{ "action": "WAIT", "summaryUk": "Розмова йде природно." }',
  );
  assert.deepEqual(result, {
    action: "WAIT",
    summaryUk: "Розмова йде природно.",
  });
});

test("parseArbiterCommand parses ANSWER with briefUk", () => {
  const result = parseArbiterCommand(
    '{ "action": "ANSWER", "summaryUk": "Передано Candidate", "briefUk": "Досвід з Node.js" }',
  );
  assert.equal(result.action, "ANSWER");
  assert.equal(result.briefUk, "Досвід з Node.js");
});

test("parseArbiterCommand parses START with publicMessage", () => {
  const result = parseArbiterCommand(
    '{ "action": "START", "summaryUk": "Старт", "publicMessage": "Давайте почнемо співбесіду." }',
  );
  assert.equal(result.action, "START");
  assert.equal(result.publicMessage, "Давайте почнемо співбесіду.");
});

test("parseArbiterCommand strips markdown code fences", () => {
  const raw =
    '```json\n{ "action": "WAIT", "summaryUk": "Очікуємо" }\n```';
  const result = parseArbiterCommand(raw);
  assert.equal(result.action, "WAIT");
});

test("parseArbiterCommand throws on invalid JSON", () => {
  assert.throws(() => parseArbiterCommand("not json"), ArbiterReplyParseError);
});

test("parseArbiterCommand throws when summaryUk is empty", () => {
  assert.throws(
    () => parseArbiterCommand('{ "action": "WAIT", "summaryUk": "   " }'),
    ArbiterReplyParseError,
  );
});

test("parseArbiterCommand throws when START lacks publicMessage", () => {
  assert.throws(
    () => parseArbiterCommand('{ "action": "START", "summaryUk": "Старт" }'),
    ArbiterReplyParseError,
  );
});

test("parseArbiterCommand throws on unknown action", () => {
  assert.throws(
    () => parseArbiterCommand('{ "action": "NOPE", "summaryUk": "x" }'),
    ArbiterReplyParseError,
  );
});

test("buildArbiterMessages includes pendingQuestion nudge", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Розкажіть про досвід." },
  ];

  const withPending = buildArbiterMessages({
    companyProfile,
    history,
    pendingQuestion: true,
  });
  assert.equal(withPending.at(-1)?.content, PENDING_QUESTION_NUDGE_UK);

  const withoutPending = buildArbiterMessages({
    companyProfile,
    history,
    pendingQuestion: false,
  });
  assert.equal(withoutPending.at(-1)?.content, NO_PENDING_QUESTION_NUDGE_UK);
  assert.match(withoutPending[0].content, /Backend Developer/);
});

test("runArbiterTurn loads context, calls LLM, and parses command", async () => {
  let llmCalled = false;
  const fakeProvider: LlmProvider = {
    name: "fake",
    async complete(messages, options) {
      llmCalled = true;
      assert.equal(messages[0].role, "system");
      assert.match(messages[0].content, /Backend Developer/);
      assert.equal(messages.at(-1)?.content, PENDING_QUESTION_NUDGE_UK);
      assert.deepEqual(options, { maxTokens: 256, temperature: 0 });
      return '{ "action": "ANSWER", "summaryUk": "Відповісти", "briefUk": "Node.js" }';
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
      }),
    },
    liveMessage: {
      findMany: async () => [{ authorType: "HUMAN_HR", content: "Привіт" }],
    },
  } as unknown as PrismaClient;

  const result = await runArbiterTurn(
    fakePrisma,
    "interview_1",
    "session_1",
    fakeProvider,
    { pendingQuestion: true },
  );

  assert.equal(llmCalled, true);
  assert.deepEqual(result, {
    action: "ANSWER",
    summaryUk: "Відповісти",
    briefUk: "Node.js",
  });
});

test("runArbiterTurn throws when company profile is missing", async () => {
  const fakePrisma = {
    interview: {
      findUnique: async () => ({ vacancy: { companyProfile: null } }),
    },
  } as unknown as PrismaClient;

  const fakeProvider: LlmProvider = { name: "fake", complete: async () => "" };

  await assert.rejects(
    () => runArbiterTurn(fakePrisma, "interview_1", "session_1", fakeProvider),
    /Missing company profile/,
  );
});

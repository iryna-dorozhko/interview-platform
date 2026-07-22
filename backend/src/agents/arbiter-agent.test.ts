import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import { LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";
import {
  ArbiterContextError,
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
  workConditions: [] as string[],
  compensation: null as { displayText: string } | null,
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

test("arbiter prompt waits for HR start signal before START", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /явн.*HR.*початок/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /привітайся.*Arbiter|Arbiter.*привіт/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /WAIT.*привіт/i);
});

test("arbiter prompt waits only after unknown confidence deferral", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /unknown|немає даних|відповісти/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /inferred/i);
  assert.doesNotMatch(
    ARBITER_AGENT_SYSTEM_PROMPT_UK,
    /припущення.*підтверд.*WAIT/s,
  );
});

test("arbiter prompt routes human-to-candidate-agent address as ANSWER", () => {
  assert.match(
    ARBITER_AGENT_SYSTEM_PROMPT_UK,
    /HUMAN_CANDIDATE|людин.*кандидат|кандидат.*людин/i,
  );
  assert.match(
    ARBITER_AGENT_SYSTEM_PROMPT_UK,
    /зверт.*(Candidate|агент)|агент.*кандидат.*ANSWER|ANSWER.*агент/i,
  );
  assert.match(PENDING_QUESTION_NUDGE_UK, /зверт|агент.*кандидат|Candidate Agent/i);
});

test("arbiter system prompt includes COMPANY_ANSWER", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /COMPANY_ANSWER/);
});

test("parseArbiterCommand parses COMPANY_ANSWER", () => {
  const result = parseArbiterCommand(
    '{ "action": "COMPANY_ANSWER", "summaryUk": "Company відповість", "briefUk": "Зарплата" }',
  );
  assert.equal(result.action, "COMPANY_ANSWER");
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
            workConditions: [],
            compensation: null,
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
  let completeCalls = 0;
  const fakePrisma = {
    interview: {
      findUnique: async () => ({ vacancy: { companyProfile: null } }),
    },
  } as unknown as PrismaClient;

  const fakeProvider: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      return "";
    },
  };

  await assert.rejects(
    () => runArbiterTurn(fakePrisma, "interview_1", "session_1", fakeProvider),
    (err: unknown) => {
      assert.ok(err instanceof ArbiterContextError);
      assert.match(err.message, /Missing company profile/);
      return true;
    },
  );
  assert.equal(completeCalls, 0);
});

test("runArbiterTurn retries transient LLM failure then succeeds", async () => {
  let completeCalls = 0;
  const fakePrisma = {
    interview: {
      findUnique: async () => ({
        vacancy: {
          companyProfile: {
            role: "Backend Developer",
            requirements: ["Node.js"],
            culture: ["remote"],
            expectations: ["ship features"],
            workConditions: [],
            compensation: null,
          },
        },
      }),
    },
    liveMessage: {
      findMany: async () => [{ authorType: "HUMAN_HR", content: "Привіт" }],
    },
  } as unknown as PrismaClient;

  const fakeProvider: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      if (completeCalls === 1) {
        throw new LlmUnavailableError("temporary outage");
      }
      return '{ "action": "WAIT", "summaryUk": "Очікуємо" }';
    },
  };

  const result = await runArbiterTurn(
    fakePrisma,
    "interview_1",
    "session_1",
    fakeProvider,
  );

  assert.equal(completeCalls, 2);
  assert.deepEqual(result, { action: "WAIT", summaryUk: "Очікуємо" });
});

test("runArbiterTurn retries parse failure then succeeds", async () => {
  let completeCalls = 0;
  const fakePrisma = {
    interview: {
      findUnique: async () => ({
        vacancy: {
          companyProfile: {
            role: "Backend Developer",
            requirements: ["Node.js"],
            culture: ["remote"],
            expectations: ["ship features"],
            workConditions: [],
            compensation: null,
          },
        },
      }),
    },
    liveMessage: {
      findMany: async () => [{ authorType: "HUMAN_HR", content: "Привіт" }],
    },
  } as unknown as PrismaClient;

  const fakeProvider: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      if (completeCalls === 1) return "not-json";
      return '{ "action": "WAIT", "summaryUk": "Очікуємо" }';
    },
  };

  const result = await runArbiterTurn(
    fakePrisma,
    "interview_1",
    "session_1",
    fakeProvider,
  );

  assert.equal(completeCalls, 2);
  assert.equal(result.action, "WAIT");
});

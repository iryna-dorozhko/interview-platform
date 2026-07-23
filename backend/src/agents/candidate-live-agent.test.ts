import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import { LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";
import {
  ANSWER_NUDGE_UK,
  buildCandidateLiveMessages,
  CANDIDATE_QUESTIONS_NUDGE_UK,
  CandidateLiveContextError,
  CandidateLiveReplyParseError,
  collectOpenInterviewerQuestions,
  collectRecentInterviewerQuestions,
  COMPANY_QUESTION_NUDGE_UK,
  formatCandidateTurnNudge,
  parseCandidateLiveReply,
  runCandidateLiveTurn,
} from "./candidate-live-agent";
import { CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-live-agent.uk";

test("parseCandidateLiveReply maps confidence to needsHuman", () => {
  const confirmed = parseCandidateLiveReply(
    '{ "post": true, "message": "Кандидат має досвід.", "confidence": "confirmed" }',
    { requireConfidence: true },
  );
  assert.equal(confirmed.confidence, "confirmed");
  assert.equal(confirmed.needsHuman, false);

  const inferred = parseCandidateLiveReply(
    '{ "post": true, "message": "З анкети видно…", "confidence": "inferred" }',
    { requireConfidence: true },
  );
  assert.equal(inferred.confidence, "inferred");
  assert.equal(inferred.needsHuman, false);

  const unknown = parseCandidateLiveReply(
    '{ "post": true, "message": "Ірино, відповідай сама.", "confidence": "unknown" }',
    { requireConfidence: true },
  );
  assert.equal(unknown.confidence, "unknown");
  assert.equal(unknown.needsHuman, true);
});

test("parseCandidateLiveReply requires confidence when requireConfidence is true", () => {
  assert.throws(
    () =>
      parseCandidateLiveReply('{ "post": true, "message": "Без confidence." }', {
        requireConfidence: true,
      }),
    CandidateLiveReplyParseError,
  );
});

test("parseCandidateLiveReply ignores needsHuman from LLM JSON", () => {
  const result = parseCandidateLiveReply(
    '{ "post": true, "message": "Текст.", "confidence": "inferred", "needsHuman": true }',
    { requireConfidence: true },
  );
  assert.equal(result.needsHuman, false);
});

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
  assert.match(messages.at(-1)?.content ?? "", new RegExp(COMPANY_QUESTION_NUDGE_UK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(messages.at(-1)?.content ?? "", /Розкажіть про досвід з Node\.js\./);
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
    formatCandidateTurnNudge({ action: "ANSWER", briefUk: "Стек з профілю" }, history),
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

test("candidate live prompt requires greeting on first message", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /перше повідомлення|AGENT_CANDIDATE/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /привіт/i);
});

test("candidate live prompt requires third person", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /трет(я|ій) особ/i);
  assert.doesNotMatch(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /Відповідай від імені кандидата \(перша особа/,
  );
  assert.doesNotMatch(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /Я не знаю відповіді з профілю\. Ірино, дай відповідь сама\./,
  );
});

test("candidate live prompt defines three confidence levels", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /confidence.*confirmed/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /inferred/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /unknown/i);
  assert.doesNotMatch(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /needsHuman:\s*true/);
});

test("candidate live prompt forbids repeating information from chat history", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /без повтор/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /AGENT_CANDIDATE/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /HUMAN_CANDIDATE/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /лише нові для чату/i);
});

test("ANSWER nudge references confidence not needsHuman", () => {
  assert.match(ANSWER_NUDGE_UK, /confidence/i);
  assert.doesNotMatch(ANSWER_NUDGE_UK, /needsHuman:true/);
  assert.match(ANSWER_NUDGE_UK, /про кандидата|трет/i);
  assert.match(ANSWER_NUDGE_UK, /не дублюй/i);
});

test("company and candidate question nudges discourage repetition", () => {
  assert.match(COMPANY_QUESTION_NUDGE_UK, /confidence/i);
  assert.match(COMPANY_QUESTION_NUDGE_UK, /Не перефразовуй/i);
  assert.match(CANDIDATE_QUESTIONS_NUDGE_UK, /нове питання/i);
});

test("candidate live prompt forbids duplicating Company Agent questions", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /AGENT_COMPANY/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /не (дублюй|повторюй|перефраз)/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /питан/i);
});

test("ANSWER nudge forbids echoing questions", () => {
  assert.match(ANSWER_NUDGE_UK, /Не перефразовуй/i);
  assert.match(ANSWER_NUDGE_UK, /не дублюй/i);
});

test("collectRecentInterviewerQuestions returns Company and HR messages", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід з Node.js." },
    { authorType: "AGENT_CANDIDATE", content: "Кандидат має 5 років досвіду." },
    { authorType: "HUMAN_HR", content: "Як ви підходите до code review?" },
  ];

  assert.deepEqual(collectRecentInterviewerQuestions(history), [
    "Розкажіть про досвід з Node.js.",
    "Як ви підходите до code review?",
  ]);
});

test("collectOpenInterviewerQuestions returns Company+HR after last candidate reply", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Старий питання про Node." },
    { authorType: "AGENT_CANDIDATE", content: "Кандидат має досвід з Node." },
    { authorType: "AGENT_COMPANY", content: "Як організовуєте інтеграцію з REST API?" },
    { authorType: "HUMAN_HR", content: "Над якими проектами ви працювали?" },
  ];

  assert.deepEqual(collectOpenInterviewerQuestions(history), [
    "Як організовуєте інтеграцію з REST API?",
    "Над якими проектами ви працювали?",
  ]);
});

test("collectOpenInterviewerQuestions ignores interviewer messages before last candidate reply", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Почнемо?" },
    { authorType: "AGENT_COMPANY", content: "Розкажіть про Vue." },
    { authorType: "HUMAN_CANDIDATE", content: "Працювала з Vue 3 роки." },
    { authorType: "AGENT_COMPANY", content: "А з Pinia?" },
  ];

  assert.deepEqual(collectOpenInterviewerQuestions(history), ["А з Pinia?"]);
});

test("collectOpenInterviewerQuestions returns all interviewer messages when candidate never spoke", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Перше питання." },
    { authorType: "HUMAN_HR", content: "Уточнення від HR." },
  ];

  assert.deepEqual(collectOpenInterviewerQuestions(history), [
    "Перше питання.",
    "Уточнення від HR.",
  ]);
});

test("buildCandidateLiveMessages lists Company questions in ANSWER nudge", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід з Node.js." },
  ];

  const messages = buildCandidateLiveMessages({
    candidateProfile,
    history,
    turnContext: { action: "ANSWER", briefUk: "Node.js" },
  });

  assert.match(messages.at(-1)!.content, /Розкажіть про досвід з Node\.js\./);
  assert.match(messages.at(-1)!.content, /Відкриті питання|на всі|в одному повідомленні/i);
});

test("ANSWER nudge lists only open questions and instructs answering all", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Старий питання про Node." },
    { authorType: "AGENT_CANDIDATE", content: "Кандидат має досвід з Node." },
    { authorType: "AGENT_COMPANY", content: "Як організовуєте інтеграцію з REST API?" },
    { authorType: "HUMAN_HR", content: "Над якими проектами ви працювали?" },
  ];

  const nudge = formatCandidateTurnNudge({ action: "ANSWER", briefUk: "REST і проєкти" }, history);

  assert.match(nudge, /Відкриті питання/i);
  assert.match(nudge, /на всі|в одному повідомленні/i);
  assert.match(nudge, /REST API/);
  assert.match(nudge, /проектами/);
  assert.doesNotMatch(nudge, /Старий питання про Node/);
});

test("buildCandidateLiveMessages ANSWER nudge uses open questions after interrupt", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_CANDIDATE", content: "Кандидат уже відповів раніше." },
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід з Node.js." },
    { authorType: "HUMAN_HR", content: "Як ви підходите до code review?" },
  ];

  const messages = buildCandidateLiveMessages({
    candidateProfile,
    history,
    turnContext: { action: "ANSWER", briefUk: "Node і review" },
  });

  const nudge = messages.at(-1)!.content;
  assert.match(nudge, /Розкажіть про досвід з Node\.js\./);
  assert.match(nudge, /code review/);
  assert.match(nudge, /на всі|в одному повідомленні/i);
});

test("buildCandidateLiveMessages lists Company questions in CANDIDATE_QUESTIONS nudge", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Який у вас досвід з Docker?" },
    { authorType: "AGENT_CANDIDATE", content: "Кандидат працював з Docker у production." },
  ];

  const messages = buildCandidateLiveMessages({
    candidateProfile,
    history,
    turnContext: { action: "CANDIDATE_QUESTIONS" },
  });

  assert.match(messages.at(-1)!.content, /Який у вас досвід з Docker\?/);
  assert.match(messages.at(-1)!.content, /не дублюй|не повторюй|не перефраз/i);
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
      return '{ "post": true, "message": "Кандидат має 5 років досвіду.", "confidence": "confirmed" }';
    },
  };

  const result = await runCandidateLiveTurn(prisma, "interview_1", "session_1", provider, {
    action: "ANSWER",
  });
  assert.equal(result.post, true);
  assert.equal(result.message, "Кандидат має 5 років досвіду.");
  assert.equal(result.confidence, "confirmed");
  assert.equal(result.needsHuman, false);
});

test("runCandidateLiveTurn throws when interview is missing without calling LLM", async () => {
  let completeCalls = 0;
  const prisma = {
    interview: {
      findUnique: async () => null,
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
    () => runCandidateLiveTurn(prisma, "interview_1", "session_1", provider),
    (err: unknown) => {
      assert.ok(err instanceof CandidateLiveContextError);
      return true;
    },
  );
  assert.equal(completeCalls, 0);
});

test("runCandidateLiveTurn retries transient LLM failure then succeeds", async () => {
  let completeCalls = 0;
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
      return '{ "post": true, "message": "Кандидат готовий.", "confidence": "confirmed" }';
    },
  };

  const result = await runCandidateLiveTurn(prisma, "interview_1", "session_1", provider, {
    action: "ANSWER",
  });

  assert.equal(completeCalls, 2);
  assert.equal(result.message, "Кандидат готовий.");
  assert.equal(result.confidence, "confirmed");
});

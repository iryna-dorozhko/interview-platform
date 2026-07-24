import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "socket.io";
import type { LiveMessage, PrismaClient } from "@prisma/client";
import type { ParsedArbiterCommand } from "../agents/arbiter-agent";
import { createRoomOrchestrator } from "./orchestrator";

type Emitted = { event: string; room: string; payload: unknown };

function makeIo(): { io: Server; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, room, payload });
      },
    }),
  } as unknown as Server;
  return { io, emitted };
}

function makePrisma(messages: LiveMessage[], interviewStatus: "LIVE" | "READY" = "LIVE") {
  let createCount = 0;
  return {
    interview: {
      findUnique: async () => ({ status: interviewStatus }),
    },
    liveMessage: {
      create: async ({
        data,
      }: {
        data: {
          sessionId: string;
          authorType: string;
          content: string;
          candidateConfidence?: string | null;
        };
      }) => {
        createCount += 1;
        const created = {
          id: `agent_${createCount}`,
          sessionId: data.sessionId,
          authorType: data.authorType as LiveMessage["authorType"],
          content: data.content,
          candidateConfidence: data.candidateConfidence ?? null,
          createdAt: new Date(),
        } as LiveMessage;
        messages.push(created);
        return created;
      },
    },
  } as unknown as PrismaClient;
}

function cmd(partial: ParsedArbiterCommand): ParsedArbiterCommand {
  return partial;
}

test("orchestrator COMPANY_ANSWER runs company with ANSWER_CANDIDATE", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterCalls = 0;
  let companyCalls = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 4,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      if (arbiterCalls === 1) {
        return cmd({
          action: "COMPANY_ANSWER",
          summaryUk: "Company відповість",
          briefUk: "Зарплата",
        });
      }
      return cmd({ action: "WAIT", summaryUk: "Чекаємо" });
    },
    runCompanyLiveTurn: async (_i, _s, turnContext) => {
      companyCalls += 1;
      assert.equal(turnContext.action, "ANSWER_CANDIDATE");
      assert.equal(turnContext.briefUk, "Зарплата");
      return { post: true, message: "Зарплата — $4000 gross." };
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return { post: false };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 100));

  const processEvents = emitted.filter((e) => e.event === "room:arbiter-process");
  assert.ok(processEvents.length >= 1);
  assert.equal(
    (processEvents[0].payload as { action: string }).action,
    "COMPANY_ANSWER",
  );

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 1);
  assert.equal(
    (agentMessages[0].payload as { messages: Array<{ authorType: string; content: string }> })
      .messages[0].authorType,
    "AGENT_COMPANY",
  );
  assert.equal(companyCalls, 1);
  assert.equal(candidateCalls, 0);
  assert.ok(arbiterCalls >= 2);
});

test("orchestrator onLiveStart does not schedule agents", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      return cmd({ action: "START", summaryUk: "Старт", publicMessage: "Почнемо." });
    },
  });

  orchestrator.onLiveStart(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(arbiterCalls, 0);
  assert.equal(emitted.filter((e) => e.event === "room:arbiter-process").length, 0);
});

test("orchestrator START posts arbiter, runs company, emits process", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Давайте почнемо співбесіду.",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterCalls = 0;
  let companyCalls = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 4,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      if (arbiterCalls === 1) {
        return cmd({
          action: "START",
          summaryUk: "Початок співбесіди",
          publicMessage: "Вітаю! Я Arbiter — модерую хід співбесіди. Давайте почнемо.",
        });
      }
      return cmd({ action: "WAIT", summaryUk: "Чекаємо відповіді" });
    },
    runCompanyLiveTurn: async (_i, _s, turnContext) => {
      companyCalls += 1;
      assert.equal(turnContext.action, "NEXT_QUESTION");
      return { post: true, message: "Розкажіть про досвід з Node.js." };
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return { post: false };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 100));

  const processEvents = emitted.filter((e) => e.event === "room:arbiter-process");
  assert.ok(processEvents.length >= 1);
  assert.equal(
    (processEvents[0].payload as { action: string; summaryUk: string }).action,
    "START",
  );
  assert.equal(
    (processEvents[0].payload as { summaryUk: string }).summaryUk,
    "Початок співбесіди",
  );

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 2);
  assert.equal(
    (agentMessages[0].payload as { messages: Array<{ content: string }> }).messages[0]
      .content,
    "Вітаю! Я Arbiter — модерую хід співбесіди. Давайте почнемо.",
  );
  assert.equal(companyCalls, 1);
  assert.equal(candidateCalls, 0);
  assert.ok(arbiterCalls >= 2);
});

test("orchestrator ANSWER runs only candidate", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Який досвід?",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let companyCalls = 0;
  let arbiterN = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 4,
    runArbiterTurn: async (_i, _s, pending) => {
      assert.equal(typeof pending, "boolean");
      arbiterN += 1;
      if (arbiterN === 1) {
        return cmd({
          action: "ANSWER",
          summaryUk: "Передано Candidate",
          briefUk: "Досвід",
        });
      }
      return cmd({ action: "WAIT", summaryUk: "Чекаємо" });
    },
    runCompanyLiveTurn: async () => {
      companyCalls += 1;
      return { post: false };
    },
    runCandidateLiveTurn: async (_i, _s, turnContext) => {
      assert.equal(turnContext.action, "ANSWER");
      assert.equal(turnContext.briefUk, "Досвід");
      return { post: true, message: "Я працював з Node.js." };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(companyCalls, 0);
  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 1);
  assert.equal(
    (agentMessages[0].payload as { messages: Array<{ authorType: string }> }).messages[0]
      .authorType,
    "AGENT_CANDIDATE",
  );
});

test("orchestrator WAIT runs nobody else and emits process", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Привіт",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let companyCalls = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () =>
      cmd({ action: "WAIT", summaryUk: "Розмова йде природно" }),
    runCompanyLiveTurn: async () => {
      companyCalls += 1;
      return { post: false };
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return { post: false };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(companyCalls, 0);
  assert.equal(candidateCalls, 0);
  assert.equal(emitted.filter((e) => e.event === "room:messages").length, 0);
  const processEvt = emitted.find((e) => e.event === "room:arbiter-process");
  assert.ok(processEvt);
  assert.deepEqual(
    {
      action: (processEvt!.payload as { action: string }).action,
      summaryUk: (processEvt!.payload as { summaryUk: string }).summaryUk,
    },
    { action: "WAIT", summaryUk: "Розмова йде природно" },
  );
});

test("orchestrator cancels in-flight conductor when new human message arrives", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Перше",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  let resolveAgent: (() => void) | null = null;
  let agentCallCount = 0;
  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 20,
    maxConductorSteps: 2,
    runArbiterTurn: () => {
      agentCallCount += 1;
      if (agentCallCount === 1) {
        return new Promise((resolve) => {
          resolveAgent = () =>
            resolve(
              cmd({
                action: "START",
                summaryUk: "late",
                publicMessage: "late-reply",
              }),
            );
        });
      }
      return Promise.resolve(
        cmd({
          action: "WAIT",
          summaryUk: "Друге — чекаємо",
        }),
      );
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));

  messages.push({
    id: "m2",
    sessionId: "session_1",
    authorType: "HUMAN_HR",
    content: "Друге",
    createdAt: new Date(),
  });
  orchestrator.onHumanMessage(io, "interview_1", "session_1");

  resolveAgent?.();
  await new Promise((r) => setTimeout(r, 80));

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 0);
  const processEvents = emitted.filter((e) => e.event === "room:arbiter-process");
  assert.ok(processEvents.some((e) => (e.payload as { action: string }).action === "WAIT"));
});

test("superseded turn must not clear thinking while newer turn is still running", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Перше",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  let resolveFirst: (() => void) | null = null;
  let resolveSecond: (() => void) | null = null;
  let arbiterCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 15,
    maxConductorSteps: 2,
    runArbiterTurn: () => {
      arbiterCalls += 1;
      if (arbiterCalls === 1) {
        return new Promise((resolve) => {
          resolveFirst = () =>
            resolve(cmd({ action: "WAIT", summaryUk: "stale" }));
        });
      }
      return new Promise((resolve) => {
        resolveSecond = () =>
          resolve(cmd({ action: "WAIT", summaryUk: "active" }));
      });
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 30));

  messages.push({
    id: "m2",
    sessionId: "session_1",
    authorType: "HUMAN_HR",
    content: "Друге",
    createdAt: new Date(),
  });
  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 30));

  // Newer turn is in-flight (arbiter #2 pending). Completing the stale turn
  // must not emit thinking=false over the active turn.
  resolveFirst?.();
  await new Promise((r) => setTimeout(r, 20));

  const thinkingAfterStaleSettled = [...emitted]
    .reverse()
    .find((e) => e.event === "room:agent-thinking");
  assert.deepEqual(thinkingAfterStaleSettled?.payload, {
    active: true,
    agentType: "AGENT_ARBITER",
  });

  resolveSecond?.();
  await new Promise((r) => setTimeout(r, 40));
  orchestrator.close();
});

test("orchestrator does not run when interview is not LIVE", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Привіт",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages, "READY");
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 20,
    runArbiterTurn: async () =>
      cmd({
        action: "START",
        summaryUk: "should-not-run",
        publicMessage: "should-not-run",
      }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(emitted.length, 0);
});

test("orchestrator does not stop after second Company question before Candidate can ANSWER", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Почнемо",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  const callOrder: string[] = [];
  let arbiterN = 0;

  // START + 2×(ANSWER+Candidate) + NEXT needs >6 agent steps; default was 6 and
  // stopped after the second Company question with silence (no error).
  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 20,
    maxConductorSteps: 8,
    runArbiterTurn: async () => {
      arbiterN += 1;
      callOrder.push(`arbiter:${arbiterN}`);
      if (arbiterN === 1) {
        return cmd({
          action: "START",
          summaryUk: "Старт",
          publicMessage: "Починаємо",
        });
      }
      if (arbiterN === 2) {
        return cmd({ action: "ANSWER", summaryUk: "Відповідь на перше" });
      }
      if (arbiterN === 3) {
        return cmd({
          action: "NEXT_QUESTION",
          summaryUk: "Друге питання",
          briefUk: "TypeScript",
        });
      }
      if (arbiterN === 4) {
        return cmd({ action: "ANSWER", summaryUk: "Відповідь на друге" });
      }
      return cmd({ action: "WAIT", summaryUk: "Стоп" });
    },
    runCompanyLiveTurn: async () => {
      const n = callOrder.filter((c) => c === "company").length + 1;
      callOrder.push("company");
      return {
        post: true,
        message: n === 1 ? "Перше питання компанії." : "Друге питання про TypeScript.",
      };
    },
    runCandidateLiveTurn: async () => {
      callOrder.push("candidate");
      return { post: true, message: "Відповідь кандидата." };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 200));

  assert.ok(
    callOrder.includes("candidate") &&
      callOrder.filter((c) => c === "candidate").length >= 2,
    `Candidate must answer both questions; got ${JSON.stringify(callOrder)}`,
  );
  const companyMsgs = emitted.filter(
    (e) =>
      e.event === "room:messages" &&
      (e.payload as { messages: Array<{ authorType: string; content: string }> }).messages.some(
        (m) => m.authorType === "AGENT_COMPANY" && m.content.includes("TypeScript"),
      ),
  );
  assert.equal(companyMsgs.length, 1);
  const candidateAfterSecond = emitted.filter(
    (e) =>
      e.event === "room:messages" &&
      (e.payload as { messages: Array<{ authorType: string }> }).messages.some(
        (m) => m.authorType === "AGENT_CANDIDATE",
      ),
  );
  assert.ok(candidateAfterSecond.length >= 2, "two candidate posts expected");
  orchestrator.close();
});

test("orchestrator conductor: NEXT_QUESTION then ANSWER in one loop", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_CANDIDATE",
      content: "Готовий",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  const callOrder: string[] = [];
  let arbiterN = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 6,
    runArbiterTurn: async () => {
      arbiterN += 1;
      callOrder.push(`arbiter:${arbiterN}`);
      if (arbiterN === 1) {
        return cmd({
          action: "NEXT_QUESTION",
          summaryUk: "Наступне питання",
          briefUk: "Node.js",
        });
      }
      if (arbiterN === 2) {
        return cmd({ action: "ANSWER", summaryUk: "Відповісти" });
      }
      return cmd({ action: "WAIT", summaryUk: "Стоп" });
    },
    runCompanyLiveTurn: async () => {
      callOrder.push("company");
      return { post: true, message: "Розкажіть про Node.js." };
    },
    runCandidateLiveTurn: async () => {
      callOrder.push("candidate");
      return { post: true, message: "Я працював з Node.js 5 років." };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 150));

  assert.deepEqual(callOrder, ["arbiter:1", "company", "arbiter:2", "candidate", "arbiter:3"]);

  const authors = emitted
    .filter((e) => e.event === "room:messages")
    .map(
      (e) =>
        (e.payload as { messages: Array<{ authorType: string }> }).messages[0].authorType,
    );
  assert.deepEqual(authors, ["AGENT_COMPANY", "AGENT_CANDIDATE"]);
});

test("orchestrator close clears timers and prevents new turns", async () => {
  let calls = 0;
  const orchestrator = createRoomOrchestrator(() => makePrisma([]), {
    debounceMs: 20,
    runArbiterTurn: async () => {
      calls += 1;
      return cmd({ action: "WAIT", summaryUk: "x" });
    },
  });
  const { io } = makeIo();

  orchestrator.onHumanMessage(io, "interview", "session");
  orchestrator.close();
  orchestrator.close();
  orchestrator.onHumanMessage(io, "interview", "session");
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(calls, 0);
});

test("orchestrator stops after Candidate post:false (no ANSWER spam)", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterN = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 6,
    runArbiterTurn: async () => {
      arbiterN += 1;
      return cmd({ action: "ANSWER", summaryUk: "Відповісти" });
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return { post: false };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(arbiterN, 1);
  assert.equal(candidateCalls, 1);
  assert.equal(emitted.filter((e) => e.event === "room:messages").length, 0);
});

test("orchestrator continues after Candidate inferred confidence", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io } = makeIo();
  let arbiterN = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 6,
    runArbiterTurn: async () => {
      arbiterN += 1;
      if (arbiterN === 1) {
        return cmd({ action: "ANSWER", summaryUk: "Відповісти" });
      }
      return cmd({ action: "NEXT_QUESTION", summaryUk: "Далі" });
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return {
        post: true,
        message: "З анкети видно, що кандидат вивчає Pinia.",
        confidence: "inferred",
        needsHuman: false,
      };
    },
    runCompanyLiveTurn: async () => ({ post: true, message: "Наступне питання?" }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(candidateCalls, 1);
  assert.ok(arbiterN >= 2, "arbiter should continue after inferred");
});

test("orchestrator stops after Candidate needsHuman (no deferral spam)", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterN = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 6,
    runArbiterTurn: async () => {
      arbiterN += 1;
      return cmd({ action: "ANSWER", summaryUk: "Відповісти" });
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return {
        post: true,
        message: "У профілі немає деталей. Ірино, дай відповідь сама.",
        needsHuman: true,
      };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(arbiterN, 1);
  assert.equal(candidateCalls, 1);
  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 1);
  assert.match(
    (agentMessages[0].payload as { messages: Array<{ content: string }> }).messages[0]
      .content,
    /Ірино/,
  );
});

test("orchestrator does not re-ANSWER after Candidate already posted this turn", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io } = makeIo();
  let arbiterN = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 6,
    runArbiterTurn: async () => {
      arbiterN += 1;
      if (arbiterN === 1) {
        return cmd({ action: "ANSWER", summaryUk: "Перша відповідь" });
      }
      // Bad Arbiter: keeps asking ANSWER after a real answer was posted
      return cmd({ action: "ANSWER", summaryUk: "Знову відповісти" });
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return { post: true, message: "Я працював з Vue 3 на навчальних проєктах." };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(candidateCalls, 1);
  assert.equal(arbiterN, 2);
});

test("orchestrator arbiter failure emits agent-error; onAgentRetry resumes arbiter", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 0,
    maxConductorSteps: 4,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      if (arbiterCalls === 1) {
        throw new Error("ECONNRESET");
      }
      return cmd({ action: "WAIT", summaryUk: "Відновлено" });
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(arbiterCalls, 1);
  const errors = emitted.filter((e) => e.event === "room:agent-error");
  assert.equal(errors.length, 1);
  assert.equal(
    (errors[0].payload as { agentType: string; error: string }).agentType,
    "AGENT_ARBITER",
  );
  assert.equal(
    (errors[0].payload as { error: string }).error,
    "AI тимчасово не відповів. Можна спробувати ще раз.",
  );
  const thinkingOff = emitted.filter(
    (e) =>
      e.event === "room:agent-thinking" &&
      (e.payload as { active: boolean }).active === false,
  );
  assert.ok(thinkingOff.length >= 1);

  emitted.length = 0;
  orchestrator.onAgentRetry(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(arbiterCalls, 2);
  const processEvents = emitted.filter((e) => e.event === "room:arbiter-process");
  assert.ok(processEvents.some((e) => (e.payload as { action: string }).action === "WAIT"));
});

test("orchestrator company failure; onAgentRetry resumes company without re-running arbiter first", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterCalls = 0;
  let companyCalls = 0;
  let companyShouldFail = true;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 0,
    maxConductorSteps: 6,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      if (arbiterCalls === 1) {
        return cmd({
          action: "NEXT_QUESTION",
          summaryUk: "Наступне питання",
          briefUk: "Vue",
        });
      }
      return cmd({ action: "WAIT", summaryUk: "Чекаємо" });
    },
    runCompanyLiveTurn: async () => {
      companyCalls += 1;
      if (companyShouldFail) {
        throw new Error("company down");
      }
      return { post: true, message: "Розкажіть про Vue." };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(arbiterCalls, 1);
  assert.equal(companyCalls, 1);
  const errors = emitted.filter((e) => e.event === "room:agent-error");
  assert.equal(errors.length, 1);
  assert.equal(
    (errors[0].payload as { agentType: string }).agentType,
    "AGENT_COMPANY",
  );

  const arbiterBeforeRetry = arbiterCalls;
  companyShouldFail = false;
  emitted.length = 0;
  orchestrator.onAgentRetry(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(companyCalls, 2);
  assert.ok(
    arbiterCalls > arbiterBeforeRetry,
    "after company succeeds, conductor continues to arbiter",
  );
  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.ok(
    agentMessages.some(
      (e) =>
        (e.payload as { messages: Array<{ authorType: string; content: string }> })
          .messages[0].authorType === "AGENT_COMPANY" &&
        (e.payload as { messages: Array<{ content: string }> }).messages[0].content ===
          "Розкажіть про Vue.",
    ),
  );
});

test("orchestrator onAgentRetry without lastFailedTurn emits thinking false and agent-error", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 0,
    maxConductorSteps: 4,
    runArbiterTurn: async () => cmd({ action: "WAIT", summaryUk: "ok" }),
  });

  // No prior failure → lastFailedTurn is null; must not leave client on «Думаю…».
  orchestrator.onAgentRetry(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 20));

  const thinkingOff = emitted.filter(
    (e) =>
      e.event === "room:agent-thinking" &&
      (e.payload as { active?: boolean }).active === false,
  );
  const agentErrors = emitted.filter((e) => e.event === "room:agent-error");
  assert.ok(thinkingOff.length >= 1, "must emit thinking active:false");
  assert.ok(agentErrors.length >= 1, "must emit agent-error (not silent no-op)");
  assert.equal(
    typeof (agentErrors[0].payload as { error?: string }).error,
    "string",
  );
  assert.ok(
    ((agentErrors[0].payload as { error: string }).error).trim().length > 0,
  );
});

test("orchestrator onAgentRetry while busy does not double-invoke", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io } = makeIo();
  let companyCalls = 0;
  let failFirst = true;
  let resolveCompany: ((value: { post: true; message: string }) => void) | null = null;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 0,
    maxConductorSteps: 4,
    runArbiterTurn: async () =>
      cmd({
        action: "NEXT_QUESTION",
        summaryUk: "Питання",
        briefUk: "Node",
      }),
    runCompanyLiveTurn: async () => {
      companyCalls += 1;
      if (failFirst) {
        failFirst = false;
        throw new Error("fail once");
      }
      return new Promise((resolve) => {
        resolveCompany = () => resolve({ post: true, message: "Питання?" });
      });
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(companyCalls, 1);

  orchestrator.onAgentRetry(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(companyCalls, 2);

  orchestrator.onAgentRetry(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(companyCalls, 2, "second retry while busy must be no-op");

  resolveCompany?.({ post: true, message: "Питання?" });
  await new Promise((r) => setTimeout(r, 40));
});

test("orchestrator clears lastFailedTurn on new human message", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterCalls = 0;
  let failNext = true;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 0,
    maxConductorSteps: 4,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      if (failNext) {
        failNext = false;
        throw new Error("first fail");
      }
      return cmd({ action: "WAIT", summaryUk: "ok" });
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(arbiterCalls, 1);
  assert.equal(emitted.filter((e) => e.event === "room:agent-error").length, 1);

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(arbiterCalls, 2);

  const callsBeforeRetry = arbiterCalls;
  orchestrator.onAgentRetry(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(
    arbiterCalls,
    callsBeforeRetry,
    "onAgentRetry must be no-op after human message cleared lastFailedTurn",
  );
});

test("orchestrator stale failure after generation bump must not restore lastFailedTurn", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  let arbiterCalls = 0;
  let rejectFirst: ((error: Error) => void) | null = null;
  const firstHang = new Promise<never>((_, reject) => {
    rejectFirst = reject;
  });

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 0,
    maxConductorSteps: 4,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      if (arbiterCalls === 1) {
        await firstHang;
      }
      return cmd({ action: "WAIT", summaryUk: "нове покоління" });
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(arbiterCalls, 1, "first turn must be awaiting arbiter");

  // Bumps generation and clears lastFailedTurn while old turn is still in flight.
  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(arbiterCalls, 2, "newer turn must start arbiter");

  const errorsBeforeStale = emitted.filter((e) => e.event === "room:agent-error").length;
  rejectFirst?.(new Error("stale superseded failure"));
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(
    emitted.filter((e) => e.event === "room:agent-error").length,
    errorsBeforeStale,
    "superseded turn must not emit agent-error",
  );

  const callsBeforeRetry = arbiterCalls;
  orchestrator.onAgentRetry(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(
    arbiterCalls,
    callsBeforeRetry,
    "stale failure must not restore lastFailedTurn for retry",
  );
});

test("MAX_CONDUCTOR_STEPS default is 100", async () => {
  const { MAX_CONDUCTOR_STEPS } = await import("./orchestrator");
  assert.equal(MAX_CONDUCTOR_STEPS, 100);
});

test("orchestrator onAgentStop cancels in-flight turn and clears thinking", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Почнемо",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  let resolveArbiter: (() => void) | null = null;
  let arbiterCalls = 0;
  let companyCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 15,
    maxConductorSteps: 100,
    runArbiterTurn: () => {
      arbiterCalls += 1;
      return new Promise((resolve) => {
        resolveArbiter = () =>
          resolve(
            cmd({
              action: "START",
              summaryUk: "late",
              publicMessage: "не має зʼявитись",
            }),
          );
      });
    },
    runCompanyLiveTurn: async () => {
      companyCalls += 1;
      return { post: true, message: "company" };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(arbiterCalls, 1);

  orchestrator.onAgentStop(io, "interview_1");
  await new Promise((r) => setTimeout(r, 20));

  resolveArbiter?.();
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(companyCalls, 0);
  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 0);

  const lastThinking = [...emitted].reverse().find((e) => e.event === "room:agent-thinking");
  assert.deepEqual(lastThinking?.payload, { active: false });

  orchestrator.close();
});

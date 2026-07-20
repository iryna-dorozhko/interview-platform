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

test("orchestrator START posts arbiter, runs company, emits process", async () => {
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
          action: "START",
          summaryUk: "Початок співбесіди",
          publicMessage: "Давайте почнемо співбесіду.",
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

  orchestrator.onLiveStart(io, "interview_1", "session_1");
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
    "Давайте почнемо співбесіду.",
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

import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "socket.io";
import type { LiveMessage, PrismaClient } from "@prisma/client";
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
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: {
          sessionId: string;
          authorType?: { in: string[] };
        };
        orderBy: { createdAt: "desc" };
      }) => {
        const filtered = messages
          .filter((m) => m.sessionId === where.sessionId)
          .filter((m) =>
            where.authorType?.in ? where.authorType.in.includes(m.authorType) : true,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return filtered[0] ?? null;
      },
      create: async ({
        data,
      }: {
        data: { sessionId: string; authorType: string; content: string };
      }) => {
        createCount += 1;
        const created = {
          id: `agent_${createCount}`,
          sessionId: data.sessionId,
          authorType: data.authorType as LiveMessage["authorType"],
          content: data.content,
          createdAt: new Date(),
        } as LiveMessage;
        messages.push(created);
        return created;
      },
    },
  } as unknown as PrismaClient;
}

test("orchestrator runs agent after debounce and emits thinking + message", async () => {
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

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => ({ post: true, message: "reply:Привіт" }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 80));

  const thinkingStart = emitted.find((e) => e.event === "room:agent-thinking" && (e.payload as { active: boolean }).active);
  const agentMessage = emitted.find((e) => e.event === "room:messages");
  const thinkingEnd = emitted.filter((e) => e.event === "room:agent-thinking").at(-1);

  assert.ok(thinkingStart);
  assert.equal((thinkingStart!.payload as { agentType?: string }).agentType, "AGENT_ARBITER");
  assert.ok(agentMessage);
  assert.deepEqual((agentMessage!.payload as { messages: Array<{ authorType: string }> }).messages[0].authorType, "AGENT_ARBITER");
  assert.equal(
    (agentMessage!.payload as { messages: Array<{ content: string }> }).messages[0].content,
    "reply:Привіт",
  );
  assert.equal((thinkingEnd!.payload as { active: boolean }).active, false);
  assert.equal(messages.filter((m) => m.authorType === "AGENT_ARBITER").length, 1);
});

test("orchestrator cancels in-flight agent when new human message arrives", async () => {
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
    runArbiterTurn: () => {
      agentCallCount += 1;
      if (agentCallCount === 1) {
        return new Promise((resolve) => {
          resolveAgent = () => resolve({ post: true, message: "late-reply" });
        });
      }
      return Promise.resolve({ post: true, message: "reply:Друге" });
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
  assert.equal(agentMessages.length, 1);
  assert.equal(
    (agentMessages[0].payload as { messages: Array<{ content: string }> }).messages[0].content,
    "reply:Друге",
  );
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
    runArbiterTurn: async () => ({ post: true, message: "should-not-run" }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(emitted.length, 0);
});

test("orchestrator does not emit message when arbiter returns post:false", async () => {
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

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => ({ post: false }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 80));

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 0);
  assert.equal(messages.filter((m) => m.authorType === "AGENT_ARBITER").length, 0);

  const thinkingEnd = emitted.filter((e) => e.event === "room:agent-thinking").at(-1);
  assert.equal((thinkingEnd!.payload as { active: boolean }).active, false);
});

test("orchestrator runs full agent chain in order", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Доброго дня!",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  const callOrder: string[] = [];

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => {
      callOrder.push("arbiter");
      return { post: true, message: "Давайте почнемо співбесіду." };
    },
    runCompanyLiveTurn: async () => {
      callOrder.push("company");
      return { post: true, message: "Розкажіть про досвід з Node.js." };
    },
    runCandidateLiveTurn: async () => {
      callOrder.push("candidate");
      return { post: true, message: "Я працював з Node.js 5 років." };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 120));

  assert.deepEqual(callOrder, ["arbiter", "company", "candidate"]);

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 3);
  assert.deepEqual(
    agentMessages.map(
      (e) =>
        (e.payload as { messages: Array<{ authorType: string }> }).messages[0].authorType,
    ),
    ["AGENT_ARBITER", "AGENT_COMPANY", "AGENT_CANDIDATE"],
  );

  const thinkingEvents = emitted.filter((e) => e.event === "room:agent-thinking");
  const activeThinking = thinkingEvents.filter(
    (e) => (e.payload as { active: boolean }).active,
  );
  assert.deepEqual(
    activeThinking.map((e) => (e.payload as { agentType?: string }).agentType),
    ["AGENT_ARBITER", "AGENT_COMPANY", "AGENT_CANDIDATE"],
  );
});

test("orchestrator continues chain when arbiter returns post:false", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Який досвід з TypeScript?",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => ({ post: false }),
    runCompanyLiveTurn: async () => ({ post: false }),
    runCandidateLiveTurn: async () => ({
      post: true,
      message: "Я використовую TypeScript щодня.",
    }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 120));

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 1);
  assert.equal(
    (agentMessages[0].payload as { messages: Array<{ authorType: string }> }).messages[0]
      .authorType,
    "AGENT_CANDIDATE",
  );
});

test("orchestrator emits no agent messages when all agents return post:false", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_CANDIDATE",
      content: "Привіт!",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => ({ post: false }),
    runCompanyLiveTurn: async () => ({ post: false }),
    runCandidateLiveTurn: async () => ({ post: false }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(emitted.filter((e) => e.event === "room:messages").length, 0);
  const thinkingEnd = emitted.filter((e) => e.event === "room:agent-thinking").at(-1);
  assert.equal((thinkingEnd!.payload as { active: boolean }).active, false);
});

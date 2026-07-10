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
    runAgent: async (content) => `reply:${content}`,
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
    runAgent: (content) => {
      agentCallCount += 1;
      if (agentCallCount === 1) {
        return new Promise((resolve) => {
          resolveAgent = () => resolve("late-reply");
        });
      }
      return Promise.resolve(`reply:${content}`);
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
  assert.match(
    (agentMessages[0].payload as { messages: Array<{ content: string }> }).messages[0].content,
    /reply:Друге/,
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
    runAgent: async () => "should-not-run",
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(emitted.length, 0);
});

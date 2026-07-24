import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { LiveMessage, LiveSession, PrismaClient } from "@prisma/client";
import { signToken } from "../auth/jwt";
import { registerRoomHandlers } from "./room";
import type { RoomOrchestrator } from "./orchestrator";
import { resetPresenceForTests } from "./room-presence";

process.env.JWT_SECRET = "test-secret-min-8-chars";

function makeNoopOrchestrator(
  overrides: Partial<RoomOrchestrator> = {},
): RoomOrchestrator {
  return {
    onHumanMessage: () => {},
    onLiveStart: () => {},
    onAgentRetry: () => {},
    onAgentStop: () => {},
    close: () => {},
    ...overrides,
  };
}

type FakeInterview = {
  id: string;
  hrUserId: string;
  candidateUserId: string;
  status: "READY" | "LIVE" | "ENDED" | "AWAITING_CANDIDATE";
};

type FakeLiveSession = Pick<LiveSession, "id" | "interviewId">;
type FakeLiveMessage = Pick<LiveMessage, "id" | "sessionId" | "authorType" | "content" | "createdAt">;

function makeFakePrisma(
  interview: FakeInterview,
  sessions: FakeLiveSession[],
  messages: FakeLiveMessage[],
) {
  let sessionCreates = 0;
  let messageCreates = 0;

  return {
    interview: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: { id: boolean; hrUserId: boolean; candidateUserId: boolean; status: boolean };
      }) => {
        if (where.id !== interview.id) return null;
        if (!select) return interview;
        return {
          id: interview.id,
          hrUserId: interview.hrUserId,
          candidateUserId: interview.candidateUserId,
          status: interview.status,
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: FakeInterview["status"] };
      }) => {
        if (where.id !== interview.id) throw new Error("Interview not found");
        if (data.status) interview.status = data.status;
        return interview;
      },
    },
    liveSession: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        sessions.find((item) => item.interviewId === where.interviewId) ?? null,
      create: async ({ data }: { data: { interviewId: string } }) => {
        sessionCreates += 1;
        const existing = sessions.find((item) => item.interviewId === data.interviewId);
        if (existing) {
          const error = new Error("Unique constraint failed") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        const created = { id: `session_${sessionCreates}`, interviewId: data.interviewId };
        sessions.push(created);
        return created;
      },
    },
    liveMessage: {
      findMany: async ({
        where,
        orderBy,
      }: {
        where: { sessionId: string };
        orderBy: { createdAt: "asc" | "desc" };
      }) => {
        const items = messages.filter((item) => item.sessionId === where.sessionId);
        return [...items].sort((a, b) =>
          orderBy.createdAt === "asc"
            ? a.createdAt.getTime() - b.createdAt.getTime()
            : b.createdAt.getTime() - a.createdAt.getTime(),
        );
      },
      create: async ({
        data,
      }: {
        data: {
          sessionId: string;
          authorType: "HUMAN_HR" | "HUMAN_CANDIDATE";
          content: string;
        };
      }) => {
        messageCreates += 1;
        const created = {
          id: `message_${messageCreates}`,
          sessionId: data.sessionId,
          authorType: data.authorType,
          content: data.content,
          createdAt: new Date(messageCreates),
        };
        messages.push(created);
        return created;
      },
    },
  } as unknown as PrismaClient;
}

async function startRoomServer(
  prisma: PrismaClient,
  orchestrator: RoomOrchestrator = makeNoopOrchestrator(),
): Promise<{
  httpServer: HttpServer;
  port: number;
  close: () => Promise<void>;
}> {
  const httpServer = createServer();
  const io = new Server(httpServer);
  registerRoomHandlers(io, () => prisma, orchestrator);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return {
    httpServer,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        io.close();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function connectClient(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ["websocket"],
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const hrToken = signToken({ sub: "hr_1", email: "hr@test.com", role: "HR" });
const candidateToken = signToken({
  sub: "cd_1",
  email: "candidate@test.com",
  role: "CANDIDATE",
});

test("room:join transitions READY to LIVE when both participants join", async () => {
  resetPresenceForTests();
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "READY",
  };
  const sessions: FakeLiveSession[] = [{ id: "session_1", interviewId: "interview_1" }];
  const messages: FakeLiveMessage[] = [
    {
      id: "message_1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Привіт",
      createdAt: new Date(1),
    },
  ];
  const prisma = makeFakePrisma(interview, sessions, messages);
  const server = await startRoomServer(prisma);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);

    hrSocket.emit("room:join", { interviewId: "interview_1" });
    const hrHistory = await waitForEvent<{ messages: Array<{ id: string; content: string }> }>(
      hrSocket,
      "room:messages",
    );

    const liveStatusPromise = waitForEvent<{ status: string }>(hrSocket, "room:status");
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await waitForEvent(candidateSocket, "room:messages");
    const liveStatus = await liveStatusPromise;

    assert.equal(hrHistory.messages.length, 1);
    assert.equal(hrHistory.messages[0]?.content, "Привіт");
    assert.equal(liveStatus.status, "LIVE");
    assert.equal(interview.status, "LIVE");

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:message persists HUMAN_HR and broadcasts to everyone in the room", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const sessions: FakeLiveSession[] = [];
  const messages: FakeLiveMessage[] = [];
  const prisma = makeFakePrisma(interview, sessions, messages);
  const server = await startRoomServer(prisma);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);

    hrSocket.emit("room:join", { interviewId: "interview_1" });
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await Promise.all([
      waitForEvent(hrSocket, "room:messages"),
      waitForEvent(candidateSocket, "room:messages"),
    ]);

    const candidateReceived = waitForEvent<{ messages: Array<{ content: string; authorType: string }> }>(
      candidateSocket,
      "room:messages",
    );
    hrSocket.emit("room:message", { interviewId: "interview_1", content: "Питання від HR" });
    const broadcast = await candidateReceived;

    const message = broadcast.messages.find((item) => item.content === "Питання від HR");
    assert.ok(message);
    assert.equal(message.authorType, "HUMAN_HR");
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.authorType, "HUMAN_HR");
    assert.equal(sessions.length, 1);

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:message persists HUMAN_CANDIDATE", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const sessions: FakeLiveSession[] = [{ id: "session_1", interviewId: "interview_1" }];
  const messages: FakeLiveMessage[] = [];
  const prisma = makeFakePrisma(interview, sessions, messages);
  const server = await startRoomServer(prisma);

  try {
    const socket = await connectClient(server.port, candidateToken);
    socket.emit("room:join", { interviewId: "interview_1" });
    await waitForEvent(socket, "room:messages");

    const received = waitForEvent<{ messages: Array<{ authorType: string }> }>(socket, "room:messages");
    socket.emit("room:message", { interviewId: "interview_1", content: "Відповідь кандидата" });
    const payload = await received;

    assert.equal(messages[0]?.authorType, "HUMAN_CANDIDATE");
    assert.equal(payload.messages[0]?.authorType, "HUMAN_CANDIDATE");
    socket.disconnect();
  } finally {
    await server.close();
  }
});

test("concurrent room:join creates only one LiveSession and responds to both sockets", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const sessions: FakeLiveSession[] = [];
  const messages: FakeLiveMessage[] = [];
  const prisma = makeFakePrisma(interview, sessions, messages);
  const server = await startRoomServer(prisma);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);

    hrSocket.emit("room:join", { interviewId: "interview_1" });
    candidateSocket.emit("room:join", { interviewId: "interview_1" });

    await Promise.all([
      waitForEvent(hrSocket, "room:messages"),
      waitForEvent(candidateSocket, "room:messages"),
    ]);

    assert.equal(sessions.length, 1);

    const health = await fetch(`http://127.0.0.1:${server.port}/socket.io/?EIO=4&transport=polling`);
    assert.equal(health.ok, true);

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:join emits room:error for interviews the user cannot access", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const prisma = makeFakePrisma(interview, [], []);
  const server = await startRoomServer(prisma);

  try {
    const socket = await connectClient(
      server.port,
      signToken({ sub: "hr_2", email: "other@test.com", role: "HR" }),
    );
    socket.emit("room:join", { interviewId: "interview_1" });
    const payload = await waitForEvent<{ error: string }>(socket, "room:error");
    assert.equal(payload.error, "Немає доступу");
    socket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:agent-retry calls onAgentRetry for HR in the joined room", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const sessions: FakeLiveSession[] = [{ id: "session_1", interviewId: "interview_1" }];
  const prisma = makeFakePrisma(interview, sessions, []);

  let resolveRetry!: (value: { interviewId: string; sessionId: string }) => void;
  const retryPromise = new Promise<{ interviewId: string; sessionId: string }>((resolve) => {
    resolveRetry = resolve;
  });
  const orchestrator = makeNoopOrchestrator({
    onAgentRetry: (_io, interviewId, sessionId) => {
      resolveRetry({ interviewId, sessionId });
    },
  });
  const server = await startRoomServer(prisma, orchestrator);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    hrSocket.emit("room:join", { interviewId: "interview_1" });
    await waitForEvent(hrSocket, "room:messages");

    hrSocket.emit("room:agent-retry", { interviewId: "interview_1" });
    const called = await Promise.race([
      retryPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for onAgentRetry")), 5000),
      ),
    ]);

    assert.equal(called.interviewId, "interview_1");
    assert.equal(called.sessionId, "session_1");

    hrSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:typing relays to peer without echoing sender", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const prisma = makeFakePrisma(interview, [{ id: "session_1", interviewId: "interview_1" }], []);
  const server = await startRoomServer(prisma);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);
    hrSocket.emit("room:join", { interviewId: "interview_1" });
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await Promise.all([
      waitForEvent(hrSocket, "room:messages"),
      waitForEvent(candidateSocket, "room:messages"),
    ]);

    const peerTyping = waitForEvent<{ role: string; isTyping: boolean }>(
      candidateSocket,
      "room:typing",
    );
    let senderGotTyping = false;
    hrSocket.once("room:typing", () => {
      senderGotTyping = true;
    });

    hrSocket.emit("room:typing", { interviewId: "interview_1", isTyping: true });
    const payload = await peerTyping;
    assert.equal(payload.role, "HR");
    assert.equal(payload.isTyping, true);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(senderGotTyping, false);

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:typing ignored when interviewId does not match joined room", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const prisma = makeFakePrisma(interview, [{ id: "session_1", interviewId: "interview_1" }], []);
  const server = await startRoomServer(prisma);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);
    hrSocket.emit("room:join", { interviewId: "interview_1" });
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await Promise.all([
      waitForEvent(hrSocket, "room:messages"),
      waitForEvent(candidateSocket, "room:messages"),
    ]);

    let got = false;
    candidateSocket.once("room:typing", () => {
      got = true;
    });
    hrSocket.emit("room:typing", { interviewId: "other", isTyping: true });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(got, false);

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:agent-retry rejects candidate and does not call onAgentRetry", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const sessions: FakeLiveSession[] = [{ id: "session_1", interviewId: "interview_1" }];
  const prisma = makeFakePrisma(interview, sessions, []);

  let retryCalled = false;
  const orchestrator = makeNoopOrchestrator({
    onAgentRetry: () => {
      retryCalled = true;
    },
  });
  const server = await startRoomServer(prisma, orchestrator);

  try {
    const candidateSocket = await connectClient(server.port, candidateToken);
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await waitForEvent(candidateSocket, "room:messages");

    const errorPromise = waitForEvent<{ error: string }>(candidateSocket, "room:error");
    candidateSocket.emit("room:agent-retry", { interviewId: "interview_1" });
    const payload = await errorPromise;

    assert.equal(payload.error, "Немає доступу");
    assert.equal(retryCalled, false);

    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:agent-stop calls onAgentStop for HR in the joined room", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const sessions: FakeLiveSession[] = [{ id: "session_1", interviewId: "interview_1" }];
  const prisma = makeFakePrisma(interview, sessions, []);

  let resolveStop!: (value: { interviewId: string }) => void;
  const stopPromise = new Promise<{ interviewId: string }>((resolve) => {
    resolveStop = resolve;
  });
  const orchestrator = makeNoopOrchestrator({
    onAgentStop: (_io, interviewId) => {
      resolveStop({ interviewId });
    },
  });
  const server = await startRoomServer(prisma, orchestrator);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    hrSocket.emit("room:join", { interviewId: "interview_1" });
    await waitForEvent(hrSocket, "room:messages");

    hrSocket.emit("room:agent-stop", { interviewId: "interview_1" });
    const called = await Promise.race([
      stopPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for onAgentStop")), 5000),
      ),
    ]);

    assert.equal(called.interviewId, "interview_1");
    hrSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:agent-stop rejects candidate and does not call onAgentStop", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const sessions: FakeLiveSession[] = [{ id: "session_1", interviewId: "interview_1" }];
  const prisma = makeFakePrisma(interview, sessions, []);

  let stopCalled = false;
  const orchestrator = makeNoopOrchestrator({
    onAgentStop: () => {
      stopCalled = true;
    },
  });
  const server = await startRoomServer(prisma, orchestrator);

  try {
    const candidateSocket = await connectClient(server.port, candidateToken);
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await waitForEvent(candidateSocket, "room:messages");

    const errorPromise = waitForEvent<{ error: string }>(candidateSocket, "room:error");
    candidateSocket.emit("room:agent-stop", { interviewId: "interview_1" });
    const payload = await errorPromise;

    assert.equal(payload.error, "Немає доступу");
    assert.equal(stopCalled, false);

    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

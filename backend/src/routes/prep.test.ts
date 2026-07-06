import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { requireAuth, requireHr, type AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { createPrepRouter } from "./prep";
import { LlmUnavailableError, LlmEmptyResponseError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type FakeInterview = { id: string; hrUserId: string };
type FakeSession = { id: string; interviewId: string; isClosed: boolean };
type FakeMessage = {
  id: string;
  sessionId: string;
  authorType: "HUMAN_HR" | "AGENT_COMPANY";
  content: string;
  createdAt: Date;
};
type FakeProfile = {
  id: string;
  interviewId: string;
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
};

function makeFakePrisma(
  seed: {
    interviews?: FakeInterview[];
    sessions?: FakeSession[];
    profiles?: FakeProfile[];
  } = {}
) {
  const interviews = seed.interviews ?? [];
  const sessions = seed.sessions ?? [];
  const profiles = seed.profiles ?? [];
  const messages: FakeMessage[] = [];
  let counter = 0;

  return {
    interview: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        interviews.find((item) => item.id === where.id) ?? null,
    },
    prepSessionHr: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        sessions.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { interviewId: string };
        create: { interviewId: string };
      }) => {
        let session = sessions.find((item) => item.interviewId === where.interviewId);
        if (!session) {
          session = { id: `session_${++counter}`, interviewId: create.interviewId, isClosed: false };
          sessions.push(session);
        }
        return session;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { isClosed: boolean };
      }) => {
        const session = sessions.find((item) => item.id === where.id);
        if (!session) throw new Error("session not found");
        Object.assign(session, data);
        return session;
      },
    },
    prepMessageHr: {
      create: async ({
        data,
      }: {
        data: { sessionId: string; authorType: "HUMAN_HR" | "AGENT_COMPANY"; content: string };
      }) => {
        const message: FakeMessage = { id: `message_${++counter}`, createdAt: new Date(), ...data };
        messages.push(message);
        return message;
      },
      findMany: async ({ where }: { where: { sessionId: string } }) =>
        messages
          .filter((item) => item.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    },
    companyProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { interviewId: string };
        create: Omit<FakeProfile, "id">;
        update: Omit<FakeProfile, "id" | "interviewId">;
      }) => {
        let profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) {
          profile = { id: `profile_${++counter}`, ...create };
          profiles.push(profile);
        } else {
          Object.assign(profile, create);
        }
        return profile;
      },
    },
    __sessions: sessions,
    __messages: messages,
    __profiles: profiles,
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

test("GET /prep/:interviewId returns empty state when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { messages: [], isClosed: false, profile: null });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns messages and isClosed when session exists", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    { id: "m1", sessionId: "session_1", authorType: "AGENT_COMPANY", content: "Привіт!", createdAt: new Date(1) }
  );
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.isClosed, false);
    assert.equal(body.profile, null);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].content, "Привіт!");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns profile when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.isClosed, true);
    assert.equal(body.profile.role, "QA Engineer");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/missing`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns 403 when interview belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_other" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish extracts profile, saves it, and closes the session", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    { id: "m1", sessionId: "session_1", authorType: "HUMAN_HR", content: "Middle Backend Developer", createdAt: new Date(1) },
    { id: "m2", sessionId: "session_1", authorType: "AGENT_COMPANY", content: "Дякую.\nREADY:true", createdAt: new Date(2) }
  );
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return JSON.stringify({
        role: "Middle Backend Developer",
        requirements: ["Node.js"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
      });
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.role, "Middle Backend Developer");
    assert.equal(fakePrisma.__sessions[0].isClosed, true);
    assert.equal(fakePrisma.__profiles.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 404 when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 409 when session is already closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 502 when LLM returns invalid JSON", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не json"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 502);
    assert.equal(fakePrisma.__sessions[0].isClosed, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 503 when LLM unavailable", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      throw new LlmUnavailableError("omlx server not reachable");
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/message creates session and both messages on first turn", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Привіт! Розкажіть, будь ласка, про вакансію.\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.message, "Привіт! Розкажіть, будь ласка, про вакансію.");
    assert.equal(body.readyForConfirmation, false);
    assert.equal(fakePrisma.__sessions.length, 1);
    assert.equal(fakePrisma.__messages.length, 1);
    assert.equal(fakePrisma.__messages[0].authorType, "AGENT_COMPANY");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message saves HR message and extracts readyForConfirmation=true", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Дякую, цього достатньо.\nREADY:true";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Middle Backend Developer, 3+ роки досвіду" }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.readyForConfirmation, true);
    assert.equal(body.message, "Дякую, цього достатньо.");
    assert.equal(fakePrisma.__messages.length, 2);
    assert.equal(fakePrisma.__messages[0].authorType, "HUMAN_HR");
    assert.equal(fakePrisma.__messages[0].content, "Middle Backend Developer, 3+ роки досвіду");
    assert.equal(fakePrisma.__messages[1].authorType, "AGENT_COMPANY");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/missing/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Interview not found");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 403 when interview belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_other" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 409 when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Ще одне питання" }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Prep session closed");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 503 when LLM unavailable", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      throw new LlmUnavailableError("omlx server not reachable");
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "LLM unavailable");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 502 when LLM returns empty response", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      throw new LlmEmptyResponseError();
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 502);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 401 without auth when middleware applied", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth, requireHr, createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message works with valid token through requireAuth+requireHr", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  const token = signToken({ sub: "hr_1", email: "hr@test.com", role: "HR" });
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Привіт!\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth, requireHr, createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 500 when persisting agent reply fails", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
  });
  const originalCreate = fakePrisma.prepMessageHr.create;
  fakePrisma.prepMessageHr.create = (async ({ data }: { data: { authorType: string } }) => {
    if (data.authorType === "AGENT_COMPANY") {
      throw new Error("db write failed");
    }
    return originalCreate({ data } as never);
  }) as typeof originalCreate;
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Привіт!\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Internal error");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

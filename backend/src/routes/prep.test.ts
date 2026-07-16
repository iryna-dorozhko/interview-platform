import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { requireAuth, requireHr, type AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { createPrepRouter } from "./prep";
import { LlmUnavailableError, LlmEmptyResponseError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type FakeVacancy = { id: string; hrUserId: string; status?: string };
type FakeSession = { id: string; vacancyId: string; isClosed: boolean };
type FakeMessage = {
  id: string;
  sessionId: string;
  authorType: "HUMAN_HR" | "AGENT_COMPANY";
  content: string;
  createdAt: Date;
};
type FakeProfile = {
  id: string;
  vacancyId: string;
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
  confirmedAt: Date | null;
};

function makeFakePrisma(
  seed: {
    vacancies?: FakeVacancy[];
    sessions?: FakeSession[];
    profiles?: FakeProfile[];
  } = {}
) {
  const vacancies = (seed.vacancies ?? []).map((item) => ({ status: "DRAFT", ...item }));
  const sessions = seed.sessions ?? [];
  const profiles = seed.profiles ?? [];
  const messages: FakeMessage[] = [];
  let counter = 0;

  return {
    vacancy: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        vacancies.find((item) => item.id === where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: string };
      }) => {
        const vacancy = vacancies.find((item) => item.id === where.id);
        if (!vacancy) throw new Error("vacancy not found");
        Object.assign(vacancy, data);
        return vacancy;
      },
    },
    prepSessionHr: {
      findUnique: async ({ where }: { where: { vacancyId: string } }) =>
        sessions.find((item) => item.vacancyId === where.vacancyId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { vacancyId: string };
        create: { vacancyId: string };
      }) => {
        let session = sessions.find((item) => item.vacancyId === where.vacancyId);
        if (!session) {
          session = { id: `session_${++counter}`, vacancyId: create.vacancyId, isClosed: false };
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
      delete: async ({ where }: { where: { id: string } }) => {
        const index = sessions.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("session not found");
        const [removed] = sessions.splice(index, 1);
        return removed;
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
      deleteMany: async ({ where }: { where: { sessionId: string } }) => {
        const remaining = messages.filter((item) => item.sessionId !== where.sessionId);
        const removedCount = messages.length - remaining.length;
        messages.length = 0;
        messages.push(...remaining);
        return { count: removedCount };
      },
    },
    companyProfile: {
      findUnique: async ({ where }: { where: { vacancyId: string } }) =>
        profiles.find((item) => item.vacancyId === where.vacancyId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { vacancyId: string };
        data: { confirmedAt: Date };
      }) => {
        const profile = profiles.find((item) => item.vacancyId === where.vacancyId);
        if (!profile) throw new Error("profile not found");
        Object.assign(profile, data);
        return profile;
      },
      upsert: async ({
        where,
        create,
      }: {
        where: { vacancyId: string };
        create: Omit<FakeProfile, "id" | "confirmedAt">;
        update: Omit<FakeProfile, "id" | "vacancyId" | "confirmedAt">;
      }) => {
        let profile = profiles.find((item) => item.vacancyId === where.vacancyId);
        if (!profile) {
          profile = { id: `profile_${++counter}`, confirmedAt: null, ...create };
          profiles.push(profile);
        } else {
          Object.assign(profile, create);
        }
        return profile;
      },
      deleteMany: async ({ where }: { where: { vacancyId: string } }) => {
        const remaining = profiles.filter((item) => item.vacancyId !== where.vacancyId);
        const removedCount = profiles.length - remaining.length;
        profiles.length = 0;
        profiles.push(...remaining);
        return { count: removedCount };
      },
    },
    __sessions: sessions,
    __messages: messages,
    __profiles: profiles,
    __vacancies: vacancies,
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

test("GET /prep/:vacancyId returns empty state when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { messages: [], isClosed: false, profile: null });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:vacancyId returns messages and isClosed when session exists", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: false }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
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

test("GET /prep/:vacancyId returns profile when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: null,
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.isClosed, true);
    assert.equal(body.profile.role, "QA Engineer");
    assert.equal(body.profile.confirmedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:vacancyId includes confirmedAt: null in an unconfirmed profile", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: null,
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.confirmedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:vacancyId returns 404 when vacancy does not exist", async () => {
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

test("GET /prep/:vacancyId returns 403 when vacancy belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_other" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/finish extracts profile, saves it, and closes the session", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: false }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/finish`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.role, "Middle Backend Developer");
    assert.equal(body.profile.confirmedAt, null);
    assert.equal(fakePrisma.__sessions[0].isClosed, true);
    assert.equal(fakePrisma.__profiles.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/finish returns confirmedAt: null for a freshly generated profile", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    { id: "m1", sessionId: "session_1", authorType: "HUMAN_HR", content: "Middle Backend Developer", createdAt: new Date(1) }
  );
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return JSON.stringify({
        role: "Middle Backend Developer",
        requirements: ["Node.js"],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/finish`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.confirmedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/confirm sets confirmedAt and moves vacancy to CONFIRMED", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1", status: "DRAFT" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/confirm`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.notEqual(body.profile.confirmedAt, null);
    assert.equal(body.vacancyStatus, "CONFIRMED");
    assert.equal(fakePrisma.__profiles[0].confirmedAt !== null, true);
    assert.equal(fakePrisma.__vacancies[0].status, "CONFIRMED");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/confirm returns 404 when profile does not exist yet", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1", status: "DRAFT" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/confirm`, { method: "POST" });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Profile not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/confirm returns 409 when already confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1", status: "CONFIRMED" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/confirm`, { method: "POST" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Profile already confirmed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/confirm returns 403 when vacancy belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_other" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/confirm`, { method: "POST" });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/confirm returns 404 when vacancy does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/confirm`, { method: "POST" });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/finish returns 404 when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/finish`, { method: "POST" });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/finish returns 409 when session is already closed", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/finish`, { method: "POST" });
    assert.equal(response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/finish returns 502 when LLM returns invalid JSON", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не json"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/finish`, { method: "POST" });
    assert.equal(response.status, 502);
    assert.equal(fakePrisma.__sessions[0].isClosed, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/finish returns 503 when LLM unavailable", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: false }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/finish`, { method: "POST" });
    assert.equal(response.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /prep/:vacancyId removes session, messages, and profile", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: ["не вказано"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: null,
      },
    ],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "AGENT_COMPANY",
    content: "Привіт!",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(fakePrisma.__sessions.length, 0);
    assert.equal(fakePrisma.__messages.length, 0);
    assert.equal(fakePrisma.__profiles.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /prep/:vacancyId returns 409 when profile is confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1", status: "CONFIRMED" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: ["не вказано"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`, { method: "DELETE" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Profile is confirmed and cannot be reset");
    assert.equal(fakePrisma.__sessions.length, 1);
    assert.equal(fakePrisma.__profiles.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /prep/:vacancyId succeeds even when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /prep/:vacancyId returns 403 when vacancy belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_other" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`, { method: "DELETE" });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:vacancyId/message creates session and both messages on first turn", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message saves HR message and extracts readyForConfirmation=true", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: false }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message returns 404 when vacancy does not exist", async () => {
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
    assert.equal(body.error, "Vacancy not found");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:vacancyId/message returns 403 when vacancy belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_other" }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message returns 409 when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message returns 503 when LLM unavailable", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message returns 502 when LLM returns empty response", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message returns 401 without auth when middleware applied", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }] });
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message works with valid token through requireAuth+requireHr", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  const token = signToken({ sub: "hr_1", email: "hr@test.com", role: "HR" });
  const fakePrisma = makeFakePrisma({ vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }] });
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

test("POST /prep/:vacancyId/message returns 500 when persisting agent reply fails", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/message`, {
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

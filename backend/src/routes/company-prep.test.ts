import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { createCompanyPrepRouter } from "./company-prep";
import { LlmUnavailableError } from "../llm/errors";
import { SAFE_LLM_ERROR_UK } from "../llm/retry";
import type { LlmProvider } from "../llm/types";
import type { AuthUser } from "../auth/middleware";

type FakeSession = { id: string; hrUserId: string; isClosed: boolean };
type FakeMessage = {
  id: string;
  sessionId: string;
  authorType: "HUMAN_HR" | "AGENT_COMPANY";
  content: string;
  createdAt: Date;
};
type FakeProfile = {
  id: string;
  hrUserId: string;
  companyName: string | null;
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
  confirmedAt: Date | null;
};

function makeFakePrisma(
  seed: {
    sessions?: FakeSession[];
    profiles?: FakeProfile[];
  } = {}
) {
  const sessions = seed.sessions ?? [];
  const profiles = seed.profiles ?? [];
  const messages: FakeMessage[] = [];
  let counter = 0;

  return {
    prepSessionCompany: {
      findUnique: async ({ where }: { where: { hrUserId: string } }) =>
        sessions.find((item) => item.hrUserId === where.hrUserId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { hrUserId: string };
        create: { hrUserId: string };
      }) => {
        let session = sessions.find((item) => item.hrUserId === where.hrUserId);
        if (!session) {
          session = { id: `session_${++counter}`, hrUserId: create.hrUserId, isClosed: false };
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
    prepMessageCompany: {
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
    hrCompanyProfile: {
      findUnique: async ({ where }: { where: { hrUserId: string } }) =>
        profiles.find((item) => item.hrUserId === where.hrUserId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { hrUserId: string };
        data: Partial<Omit<FakeProfile, "id" | "hrUserId">>;
      }) => {
        const profile = profiles.find((item) => item.hrUserId === where.hrUserId);
        if (!profile) throw new Error("profile not found");
        Object.assign(profile, data);
        return profile;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { hrUserId: string };
        create: Omit<FakeProfile, "id" | "confirmedAt">;
        update: Omit<FakeProfile, "id" | "hrUserId" | "confirmedAt">;
      }) => {
        let profile = profiles.find((item) => item.hrUserId === where.hrUserId);
        if (!profile) {
          profile = { id: `profile_${++counter}`, confirmedAt: null, ...create };
          profiles.push(profile);
        } else {
          Object.assign(profile, update);
        }
        return profile;
      },
      deleteMany: async ({ where }: { where: { hrUserId: string } }) => {
        const remaining = profiles.filter((item) => item.hrUserId !== where.hrUserId);
        const removedCount = profiles.length - remaining.length;
        profiles.length = 0;
        profiles.push(...remaining);
        return { count: removedCount };
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

test("POST /company-prep/message returns safe UK error after LLM retries exhausted", async () => {
  const fakePrisma = makeFakePrisma();
  let completeCalls = 0;
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      completeCalls += 1;
      throw new LlmUnavailableError("omlx server not reachable");
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createCompanyPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/company-prep/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, SAFE_LLM_ERROR_UK);
    assert.equal(body.detail, undefined);
    assert.equal(completeCalls, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /company-prep/finish returns safe UK error after LLM retries exhausted", async () => {
  const fakePrisma = makeFakePrisma({
    sessions: [{ id: "session_1", hrUserId: "hr_1", isClosed: false }],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "HUMAN_HR",
    content: "про компанію",
    createdAt: new Date(1),
  });
  let completeCalls = 0;
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      completeCalls += 1;
      throw new LlmUnavailableError("omlx server not reachable");
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createCompanyPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/company-prep/finish`, {
      method: "POST",
    });

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, SAFE_LLM_ERROR_UK);
    assert.equal(body.detail, undefined);
    assert.equal(completeCalls, 3);
    assert.equal(fakePrisma.__sessions[0].isClosed, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /company-prep/message creates session and returns agent reply", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Привіт! Розкажіть про компанію.\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createCompanyPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/company-prep/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.message, "Привіт! Розкажіть про компанію.");
    assert.equal(body.readyForConfirmation, false);
    assert.equal(fakePrisma.__sessions.length, 1);
    assert.equal(fakePrisma.__sessions[0].hrUserId, "hr_1");
    assert.equal(fakePrisma.__messages.length, 1);
    assert.equal(fakePrisma.__messages[0].authorType, "AGENT_COMPANY");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /company-prep/finish upserts HrCompanyProfile and closes session", async () => {
  const fakePrisma = makeFakePrisma({
    sessions: [{ id: "session_1", hrUserId: "hr_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    { id: "m1", sessionId: "session_1", authorType: "HUMAN_HR", content: "Відкрита культура", createdAt: new Date(1) },
    { id: "m2", sessionId: "session_1", authorType: "AGENT_COMPANY", content: "Дякую.\nREADY:true", createdAt: new Date(2) }
  );
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return JSON.stringify({
        companyName: "Acme Corp",
        culture: ["Відкритість"],
        companyDirection: ["EdTech"],
        policies: ["Remote-first"],
        workFormat: ["Гібрид"],
        onboardingApproach: ["Buddy 2 тижні"],
      });
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createCompanyPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/company-prep/finish`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.companyName, "Acme Corp");
    assert.deepEqual(body.profile.culture, ["Відкритість"]);
    assert.deepEqual(body.profile.companyDirection, ["EdTech"]);
    assert.equal(body.profile.confirmedAt, null);
    assert.equal(fakePrisma.__sessions[0].isClosed, true);
    assert.equal(fakePrisma.__profiles.length, 1);
    assert.equal(fakePrisma.__profiles[0].hrUserId, "hr_1");
    assert.equal(fakePrisma.__profiles[0].companyName, "Acme Corp");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /company-prep resets chat and profile even when confirmedAt is set", async () => {
  const fakePrisma = makeFakePrisma({
    sessions: [{ id: "session_1", hrUserId: "hr_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        hrUserId: "hr_1",
        companyName: "Acme Corp",
        culture: ["Відкритість"],
        companyDirection: ["EdTech"],
        policies: ["Remote-first"],
        workFormat: ["Гібрид"],
        onboardingApproach: ["Buddy 2 тижні"],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createCompanyPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/company-prep`, { method: "DELETE" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true });
    assert.equal(fakePrisma.__sessions.length, 0);
    assert.equal(fakePrisma.__profiles.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("PATCH /company-prep/profile updates fields", async () => {
  const fakePrisma = makeFakePrisma({
    sessions: [{ id: "session_1", hrUserId: "hr_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        hrUserId: "hr_1",
        companyName: "Acme Corp",
        culture: ["Відкритість"],
        companyDirection: ["EdTech"],
        policies: ["Remote-first"],
        workFormat: ["Гібрид"],
        onboardingApproach: ["Buddy 2 тижні"],
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createCompanyPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/company-prep/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: " SoftServe ",
        culture: ["прозорість"],
        companyDirection: ["FinTech"],
        policies: ["remote-first"],
        workFormat: ["Remote"],
        onboardingApproach: ["Ментор 1 місяць"],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.companyName, "SoftServe");
    assert.deepEqual(body.profile.culture, ["прозорість"]);
    assert.deepEqual(body.profile.companyDirection, ["FinTech"]);
    assert.equal(body.profile.confirmedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("PATCH /company-prep/profile succeeds on confirmed profile", async () => {
  const fakePrisma = makeFakePrisma({
    sessions: [{ id: "session_1", hrUserId: "hr_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        hrUserId: "hr_1",
        companyName: "Acme Corp",
        culture: ["Відкритість"],
        companyDirection: ["EdTech"],
        policies: ["Remote-first"],
        workFormat: ["Гібрид"],
        onboardingApproach: ["Buddy 2 тижні"],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createCompanyPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/company-prep/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName: "New Name", culture: ["інше"] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.companyName, "New Name");
    assert.deepEqual(body.profile.culture, ["інше"]);
    assert.notEqual(body.profile.confirmedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

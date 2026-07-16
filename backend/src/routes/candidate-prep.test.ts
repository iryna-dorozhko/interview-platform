import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { requireAuth, requireCandidate, type AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { createCandidatePrepRouter } from "./candidate-prep";
import type { LlmProvider } from "../llm/types";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
test.before(() => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
});
test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

type FakeInterview = {
  id: string;
  vacancyId: string;
  hrUserId: string;
  status?: string;
  candidateUserId?: string | null;
  displayName?: string;
};
type FakeSession = { id: string; interviewId: string; isClosed: boolean };
type FakeMessage = {
  id: string;
  sessionId: string;
  authorType: "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";
  content: string;
  createdAt: Date;
};
type FakeProfile = {
  id: string;
  interviewId: string;
  fullName?: string;
  email?: string;
  phone?: string | null;
  experience: unknown;
  skills: unknown;
  goals: unknown;
  summary: string;
  confirmedAt: Date | null;
};

function makeFakePrisma(
  seed: {
    interviews?: FakeInterview[];
    sessions?: FakeSession[];
    profiles?: FakeProfile[];
    vacancies?: Array<{ id: string; status: string; companyProfile?: { confirmedAt: Date | null } | null }>;
  } = {}
) {
  const interviews = seed.interviews ?? [];
  const sessions = seed.sessions ?? [];
  const profiles = seed.profiles ?? [];
  const vacancies = seed.vacancies ?? [
    { id: "vacancy_1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } },
  ];
  const messages: FakeMessage[] = [];
  let counter = 0;

  return {
    interview: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        interviews.find((item) => {
          const candidateUserId = where.candidateUserId as string | undefined;
          if (candidateUserId != null && item.candidateUserId !== candidateUserId) return false;

          const statusFilter = where.status as { in: string[] } | string | undefined;
          if (typeof statusFilter === "string" && item.status != null && item.status !== statusFilter) {
            return false;
          }
          if (statusFilter && typeof statusFilter === "object" && item.status != null && !statusFilter.in.includes(item.status)) {
            return false;
          }

          const displayName = where.displayName;
          if (
            displayName &&
            typeof displayName === "object" &&
            "not" in displayName &&
            item.displayName === (displayName as { not: string }).not
          ) {
            return false;
          }

          return true;
        }) ?? null,
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: {
          vacancy?: { include?: { companyProfile?: boolean } };
          candidateProfile?: boolean;
        };
      }) => {
        const interview = interviews.find((item) => item.id === where.id) ?? null;
        if (!interview) return null;
        if (!include) return interview;
        const vacancy = vacancies.find((item) => item.id === interview.vacancyId) ?? null;
        return {
          ...interview,
          vacancy: vacancy
            ? {
                status: vacancy.status,
                companyProfile: include.vacancy?.include?.companyProfile ? vacancy.companyProfile : undefined,
              }
            : null,
          candidateProfile: include.candidateProfile
            ? (profiles.find((item) => item.interviewId === interview.id) ?? null)
            : undefined,
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: string };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("interview not found");
        if (data.status !== undefined) interview.status = data.status;
        return interview;
      },
    },
    prepSessionCandidate: {
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
        data: { isClosed?: boolean };
      }) => {
        const session = sessions.find((item) => item.id === where.id);
        if (!session) throw new Error("session not found");
        if (data.isClosed !== undefined) session.isClosed = data.isClosed;
        return session;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = sessions.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("session not found");
        const [removed] = sessions.splice(index, 1);
        return removed;
      },
    },
    prepMessageCandidate: {
      create: async ({
        data,
      }: {
        data: {
          sessionId: string;
          authorType: "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";
          content: string;
        };
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
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { interviewId: string };
        create: Omit<FakeProfile, "id" | "confirmedAt">;
        update: Omit<FakeProfile, "id" | "interviewId" | "confirmedAt">;
      }) => {
        let profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) {
          profile = { id: `profile_${++counter}`, confirmedAt: null, ...create };
          profiles.push(profile);
        } else {
          Object.assign(profile, update);
        }
        return profile;
      },
      update: async ({
        where,
        data,
      }: {
        where: { interviewId: string };
        data: { confirmedAt?: Date };
      }) => {
        const profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) throw new Error("profile not found");
        if (data.confirmedAt !== undefined) profile.confirmedAt = data.confirmedAt;
        return profile;
      },
      deleteMany: async ({ where }: { where: { interviewId: string } }) => {
        const remaining = profiles.filter((item) => item.interviewId !== where.interviewId);
        const removedCount = profiles.length - remaining.length;
        profiles.length = 0;
        profiles.push(...remaining);
        return { count: removedCount };
      },
    },
    __sessions: sessions,
    __messages: messages,
    __profiles: profiles,
    __interviews: interviews,
    __vacancies: vacancies,
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function mountApp(fakePrisma: ReturnType<typeof makeFakePrisma>, fakeProvider: LlmProvider, user: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api/candidate-prep", createCandidatePrepRouter(() => fakePrisma as never, () => fakeProvider));
  return app;
}

test("GET /candidate-prep/:interviewId returns empty state when no session exists", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { messages: [], isClosed: false, profile: null });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message creates session and agent message on first turn", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Вітаю! Розкажіть про ваш досвід.\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.message, "Вітаю! Розкажіть про ваш досвід.");
    assert.equal(body.readyForConfirmation, false);
    assert.equal(fakePrisma.__sessions.length, 1);
    assert.equal(fakePrisma.__messages.length, 1);
    assert.equal(fakePrisma.__messages[0].authorType, "AGENT_CANDIDATE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message saves candidate message and readyForConfirmation=true", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Дякую, цього достатньо.\nREADY:true";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "3 роки backend, Node.js, PostgreSQL" }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.readyForConfirmation, true);
    assert.equal(body.message, "Дякую, цього достатньо.");
    assert.equal(fakePrisma.__messages.length, 2);
    assert.equal(fakePrisma.__messages[0].authorType, "HUMAN_CANDIDATE");
    assert.equal(fakePrisma.__messages[1].authorType, "AGENT_CANDIDATE");
    assert.equal(fakePrisma.__messages[1].content, "Дякую, цього достатньо.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/missing/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Interview not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message returns 409 when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Ще одна відповідь" }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Prep session closed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /candidate-prep/:interviewId removes session, messages, and unconfirmed profile", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: {},
        skills: {},
        goals: {},
        summary: "summary",
        confirmedAt: null,
      },
    ],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "AGENT_CANDIDATE",
    content: "Привіт!",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(fakePrisma.__sessions.length, 0);
    assert.equal(fakePrisma.__messages.length, 0);
    assert.equal(fakePrisma.__profiles.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /candidate-prep/:interviewId removes session, messages, and confirmed profile", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: {},
        skills: {},
        goals: {},
        summary: "summary",
        confirmedAt: new Date("2026-07-08T09:00:00.000Z"),
      },
    ],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "AGENT_CANDIDATE",
    content: "Привіт!",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(fakePrisma.__sessions.length, 0);
    assert.equal(fakePrisma.__messages.length, 0);
    assert.equal(fakePrisma.__profiles.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

const SAMPLE_PROFILE_JSON = JSON.stringify({
  experience: ["3 роки backend"],
  skills: { strong: ["TypeScript"], growth: ["people management"] },
  goals: ["senior role"],
  summary: "Backend-розробник з досвідом у fintech.",
});

const SAMPLE_CONTACT_PROFILE_JSON = JSON.stringify({
  fullName: "Олена Коваленко",
  email: "olena@example.com",
  phone: "+380501234567",
  experience: ["3 роки backend"],
  skills: { strong: ["TypeScript"], growth: ["people management"] },
  goals: ["senior role"],
  summary: "Backend-розробник з досвідом у fintech.",
});

test("finish persists contact fields in candidate profile", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_CANDIDATE",
      content: "Мене звати Олена, email olena@example.com",
      createdAt: new Date(1),
    },
    {
      id: "m2",
      sessionId: "session_1",
      authorType: "AGENT_CANDIDATE",
      content: "Дякую!",
      createdAt: new Date(2),
    }
  );
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return SAMPLE_CONTACT_PROFILE_JSON;
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.fullName, "Олена Коваленко");
    assert.equal(body.profile.email, "olena@example.com");
    assert.equal(body.profile.phone, "+380501234567");
    assert.equal(fakePrisma.__profiles.length, 1);
    assert.equal(fakePrisma.__profiles[0].fullName, "Олена Коваленко");
    assert.equal(fakePrisma.__profiles[0].email, "olena@example.com");
    assert.equal(fakePrisma.__profiles[0].phone, "+380501234567");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/finish extracts profile and closes session", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_CANDIDATE",
      content: "3 роки backend",
      createdAt: new Date(1),
    },
    {
      id: "m2",
      sessionId: "session_1",
      authorType: "AGENT_CANDIDATE",
      content: "Дякую!",
      createdAt: new Date(2),
    }
  );
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return SAMPLE_PROFILE_JSON;
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.profile.experience, ["3 роки backend"]);
    assert.deepEqual(body.profile.skills, { strong: ["TypeScript"], growth: ["people management"] });
    assert.deepEqual(body.profile.goals, ["senior role"]);
    assert.equal(body.profile.summary, "Backend-розробник з досвідом у fintech.");
    assert.equal(body.profile.confirmedAt, null);
    assert.equal(fakePrisma.__sessions[0].isClosed, true);
    assert.equal(fakePrisma.__profiles.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/finish returns 404 when no session exists", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return SAMPLE_PROFILE_JSON;
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Prep session not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/finish returns 409 when session already closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return SAMPLE_PROFILE_JSON;
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Prep session closed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/finish returns 502 when LLM returns invalid JSON", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "HUMAN_CANDIDATE",
    content: "досвід",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не json";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 502);
    assert.equal(fakePrisma.__profiles.length, 0);
    assert.equal(fakePrisma.__sessions[0].isClosed, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/confirm stays AWAITING_CANDIDATE when candidate not joined", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: ["3 роки backend"],
        skills: { strong: ["TypeScript"], growth: ["росту"] },
        goals: ["senior"],
        summary: "Backend dev",
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.notEqual(body.profile.confirmedAt, null);
    assert.equal(body.interviewStatus, "AWAITING_CANDIDATE");
    assert.equal(fakePrisma.__profiles[0].confirmedAt !== null, true);
    assert.equal(fakePrisma.__interviews[0].status, "AWAITING_CANDIDATE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/confirm transitions to READY when candidate joined", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "interview_questionnaire",
        displayName: "Моя анкета",
        vacancyId: "vacancy_1",
        hrUserId: "hr_1",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
      },
      {
        id: "interview_hr",
        displayName: "Frontend Dev",
        vacancyId: "vacancy_1",
        hrUserId: "hr_1",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
      },
    ],
    sessions: [{ id: "session_1", interviewId: "interview_questionnaire", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_questionnaire",
        experience: ["3 роки backend"],
        skills: { strong: ["TypeScript"], growth: ["росту"] },
        goals: ["senior"],
        summary: "Backend dev",
        confirmedAt: null,
      },
    ],
    vacancies: [{ id: "vacancy_1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/candidate-prep/interview_questionnaire/confirm`,
      {
        method: "POST",
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviewStatus, "READY");
    assert.equal(fakePrisma.__interviews[1].status, "READY");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/confirm returns 404 when profile does not exist", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, {
      method: "POST",
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Profile not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/confirm returns 409 when already confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: ["досвід"],
        skills: { strong: ["TS"], growth: ["росту"] },
        goals: ["ціль"],
        summary: "summary",
        confirmedAt: new Date("2026-07-09T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Profile already confirmed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("requireCandidate blocks HR token on candidate-prep routes", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };
  const token = signToken({ sub: "hr_1", email: "hr@test.com", role: "HR" });

  const app = express();
  app.use(express.json());
  app.use("/api/candidate-prep", requireAuth, requireCandidate, createCandidatePrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

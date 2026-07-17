import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createHrApplicationsRouter } from "./hr-applications";

type FakeVacancy = {
  id: string;
  hrUserId: string;
  title: string;
  status: string;
  companyProfile?: { confirmedAt: Date | null } | null;
};

type FakeUser = { id: string; email: string; role: string };

type FakeApplication = {
  id: string;
  candidateUserId: string;
  vacancyId: string;
  matchScore: number;
  candidateSummary: string;
  status: string;
  interviewId: string | null;
  createdAt: Date;
};

type FakeNotification = {
  id: string;
  hrUserId: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
};

type FakeInterview = {
  id: string;
  hrUserId: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  scheduledAt: Date | null;
  candidateUserId: string | null;
  createdAt: Date;
};

type FakeCandidateProfile = {
  interviewId: string;
  fullName: string;
  email: string;
  confirmedAt: Date | null;
};

type FakeQuestionnaireInterview = {
  id: string;
  candidateUserId: string | null;
  displayName: string;
  status: string;
  createdAt: Date;
};

function makeFakePrisma(seed: {
  vacancies?: FakeVacancy[];
  users?: FakeUser[];
  applications?: FakeApplication[];
  notifications?: FakeNotification[];
  interviews?: FakeInterview[];
  questionnaireInterviews?: FakeQuestionnaireInterview[];
  candidateProfiles?: FakeCandidateProfile[];
}) {
  const vacancies = (seed.vacancies ?? []).map((item) => ({ ...item }));
  const users = (seed.users ?? []).map((item) => ({ ...item }));
  const applications = (seed.applications ?? []).map((item) => ({ ...item }));
  const notifications = (seed.notifications ?? []).map((item) => ({ ...item }));
  const interviews = (seed.interviews ?? []).map((item) => ({ ...item }));
  const questionnaireInterviews = (seed.questionnaireInterviews ?? []).map((item) => ({ ...item }));
  const candidateProfiles = (seed.candidateProfiles ?? []).map((item) => ({ ...item }));
  let interviewSeq = interviews.length;
  let invSeq = 0;
  const invitations: Array<{
    id: string;
    interviewId: string;
    email: string;
    status: string;
  }> = [];

  const prisma = {
    vacancy: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { companyProfile?: boolean };
      }) => {
        const vacancy = vacancies.find((item) => item.id === where.id) ?? null;
        if (!vacancy) return null;
        return {
          ...vacancy,
          ...(include?.companyProfile
            ? { companyProfile: vacancy.companyProfile ?? null }
            : {}),
        };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        return null;
      },
    },
    vacancyApplication: {
      findMany: async ({
        where,
        include,
        orderBy,
      }: {
        where?: { vacancy?: { hrUserId: string } };
        include?: { vacancy?: boolean | { select: { id: true; title: true } } };
        orderBy?: { createdAt: "desc" | "asc" };
      }) => {
        let rows = applications.filter((app) => {
          if (where?.vacancy?.hrUserId != null) {
            const vacancy = vacancies.find((v) => v.id === app.vacancyId);
            if (!vacancy || vacancy.hrUserId !== where.vacancy.hrUserId) return false;
          }
          return true;
        });
        if (orderBy?.createdAt === "desc") {
          rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return rows.map((app) => {
          const vacancy = vacancies.find((v) => v.id === app.vacancyId);
          return {
            ...app,
            ...(include?.vacancy
              ? {
                  vacancy: vacancy
                    ? { id: vacancy.id, title: vacancy.title }
                    : null,
                }
              : {}),
          };
        });
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: {
          vacancy?: boolean | { select?: Record<string, boolean> };
          candidateUser?: boolean | { select?: Record<string, boolean> };
        };
      }) => {
        const app = applications.find((item) => item.id === where.id) ?? null;
        if (!app) return null;
        const vacancy = vacancies.find((v) => v.id === app.vacancyId);
        const candidateUser = users.find((u) => u.id === app.candidateUserId);
        return {
          ...app,
          ...(include?.vacancy
            ? {
                vacancy: vacancy
                  ? {
                      id: vacancy.id,
                      title: vacancy.title,
                      hrUserId: vacancy.hrUserId,
                      status: vacancy.status,
                      companyProfile: vacancy.companyProfile ?? null,
                    }
                  : null,
              }
            : {}),
          ...(include?.candidateUser
            ? {
                candidateUser: candidateUser
                  ? { id: candidateUser.id, email: candidateUser.email }
                  : null,
              }
            : {}),
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeApplication>;
      }) => {
        const app = applications.find((item) => item.id === where.id);
        if (!app) throw new Error("application not found");
        Object.assign(app, data);
        return { ...app };
      },
    },
    hrNotification: {
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { hrUserId: string };
        orderBy?: Array<Record<string, string>> | Record<string, string>;
      }) => {
        let rows = notifications.filter((item) =>
          where?.hrUserId != null ? item.hrUserId === where.hrUserId : true,
        );
        // Unread first (readAt null), then createdAt desc — approximate sort for tests
        rows = [...rows].sort((a, b) => {
          const aUnread = a.readAt == null ? 0 : 1;
          const bUnread = b.readAt == null ? 0 : 1;
          if (aUnread !== bUnread) return aUnread - bUnread;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        void orderBy;
        return rows.map((item) => ({ ...item }));
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        notifications.find((item) => item.id === where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { readAt: Date };
      }) => {
        const item = notifications.find((n) => n.id === where.id);
        if (!item) throw new Error("notification not found");
        item.readAt = data.readAt;
        return { ...item };
      },
    },
    interview: {
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
        const interview =
          interviews.find((item) => item.id === where.id) ??
          questionnaireInterviews.find((item) => item.id === where.id) ??
          null;
        if (!interview) return null;
        const vacancy =
          "vacancyId" in interview
            ? vacancies.find((v) => v.id === (interview as FakeInterview).vacancyId)
            : null;
        return {
          ...interview,
          ...(include?.vacancy
            ? {
                vacancy: vacancy
                  ? {
                      ...vacancy,
                      companyProfile: vacancy.companyProfile ?? null,
                    }
                  : null,
              }
            : {}),
          ...(include?.candidateProfile
            ? {
                candidateProfile:
                  candidateProfiles.find((p) => p.interviewId === interview.id) ?? null,
              }
            : {}),
        };
      },
      findFirst: async ({
        where,
      }: {
        where: Record<string, unknown>;
        orderBy?: { createdAt: "desc" | "asc" };
      }) => {
        const pool = [...questionnaireInterviews, ...interviews];
        const matches = pool.filter((item) => {
          if (
            where.candidateUserId != null &&
            item.candidateUserId !== where.candidateUserId
          ) {
            return false;
          }
          if (typeof where.displayName === "string" && item.displayName !== where.displayName) {
            return false;
          }
          if (
            where.displayName &&
            typeof where.displayName === "object" &&
            "not" in (where.displayName as object)
          ) {
            const notVal = (where.displayName as { not: string }).not;
            if (item.displayName === notVal) return false;
          }
          const statusFilter = where.status as { in: string[] } | undefined;
          if (statusFilter?.in && !statusFilter.in.includes(item.status)) return false;
          return true;
        });
        return matches[0] ?? null;
      },
      create: async ({
        data,
      }: {
        data: {
          hrUserId: string;
          vacancyId: string;
          displayName: string;
          joinCode: string;
          status: string;
          scheduledAt?: Date | null;
          candidateUserId?: string | null;
        };
      }) => {
        interviewSeq += 1;
        const created: FakeInterview = {
          id: `int_${interviewSeq}`,
          hrUserId: data.hrUserId,
          vacancyId: data.vacancyId,
          displayName: data.displayName,
          joinCode: data.joinCode,
          status: data.status,
          scheduledAt: data.scheduledAt ?? null,
          candidateUserId: data.candidateUserId ?? null,
          createdAt: new Date(),
        };
        interviews.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: string; candidateUserId?: string | null };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("interview not found");
        if (data.status !== undefined) interview.status = data.status;
        if (data.candidateUserId !== undefined) {
          interview.candidateUserId = data.candidateUserId;
        }
        return { ...interview };
      },
    },
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        candidateProfiles.find((item) => item.interviewId === where.interviewId) ?? null,
    },
    invitation: {
      create: async ({
        data,
      }: {
        data: { interviewId: string; email: string; status: string };
      }) => {
        invSeq += 1;
        const created = {
          id: `inv_${invSeq}`,
          interviewId: data.interviewId,
          email: data.email,
          status: data.status,
        };
        invitations.push(created);
        return created;
      },
    },
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => fn(prisma),
  };

  return { prisma, applications, interviews, notifications, invitations };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>["prisma"], user: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createHrApplicationsRouter(() => fakePrisma as never));
  return app;
}

test("GET /hr/applications returns only own vacancy applications", async () => {
  const { prisma } = makeFakePrisma({
    vacancies: [
      { id: "v1", hrUserId: "hr_1", title: "Frontend", status: "CONFIRMED" },
      { id: "v2", hrUserId: "hr_2", title: "Backend", status: "CONFIRMED" },
    ],
    applications: [
      {
        id: "app_1",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        matchScore: 80,
        candidateSummary: "Strong FE",
        status: "PENDING",
        interviewId: null,
        createdAt: new Date("2026-07-01T10:00:00Z"),
      },
      {
        id: "app_2",
        candidateUserId: "cd_2",
        vacancyId: "v2",
        matchScore: 70,
        candidateSummary: "Strong BE",
        status: "PENDING",
        interviewId: null,
        createdAt: new Date("2026-07-02T10:00:00Z"),
      },
    ],
  });
  const app = makeApp(prisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/applications`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.applications.length, 1);
    assert.equal(body.applications[0].id, "app_1");
    assert.equal(body.applications[0].vacancyTitle, "Frontend");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /hr/applications/:id returns 404 for other HR", async () => {
  const { prisma } = makeFakePrisma({
    vacancies: [{ id: "v1", hrUserId: "hr_1", title: "Frontend", status: "CONFIRMED" }],
    users: [{ id: "cd_1", email: "cd@test.com", role: "CANDIDATE" }],
    applications: [
      {
        id: "app_1",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        matchScore: 80,
        candidateSummary: "Strong FE",
        status: "PENDING",
        interviewId: null,
        createdAt: new Date(),
      },
    ],
  });
  const app = makeApp(prisma, { id: "hr_other", email: "other@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/applications/app_1`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/notifications/:id/read marks readAt", async () => {
  const { prisma, notifications } = makeFakePrisma({
    notifications: [
      {
        id: "n1",
        hrUserId: "hr_1",
        type: "VACANCY_APPLICATION",
        payload: { applicationId: "app_1" },
        readAt: null,
        createdAt: new Date(),
      },
    ],
  });
  const app = makeApp(prisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/notifications/n1/read`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.notification.readAt);
    assert.ok(notifications[0].readAt instanceof Date);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/applications/:id/create-interview converts PENDING and links interview", async () => {
  const { prisma, applications, interviews } = makeFakePrisma({
    vacancies: [
      {
        id: "v1",
        hrUserId: "hr_1",
        title: "Frontend",
        status: "CONFIRMED",
        companyProfile: { confirmedAt: new Date() },
      },
    ],
    users: [{ id: "cd_1", email: "cd@test.com", role: "CANDIDATE" }],
    applications: [
      {
        id: "app_1",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        matchScore: 80,
        candidateSummary: "Strong FE",
        status: "PENDING",
        interviewId: null,
        createdAt: new Date(),
      },
    ],
    questionnaireInterviews: [
      {
        id: "q1",
        candidateUserId: "cd_1",
        displayName: "Моя анкета",
        status: "READY",
        createdAt: new Date(),
      },
    ],
    candidateProfiles: [
      {
        interviewId: "q1",
        fullName: "Anna Candidate",
        email: "cd@test.com",
        confirmedAt: new Date(),
      },
    ],
  });
  const app = makeApp(prisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/hr/applications/app_1/create-interview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(applications[0].status, "CONVERTED");
    assert.ok(applications[0].interviewId);
    assert.equal(body.interview.id, applications[0].interviewId);
    assert.equal(interviews[0].candidateUserId, "cd_1");
    assert.equal(interviews[0].vacancyId, "v1");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/applications/:id/create-interview returns 409 when not PENDING", async () => {
  const { prisma } = makeFakePrisma({
    vacancies: [{ id: "v1", hrUserId: "hr_1", title: "Frontend", status: "CONFIRMED" }],
    users: [{ id: "cd_1", email: "cd@test.com", role: "CANDIDATE" }],
    applications: [
      {
        id: "app_1",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        matchScore: 80,
        candidateSummary: "Strong FE",
        status: "CONVERTED",
        interviewId: "int_old",
        createdAt: new Date(),
      },
    ],
  });
  const app = makeApp(prisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/hr/applications/app_1/create-interview`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    assert.equal(response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME } from "../utils/candidate-interview-kind";
import { createHrAdditionalInterviewsRouter } from "./hr-additional-interviews";
import { createInterviewWithJoinCode } from "./interviews";

type FakeUser = { id: string; email: string; role: string };

type FakeVacancy = {
  id: string;
  hrUserId: string;
  title: string;
  status?: string;
  hiddenAt?: Date | null;
  companyProfile?: { confirmedAt: Date | null } | null;
};

type FakeInterview = {
  id: string;
  hrUserId: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  kind: string;
  followUpFromFinalReportId: string | null;
  scheduledAt: Date | null;
  candidateUserId: string | null;
  createdAt: Date;
};

type FakeQuestionnaireInterview = {
  id: string;
  candidateUserId: string;
  displayName: string;
  status: string;
  createdAt: Date;
};

type FakeCandidateProfile = {
  interviewId: string;
  fullName: string;
  email: string;
  confirmedAt: Date | null;
};

type FakeDecision = {
  id: string;
  interviewId: string;
  finalReportId: string;
  decidedByUserId: string;
  type: string;
  letterBody: string;
  createdAt: Date;
};

function makeFakePrisma(seed: {
  users?: FakeUser[];
  vacancies?: FakeVacancy[];
  interviews?: FakeInterview[];
  decisions?: FakeDecision[];
  questionnaireInterviews?: FakeQuestionnaireInterview[];
  candidateProfiles?: FakeCandidateProfile[];
}) {
  const users = (seed.users ?? []).map((item) => ({ ...item }));
  const vacancies = (seed.vacancies ?? []).map((item) => ({
    ...item,
    status: item.status ?? "CONFIRMED",
    hiddenAt: item.hiddenAt ?? null,
    companyProfile: item.companyProfile ?? null,
  }));
  const interviews = (seed.interviews ?? []).map((item) => ({ ...item }));
  const decisions = (seed.decisions ?? []).map((item) => ({ ...item }));
  const questionnaireInterviews = (seed.questionnaireInterviews ?? []).map((item) => ({
    ...item,
  }));
  const candidateProfiles = (seed.candidateProfiles ?? []).map((item) => ({ ...item }));
  let interviewSeq = interviews.length;
  let invSeq = 0;
  const invitations: Array<{
    id: string;
    interviewId: string;
    email: string;
    status: string;
  }> = [];

  function decisionWithIncludes(decision: FakeDecision) {
    const interview = interviews.find((item) => item.id === decision.interviewId);
    if (!interview) return { ...decision, interview: null };
    const vacancy = vacancies.find((item) => item.id === interview.vacancyId) ?? null;
    const candidateUser = interview.candidateUserId
      ? (users.find((item) => item.id === interview.candidateUserId) ?? null)
      : null;
    return {
      ...decision,
      interview: {
        ...interview,
        vacancy: vacancy
          ? {
              id: vacancy.id,
              title: vacancy.title,
              status: vacancy.status,
              hiddenAt: vacancy.hiddenAt,
            }
          : null,
        candidateUser: candidateUser
          ? { id: candidateUser.id, email: candidateUser.email }
          : null,
      },
    };
  }

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        return null;
      },
    },
    interviewDecision: {
      findMany: async ({
        where,
        orderBy,
        include,
      }: {
        where?: { decidedByUserId?: string; type?: string };
        orderBy?: { createdAt: "desc" | "asc" };
        include?: unknown;
      }) => {
        void include;
        let matched = decisions.filter((d) => {
          if (where?.decidedByUserId != null && d.decidedByUserId !== where.decidedByUserId) {
            return false;
          }
          if (where?.type != null && d.type !== where.type) return false;
          return true;
        });
        if (orderBy?.createdAt === "desc") {
          matched = [...matched].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        } else if (orderBy?.createdAt === "asc") {
          matched = [...matched].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
        }
        return matched.map(decisionWithIncludes);
      },
      findFirst: async ({
        where,
        orderBy,
        include,
      }: {
        where?: {
          decidedByUserId?: string;
          type?: string;
          interview?: { candidateUserId?: string };
        };
        orderBy?: { createdAt: "desc" | "asc" };
        include?: unknown;
      }) => {
        void include;
        let matched = decisions.filter((d) => {
          if (where?.decidedByUserId != null && d.decidedByUserId !== where.decidedByUserId) {
            return false;
          }
          if (where?.type != null && d.type !== where.type) return false;
          if (where?.interview?.candidateUserId != null) {
            const interview = interviews.find((item) => item.id === d.interviewId);
            if (!interview || interview.candidateUserId !== where.interview.candidateUserId) {
              return false;
            }
          }
          return true;
        });
        if (orderBy?.createdAt === "desc") {
          matched = [...matched].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        }
        const latest = matched[0];
        return latest ? decisionWithIncludes(latest) : null;
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
          const statusFilter = where.status as { in: string[] } | string | undefined;
          if (statusFilter && typeof statusFilter === "object" && "in" in statusFilter) {
            if (!statusFilter.in.includes(item.status)) return false;
          } else if (typeof statusFilter === "string" && item.status !== statusFilter) {
            return false;
          }
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
          kind?: string;
          followUpFromFinalReportId?: string | null;
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
          kind: data.kind ?? "STANDARD",
          followUpFromFinalReportId: data.followUpFromFinalReportId ?? null,
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
        data: { status?: string };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("interview not found");
        if (data.status !== undefined) interview.status = data.status;
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
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => {
      const interviewsSnap = interviews.map((item) => ({ ...item }));
      const invitationsSnap = invitations.map((item) => ({ ...item }));
      const interviewSeqSnap = interviewSeq;
      const invSeqSnap = invSeq;
      try {
        return await fn(prisma);
      } catch (error) {
        interviews.length = 0;
        interviews.push(...interviewsSnap);
        invitations.length = 0;
        invitations.push(...invitationsSnap);
        interviewSeq = interviewSeqSnap;
        invSeq = invSeqSnap;
        throw error;
      }
    },
    __interviews: interviews,
    __invitations: invitations,
  };

  return { prisma, interviews, invitations };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(
  fakePrisma: ReturnType<typeof makeFakePrisma>["prisma"],
  user: AuthUser,
) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createHrAdditionalInterviewsRouter(() => fakePrisma as never));
  return app;
}

const hrUser: AuthUser = { id: "hr_1", email: "hr@example.com", role: "HR" };

test("GET /hr/additional-meeting-candidates returns latest additional-meeting decisions per candidate", async () => {
  const { prisma } = makeFakePrisma({
    users: [
      { id: "cd_1", email: "c1@example.com", role: "CANDIDATE" },
      { id: "cd_2", email: "c2@example.com", role: "CANDIDATE" },
    ],
    vacancies: [
      { id: "vac_1", hrUserId: "hr_1", title: "Backend" },
      { id: "vac_2", hrUserId: "hr_1", title: "Frontend" },
      { id: "vac_other", hrUserId: "hr_2", title: "Other" },
    ],
    interviews: [
      {
        id: "int_old",
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "AAAAAA",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        id: "int_new",
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "BBBBBB",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-10T00:00:00.000Z"),
      },
      {
        id: "int_2",
        hrUserId: "hr_1",
        vacancyId: "vac_2",
        displayName: "Frontend",
        joinCode: "CCCCCC",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_2",
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
      },
      {
        id: "int_other",
        hrUserId: "hr_2",
        vacancyId: "vac_other",
        displayName: "Other",
        joinCode: "DDDDDD",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-12T00:00:00.000Z"),
      },
    ],
    decisions: [
      {
        id: "dec_old",
        interviewId: "int_old",
        finalReportId: "report_old",
        decidedByUserId: "hr_1",
        type: "ADDITIONAL_MEETING",
        letterBody: "old",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
      {
        id: "dec_new",
        interviewId: "int_new",
        finalReportId: "report_1",
        decidedByUserId: "hr_1",
        type: "ADDITIONAL_MEETING",
        letterBody: "new",
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
      },
      {
        id: "dec_2",
        interviewId: "int_2",
        finalReportId: "report_2",
        decidedByUserId: "hr_1",
        type: "ADDITIONAL_MEETING",
        letterBody: "c2",
        createdAt: new Date("2026-07-12T00:00:00.000Z"),
      },
      {
        id: "dec_accept",
        interviewId: "int_new",
        finalReportId: "report_accept",
        decidedByUserId: "hr_1",
        type: "ACCEPT",
        letterBody: "accept",
        createdAt: new Date("2026-07-13T00:00:00.000Z"),
      },
      {
        id: "dec_other_hr",
        interviewId: "int_other",
        finalReportId: "report_other",
        decidedByUserId: "hr_2",
        type: "ADDITIONAL_MEETING",
        letterBody: "other",
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      },
    ],
  });

  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/hr/additional-meeting-candidates`,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      candidates: Array<{
        candidateUserId: string;
        candidateEmail: string;
        vacancyId: string;
        vacancyTitle: string;
      }>;
    };
    assert.equal(body.candidates.length, 2);

    const byId = new Map(body.candidates.map((c) => [c.candidateUserId, c]));
    assert.deepEqual(byId.get("cd_1"), {
      candidateUserId: "cd_1",
      candidateEmail: "c1@example.com",
      vacancyId: "vac_1",
      vacancyTitle: "Backend",
    });
    assert.deepEqual(byId.get("cd_2"), {
      candidateUserId: "cd_2",
      candidateEmail: "c2@example.com",
      vacancyId: "vac_2",
      vacancyTitle: "Frontend",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/interviews/additional creates interview with kind and followUpFromFinalReportId", async () => {
  const { prisma, interviews, invitations } = makeFakePrisma({
    users: [{ id: "cd_1", email: "c1@example.com", role: "CANDIDATE" }],
    vacancies: [{ id: "vac_1", hrUserId: "hr_1", title: "Backend" }],
    interviews: [
      {
        id: "int_src",
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "AAAAAA",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    decisions: [
      {
        id: "dec_1",
        interviewId: "int_src",
        finalReportId: "report_1",
        decidedByUserId: "hr_1",
        type: "ADDITIONAL_MEETING",
        letterBody: "need more",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
  });

  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/interviews/additional`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateUserId: "cd_1",
        scheduledAt: "2026-08-01T10:00:00.000Z",
      }),
    });

    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      interview: {
        kind: string;
        followUpFromFinalReportId: string | null;
        status: string;
      };
    };
    assert.equal(body.interview.kind, "ADDITIONAL_MEETING");
    assert.equal(body.interview.followUpFromFinalReportId, "report_1");
    assert.equal(body.interview.status, "AWAITING_CANDIDATE");

    const created = interviews.find((item) => item.kind === "ADDITIONAL_MEETING");
    assert.ok(created);
    assert.equal(created.followUpFromFinalReportId, "report_1");
    assert.equal(created.candidateUserId, "cd_1");
    assert.equal(created.status, "AWAITING_CANDIDATE");
    assert.equal(invitations.length, 1);
    assert.equal(invitations[0]!.status, "ACCEPTED");
    assert.equal(invitations[0]!.email, "c1@example.com");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/interviews/additional transitions to READY when questionnaire and company profile are ready", async () => {
  const { prisma, interviews } = makeFakePrisma({
    users: [{ id: "cd_1", email: "c1@example.com", role: "CANDIDATE" }],
    vacancies: [
      {
        id: "vac_1",
        hrUserId: "hr_1",
        title: "Backend",
        status: "CONFIRMED",
        companyProfile: { confirmedAt: new Date("2026-07-01T00:00:00.000Z") },
      },
    ],
    interviews: [
      {
        id: "int_src",
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "AAAAAA",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    decisions: [
      {
        id: "dec_1",
        interviewId: "int_src",
        finalReportId: "report_1",
        decidedByUserId: "hr_1",
        type: "ADDITIONAL_MEETING",
        letterBody: "need more",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
    questionnaireInterviews: [
      {
        id: "q1",
        candidateUserId: "cd_1",
        displayName: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME,
        status: "READY",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    candidateProfiles: [
      {
        interviewId: "q1",
        fullName: "Candidate One",
        email: "c1@example.com",
        confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
  });

  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/interviews/additional`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cd_1" }),
    });

    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      interview: {
        status: string;
        kind: string;
        followUpFromFinalReportId: string | null;
      };
    };
    assert.equal(body.interview.status, "READY");
    assert.equal(body.interview.kind, "ADDITIONAL_MEETING");
    assert.equal(body.interview.followUpFromFinalReportId, "report_1");

    const created = interviews.find((item) => item.kind === "ADDITIONAL_MEETING");
    assert.ok(created);
    assert.equal(created.status, "READY");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/interviews/additional returns 404 when no additional-meeting decision exists", async () => {
  const { prisma } = makeFakePrisma({
    users: [{ id: "cd_1", email: "c1@example.com", role: "CANDIDATE" }],
    vacancies: [{ id: "vac_1", hrUserId: "hr_1", title: "Backend" }],
    interviews: [
      {
        id: "int_src",
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "AAAAAA",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    decisions: [
      {
        id: "dec_1",
        interviewId: "int_src",
        finalReportId: "report_1",
        decidedByUserId: "hr_1",
        type: "ACCEPT",
        letterBody: "ok",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
  });

  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/interviews/additional`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cd_1" }),
    });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/interviews/additional returns 404 for another HR decision", async () => {
  const { prisma } = makeFakePrisma({
    users: [{ id: "cd_1", email: "c1@example.com", role: "CANDIDATE" }],
    vacancies: [{ id: "vac_1", hrUserId: "hr_2", title: "Backend" }],
    interviews: [
      {
        id: "int_src",
        hrUserId: "hr_2",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "AAAAAA",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    decisions: [
      {
        id: "dec_1",
        interviewId: "int_src",
        finalReportId: "report_1",
        decidedByUserId: "hr_2",
        type: "ADDITIONAL_MEETING",
        letterBody: "need more",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
  });

  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/interviews/additional`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cd_1" }),
    });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/interviews/additional returns 400 when vacancy is not confirmed", async () => {
  const { prisma, interviews } = makeFakePrisma({
    users: [{ id: "cd_1", email: "c1@example.com", role: "CANDIDATE" }],
    vacancies: [
      { id: "vac_1", hrUserId: "hr_1", title: "Backend", status: "DRAFT" },
    ],
    interviews: [
      {
        id: "int_src",
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "AAAAAA",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    decisions: [
      {
        id: "dec_1",
        interviewId: "int_src",
        finalReportId: "report_1",
        decidedByUserId: "hr_1",
        type: "ADDITIONAL_MEETING",
        letterBody: "need more",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
  });

  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/interviews/additional`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cd_1" }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "Vacancy is not confirmed");
    assert.equal(
      interviews.filter((item) => item.kind === "ADDITIONAL_MEETING").length,
      0,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /hr/interviews/additional returns 409 VACANCY_HIDDEN when vacancy is hidden", async () => {
  const { prisma, interviews } = makeFakePrisma({
    users: [{ id: "cd_1", email: "c1@example.com", role: "CANDIDATE" }],
    vacancies: [
      {
        id: "vac_1",
        hrUserId: "hr_1",
        title: "Backend",
        status: "CONFIRMED",
        hiddenAt: new Date("2026-07-15T00:00:00.000Z"),
      },
    ],
    interviews: [
      {
        id: "int_src",
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        joinCode: "AAAAAA",
        status: "COMPLETED",
        kind: "STANDARD",
        followUpFromFinalReportId: null,
        scheduledAt: null,
        candidateUserId: "cd_1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    decisions: [
      {
        id: "dec_1",
        interviewId: "int_src",
        finalReportId: "report_1",
        decidedByUserId: "hr_1",
        type: "ADDITIONAL_MEETING",
        letterBody: "need more",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
  });

  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/interviews/additional`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cd_1" }),
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "VACANCY_HIDDEN");
    assert.equal(
      interviews.filter((item) => item.kind === "ADDITIONAL_MEETING").length,
      0,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("createInterviewWithJoinCode requires followUpFromFinalReportId for ADDITIONAL_MEETING", async () => {
  await assert.rejects(
    () =>
      createInterviewWithJoinCode({} as never, {
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        scheduledAt: null,
        kind: "ADDITIONAL_MEETING",
      }),
    /followUpFromFinalReportId is required for ADDITIONAL_MEETING interviews/,
  );

  await assert.rejects(
    () =>
      createInterviewWithJoinCode({} as never, {
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        scheduledAt: null,
        kind: "ADDITIONAL_MEETING",
        followUpFromFinalReportId: "   ",
      }),
    /followUpFromFinalReportId is required for ADDITIONAL_MEETING interviews/,
  );

  await assert.rejects(
    () =>
      createInterviewWithJoinCode({} as never, {
        hrUserId: "hr_1",
        vacancyId: "vac_1",
        displayName: "Backend",
        scheduledAt: null,
        kind: "ADDITIONAL_MEETING",
        followUpFromFinalReportId: null,
      }),
    /followUpFromFinalReportId is required for ADDITIONAL_MEETING interviews/,
  );
});

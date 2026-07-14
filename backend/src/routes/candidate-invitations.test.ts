import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { createCandidateInvitationsRouter } from "./candidate-invitations";

process.env.JWT_SECRET = "test-secret-min-8-chars";

type FakeInterview = {
  id: string;
  displayName: string;
  joinCode: string;
  candidateUserId: string | null;
  status: string;
  createdAt: Date;
  scheduledAt: Date | null;
  hrUserId?: string;
  vacancyId?: string;
};

type FakeInvitation = {
  id: string;
  interviewId: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type FakeCandidateProfile = {
  interviewId: string;
  confirmedAt: Date | null;
};

function matchesFindFirstWhere(item: FakeInterview, where: Record<string, unknown>): boolean {
  const candidateUserId = where.candidateUserId as string | undefined;
  if (candidateUserId != null && item.candidateUserId !== candidateUserId) return false;

  const statusFilter = where.status as { in: string[] } | undefined;
  if (statusFilter && !statusFilter.in.includes(item.status)) return false;

  const notFilter = where.NOT as { id: string } | undefined;
  if (notFilter && item.id === notFilter.id) return false;

  const displayName = where.displayName;
  if (typeof displayName === "string" && item.displayName !== displayName) return false;
  if (
    displayName &&
    typeof displayName === "object" &&
    "not" in displayName &&
    item.displayName === (displayName as { not: string }).not
  ) {
    return false;
  }

  return true;
}

function makeFakePrisma(
  interviews: FakeInterview[] = [],
  invitations: FakeInvitation[] = [],
  options?: {
    candidateProfiles?: FakeCandidateProfile[];
  },
) {
  const candidateProfiles = (options?.candidateProfiles ?? []).map((item) => ({ ...item }));
  let invCounter = invitations.length;

  return {
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        candidateProfiles.find((item) => item.interviewId === where.interviewId) ?? null,
    },
    invitation: {
      findMany: async ({
        where,
        include,
        orderBy,
      }: {
        where: { email: string; status: string };
        include?: { interview: { select: { id: boolean; displayName: boolean; scheduledAt: boolean } } };
        orderBy?: { createdAt: "desc" | "asc" };
      }) => {
        let filtered = invitations.filter(
          (item) => item.email === where.email && item.status === where.status,
        );
        if (orderBy?.createdAt === "desc") {
          filtered = filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return filtered.map((item) => {
          const interview = interviews.find((i) => i.id === item.interviewId);
          if (!include?.interview) return item;
          return {
            ...item,
            interview: {
              id: interview!.id,
              displayName: interview!.displayName,
              scheduledAt: interview!.scheduledAt,
            },
          };
        });
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { interview: boolean };
      }) => {
        const invitation = invitations.find((item) => item.id === where.id) ?? null;
        if (!invitation) return null;
        if (!include?.interview) return invitation;
        const interview = interviews.find((item) => item.id === invitation.interviewId);
        return { ...invitation, interview };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: string };
      }) => {
        const invitation = invitations.find((item) => item.id === where.id);
        if (!invitation) throw new Error("Invitation not found");
        if (data.status !== undefined) invitation.status = data.status;
        invitation.updatedAt = new Date();
        return invitation;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { interviewId: string; status: string };
        data: { status: string };
      }) => {
        let count = 0;
        for (const invitation of invitations) {
          if (invitation.interviewId === where.interviewId && invitation.status === where.status) {
            invitation.status = data.status;
            invitation.updatedAt = new Date();
            count++;
          }
        }
        return { count };
      },
      create: async ({
        data,
      }: {
        data: { interviewId: string; email: string; status: string };
      }) => {
        invCounter += 1;
        const created: FakeInvitation = {
          id: `inv_${invCounter}`,
          interviewId: data.interviewId,
          email: data.email,
          status: data.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        invitations.push(created);
        return created;
      },
    },
    interview: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        interviews.find((item) => matchesFindFirstWhere(item, where)) ?? null,
      findUnique: async ({
        where,
        include,
      }: {
        where: { id?: string; joinCode?: string };
        include?: {
          vacancy?: { include?: { companyProfile?: boolean } };
          candidateProfile?: boolean;
        };
      }) => {
        const interview =
          where.id != null
            ? (interviews.find((item) => item.id === where.id) ?? null)
            : where.joinCode != null
              ? (interviews.find((item) => item.joinCode === where.joinCode) ?? null)
              : null;
        if (!interview || !include) return interview;
        return {
          ...interview,
          vacancy: {
            status: "CONFIRMED",
            companyProfile: include.vacancy?.include?.companyProfile
              ? { confirmedAt: new Date(1) }
              : undefined,
          },
          candidateProfile: include.candidateProfile
            ? candidateProfiles.find((item) => item.interviewId === interview.id) ?? null
            : undefined,
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { candidateUserId?: string; status?: string };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("Interview not found");
        if (data.candidateUserId !== undefined) interview.candidateUserId = data.candidateUserId;
        if (data.status !== undefined) interview.status = data.status;
        return interview;
      },
    },
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeFakePrisma>) => Promise<T>) => fn(makeFakePrisma(interviews, invitations, options)),
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use("/api/candidate", createCandidateInvitationsRouter(() => fakePrisma as never));
  return app;
}

function authHeaders(user: AuthUser): Record<string, string> {
  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  return { Authorization: `Bearer ${token}` };
}

const candidateUser: AuthUser = {
  id: "candidate_1",
  email: "candidate@test.com",
  role: "CANDIDATE",
};

const confirmedQuestionnaireInterview: FakeInterview = {
  id: "interview_questionnaire",
  displayName: "Моя анкета",
  joinCode: "SELF01",
  candidateUserId: "candidate_1",
  status: "AWAITING_CANDIDATE",
  createdAt: new Date(),
  scheduledAt: null,
};

const confirmedQuestionnaireProfile: FakeCandidateProfile = {
  interviewId: "interview_questionnaire",
  confirmedAt: new Date(),
};

function makeFakePrismaWithConfirmedQuestionnaire(
  interviews: FakeInterview[] = [],
  invitations: FakeInvitation[] = [],
) {
  return makeFakePrisma([confirmedQuestionnaireInterview, ...interviews], invitations, {
    candidateProfiles: [confirmedQuestionnaireProfile],
  });
}

test("GET /candidate/invitations returns PENDING for matching email", async () => {
  const scheduledAt = new Date("2026-07-15T14:00:00.000Z");
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "interview_1",
        displayName: "Backend Engineer",
        joinCode: "TEST01",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt,
      },
    ],
    [
      {
        id: "inv_1",
        interviewId: "interview_1",
        email: "candidate@test.com",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  );
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/invitations`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.invitations.length, 1);
    assert.equal(body.invitations[0].id, "inv_1");
    assert.equal(body.invitations[0].interviewId, "interview_1");
    assert.equal(body.invitations[0].displayName, "Backend Engineer");
    assert.equal(body.invitations[0].scheduledAt, scheduledAt.toISOString());
    assert.equal(body.invitations[0].status, "PENDING");
  } finally {
    server.close();
  }
});

test("GET /candidate/invitations ignores other emails and non-PENDING", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "interview_1",
        displayName: "Mine",
        joinCode: "MINE01",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
      {
        id: "interview_2",
        displayName: "Other",
        joinCode: "OTH001",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
      {
        id: "interview_3",
        displayName: "Declined",
        joinCode: "DEC001",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
    ],
    [
      {
        id: "inv_mine",
        interviewId: "interview_1",
        email: "candidate@test.com",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "inv_other",
        interviewId: "interview_2",
        email: "other@test.com",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "inv_declined",
        interviewId: "interview_3",
        email: "candidate@test.com",
        status: "DECLINED",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  );
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/invitations`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.invitations.length, 1);
    assert.equal(body.invitations[0].id, "inv_mine");
  } finally {
    server.close();
  }
});

test("POST accept binds candidate and sets ACCEPTED", async () => {
  const interviews: FakeInterview[] = [
    {
      id: "interview_1",
      displayName: "Backend Engineer",
      joinCode: "TEST01",
      candidateUserId: null,
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
      scheduledAt: null,
    },
  ];
  const invitations: FakeInvitation[] = [
    {
      id: "inv_1",
      interviewId: "interview_1",
      email: "candidate@test.com",
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "inv_2",
      interviewId: "interview_1",
      email: "other@test.com",
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const fakePrisma = makeFakePrismaWithConfirmedQuestionnaire(interviews, invitations);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/invitations/inv_1/accept`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_1");
    assert.equal(body.interview.displayName, "Backend Engineer");
    assert.equal(interviews[0]?.candidateUserId, "candidate_1");
    assert.equal(invitations.find((item) => item.id === "inv_1")?.status, "ACCEPTED");
    assert.equal(invitations.find((item) => item.id === "inv_2")?.status, "CANCELLED");
  } finally {
    server.close();
  }
});

test("POST accept returns 409 when questionnaire not confirmed", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "interview_self",
        displayName: "Моя анкета",
        joinCode: "SELF01",
        candidateUserId: "candidate_1",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
      {
        id: "interview_1",
        displayName: "Backend Engineer",
        joinCode: "TEST01",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
    ],
    [
      {
        id: "inv_1",
        interviewId: "interview_1",
        email: "candidate@test.com",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    {
      candidateProfiles: [{ interviewId: "interview_self", confirmedAt: null }],
    },
  );
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/invitations/inv_1/accept`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Candidate questionnaire not confirmed");
  } finally {
    server.close();
  }
});

test("POST decline sets DECLINED", async () => {
  const invitations: FakeInvitation[] = [
    {
      id: "inv_1",
      interviewId: "interview_1",
      email: "candidate@test.com",
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "interview_1",
        displayName: "Backend Engineer",
        joinCode: "TEST01",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
    ],
    invitations,
  );
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/invitations/inv_1/decline`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.invitation.id, "inv_1");
    assert.equal(body.invitation.status, "DECLINED");
    assert.equal(invitations[0]?.status, "DECLINED");
  } finally {
    server.close();
  }
});

test("POST accept of another user invitation returns 404", async () => {
  const fakePrisma = makeFakePrismaWithConfirmedQuestionnaire(
    [
      {
        id: "interview_1",
        displayName: "Backend Engineer",
        joinCode: "TEST01",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
    ],
    [
      {
        id: "inv_1",
        interviewId: "interview_1",
        email: "other@test.com",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  );
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/invitations/inv_1/accept`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Invitation not found");
  } finally {
    server.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { createCandidateInterviewRouter } from "./candidate-interview";

process.env.JWT_SECRET = "test-secret-min-8-chars";

type FakeInterview = {
  id: string;
  displayName: string;
  joinCode: string;
  candidateUserId: string | null;
  status: string;
  createdAt: Date;
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

type FakeCandidateProfile = {
  interviewId: string;
  confirmedAt: Date | null;
};

function makeFakePrisma(
  interviews: FakeInterview[] = [],
  options?: {
    hrUserId?: string;
    vacancyId?: string;
    candidateProfiles?: FakeCandidateProfile[];
    invitations?: FakeInvitation[];
  },
) {
  const hrUserId = options?.hrUserId ?? "hr_1";
  const vacancyId = options?.vacancyId ?? "vacancy_1";
  const candidateProfiles = (options?.candidateProfiles ?? []).map((item) => ({ ...item }));
  const invitations = options?.invitations ?? [];

  return {
    user: {
      findFirst: async () => ({ id: hrUserId, role: "HR" }),
    },
    vacancy: {
      findFirst: async () => ({ id: vacancyId, hrUserId }),
    },
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        candidateProfiles.find((item) => item.interviewId === where.interviewId) ?? null,
    },
    invitation: {
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
    },
    interview: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        interviews.find((item) => matchesFindFirstWhere(item, where)) ?? null,
      findUnique: async ({
        where,
        include,
      }: {
        where: { joinCode?: string; id?: string };
        include?: {
          vacancy?: { include?: { companyProfile?: boolean } };
          candidateProfile?: boolean;
        };
      }) => {
        const interview =
          where.joinCode != null
            ? (interviews.find((item) => item.joinCode === where.joinCode) ?? null)
            : where.id != null
              ? (interviews.find((item) => item.id === where.id) ?? null)
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
      create: async ({
        data,
      }: {
        data: {
          hrUserId: string;
          vacancyId: string;
          displayName: string;
          candidateUserId: string;
          joinCode: string;
          status: string;
        };
      }) => {
        const interview: FakeInterview = {
          id: `interview_${interviews.length + 1}`,
          displayName: data.displayName,
          joinCode: data.joinCode,
          candidateUserId: data.candidateUserId,
          status: data.status,
          createdAt: new Date(),
          hrUserId: data.hrUserId,
          vacancyId: data.vacancyId,
        };
        interviews.push(interview);
        return interview;
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
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use("/api/candidate", createCandidateInterviewRouter(() => fakePrisma as never));
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
};

const confirmedQuestionnaireProfile: FakeCandidateProfile = {
  interviewId: "interview_questionnaire",
  confirmedAt: new Date(),
};

function makeFakePrismaWithConfirmedQuestionnaire(
  interviews: FakeInterview[] = [],
  invitations: FakeInvitation[] = [],
) {
  return makeFakePrisma([confirmedQuestionnaireInterview, ...interviews], {
    candidateProfiles: [confirmedQuestionnaireProfile],
    invitations,
  });
}

test("GET /candidate/interview returns null when candidate has no active interview", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "TEST01",
      candidateUserId: null,
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview, null);
  } finally {
    server.close();
  }
});

test("GET /candidate/interview returns linked interview for current candidate", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "TEST01",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_1");
    assert.equal(body.interview.displayName, "Frontend Dev");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join cancels PENDING invitation", async () => {
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
  const fakePrisma = makeFakePrismaWithConfirmedQuestionnaire(
    [
      {
        id: "interview_1",
        displayName: "Frontend Dev",
        joinCode: "TEST01",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
      },
    ],
    invitations,
  );
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 200);
    assert.equal(invitations[0]?.status, "CANCELLED");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join links candidate to interview by join code", async () => {
  const fakePrisma = makeFakePrismaWithConfirmedQuestionnaire([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "TEST01",
      candidateUserId: null,
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "test01" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_1");
    const linked = await fakePrisma.interview.findUnique({ where: { joinCode: "TEST01" } });
    assert.equal(linked?.candidateUserId, "candidate_1");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join returns 404 for invalid join code", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "NOPE99" }),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Invalid join code");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join returns 409 when interview is taken by another candidate", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "TEST01",
      candidateUserId: "other_candidate",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Interview already taken");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join returns 409 for ENDED interview", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "END001",
      candidateUserId: null,
      status: "ENDED",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "END001" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Interview is not joinable");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join returns 409 when candidate already has active interview", async () => {
  const fakePrisma = makeFakePrismaWithConfirmedQuestionnaire([
    {
      id: "interview_active",
      displayName: "Active",
      joinCode: "ACT001",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
    {
      id: "interview_new",
      displayName: "New",
      joinCode: "NEW001",
      candidateUserId: null,
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "NEW001" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Candidate already has active interview");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join is idempotent for same candidate", async () => {
  const fakePrisma = makeFakePrismaWithConfirmedQuestionnaire([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "TEST01",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_1");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/start creates questionnaire without join code", async () => {
  const interviews: FakeInterview[] = [];
  const fakePrisma = makeFakePrisma(interviews);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/start`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.interview.displayName, "Моя анкета");
    assert.equal(body.interview.status, "AWAITING_CANDIDATE");
    assert.equal(interviews.length, 1);
    assert.equal(interviews[0]?.candidateUserId, "candidate_1");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/start returns existing active interview", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_existing",
      displayName: "Моя анкета",
      joinCode: "ABC123",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/start`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_existing");
  } finally {
    server.close();
  }
});

test("GET /candidate/interview ignores self-service questionnaire", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_self",
      displayName: "Моя анкета",
      joinCode: "SELF01",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview, null);
  } finally {
    server.close();
  }
});

test("GET /candidate/questionnaire returns self-service interview", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_self",
      displayName: "Моя анкета",
      joinCode: "SELF01",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/questionnaire`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_self");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join succeeds when candidate has self-service questionnaire", async () => {
  const interviews: FakeInterview[] = [
    confirmedQuestionnaireInterview,
    {
      id: "interview_hr",
      displayName: "Test Position",
      joinCode: "TEST01",
      candidateUserId: null,
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ];
  const fakePrisma = makeFakePrisma(interviews, {
    candidateProfiles: [confirmedQuestionnaireProfile],
  });
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_hr");
    assert.equal(interviews.find((item) => item.id === "interview_hr")?.candidateUserId, "candidate_1");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join returns 409 when questionnaire is not confirmed", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "interview_self",
        displayName: "Моя анкета",
        joinCode: "SELF01",
        candidateUserId: "candidate_1",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
      },
      {
        id: "interview_hr",
        displayName: "Test Position",
        joinCode: "TEST01",
        candidateUserId: null,
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
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
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Candidate questionnaire not confirmed");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join returns 409 when questionnaire does not exist", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_hr",
      displayName: "Test Position",
      joinCode: "TEST01",
      candidateUserId: null,
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(candidateUser) },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Candidate questionnaire required");
  } finally {
    server.close();
  }
});

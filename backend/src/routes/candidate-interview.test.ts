import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createCandidateInterviewRouter } from "./candidate-interview";

type FakeInterview = {
  id: string;
  displayName: string;
  joinCode: string;
  candidateUserId: string | null;
  status: string;
  createdAt: Date;
};

function makeFakePrisma(interviews: FakeInterview[] = []) {
  return {
    interview: {
      findFirst: async ({
        where,
      }: {
        where: {
          candidateUserId: string;
          status: { in: string[] };
          NOT?: { id: string };
        };
      }) =>
        interviews.find(
          (item) =>
            item.candidateUserId === where.candidateUserId &&
            where.status.in.includes(item.status) &&
            item.id !== where.NOT?.id,
        ) ?? null,
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
          candidateProfile: include.candidateProfile ? null : undefined,
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
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createCandidateInterviewRouter(() => fakePrisma as never));
  return app;
}

const candidateUser: AuthUser = {
  id: "candidate_1",
  email: "candidate@test.com",
  role: "CANDIDATE",
};

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
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview`);
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
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_1");
    assert.equal(body.interview.displayName, "Frontend Dev");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join links candidate to interview by join code", async () => {
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
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
  const fakePrisma = makeFakePrisma([
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
      headers: { "Content-Type": "application/json" },
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
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_1");
  } finally {
    server.close();
  }
});

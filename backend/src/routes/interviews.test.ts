import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createInterviewsRouter } from "./interviews";

type FakeVacancy = { id: string; hrUserId: string; title: string; status: string };
type FakeInterview = {
  id: string;
  hrUserId: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: Date;
};
type CreateInput = {
  data: {
    hrUserId: string;
    vacancyId: string;
    displayName: string;
    joinCode: string;
    status: string;
  };
};
type CreateImpl = (input: CreateInput) => Promise<FakeInterview> | FakeInterview;

function makeFakePrisma(
  interviews: FakeInterview[] = [],
  vacancies: FakeVacancy[] = [],
  createImpl?: CreateImpl
) {
  let counter = 0;
  return {
    interview: {
      findMany: async ({
        where,
        include,
      }: {
        where: { hrUserId: string };
        include?: { vacancy: { select: { title: true } } };
      }) => {
        const filtered = interviews
          .filter((item) => item.hrUserId === where.hrUserId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        if (include?.vacancy) {
          return filtered.map((item) => {
            const vacancy = vacancies.find((v) => v.id === item.vacancyId);
            return {
              ...item,
              vacancy: { title: vacancy?.title ?? "" },
            };
          });
        }
        return filtered;
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { vacancy: { select: { title: true } } };
      }) => {
        const interview = interviews.find((item) => item.id === where.id) ?? null;
        if (!interview) return null;

        if (include?.vacancy) {
          const vacancy = vacancies.find((v) => v.id === interview.vacancyId);
          return {
            ...interview,
            vacancy: { title: vacancy?.title ?? "" },
          };
        }
        return interview;
      },
      create: async (input: CreateInput) => {
        if (createImpl) return createImpl(input);
        counter += 1;
        const created: FakeInterview = {
          id: `generated_${counter}`,
          hrUserId: input.data.hrUserId,
          vacancyId: input.data.vacancyId,
          displayName: input.data.displayName,
          joinCode: input.data.joinCode,
          status: input.data.status,
          createdAt: new Date(),
        };
        interviews.push(created);
        return created;
      },
    },
    vacancy: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        vacancies.find((v) => v.id === where.id) ?? null,
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
  app.use("/api", createInterviewsRouter(() => fakePrisma as never));
  return app;
}

const confirmedVacancy: FakeVacancy = {
  id: "v1",
  hrUserId: "hr_1",
  title: "Frontend Dev",
  status: "CONFIRMED",
};

function postInterview(port: number, vacancyId?: string) {
  return fetch(`http://127.0.0.1:${port}/api/interviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vacancyId }),
  });
}

test("GET /interviews/mine returns interviews for the current HR only, newest first", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(1),
      },
      {
        id: "i2",
        hrUserId: "hr_other",
        vacancyId: "v2",
        displayName: "Other",
        joinCode: "BBBBBB",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(2),
      },
      {
        id: "i3",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "CCCCCC",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(3),
      },
    ],
    [confirmedVacancy]
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 2);
    assert.equal(body.interviews[0].id, "i3");
    assert.equal(body.interviews[1].id, "i1");
    assert.deepEqual(Object.keys(body.interviews[0]).sort(), [
      "createdAt",
      "displayName",
      "id",
      "joinCode",
      "reportSummary",
      "status",
      "vacancyId",
      "vacancyTitle",
    ]);
    assert.equal(body.interviews[0].vacancyId, "v1");
    assert.equal(body.interviews[0].vacancyTitle, "Frontend Dev");
    assert.equal(body.interviews[0].displayName, "Frontend Dev");
    assert.equal(body.interviews[0].reportSummary, null);
    assert.equal(body.interviews[0].createdAt, new Date(3).toISOString());
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/mine returns empty array when HR has no interviews", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.interviews, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews requires vacancyId and CONFIRMED vacancy", async () => {
  const fakePrisma = makeFakePrisma([], [
    { id: "v1", hrUserId: "hr_1", title: "Dev", status: "DRAFT" },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1");
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Vacancy is not confirmed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews creates AWAITING_CANDIDATE with displayName from vacancy title", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1");
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.interview.status, "AWAITING_CANDIDATE");
    assert.equal(body.interview.displayName, "Frontend Dev");
    assert.equal(body.interview.vacancyId, "v1");
    assert.equal(typeof body.interview.id, "string");
    assert.match(body.interview.joinCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews returns a different join code on each call", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const first = await (await postInterview(port, "v1")).json();
    const second = await (await postInterview(port, "v1")).json();
    assert.notEqual(first.interview.joinCode, second.interview.joinCode);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews retries once when the generated join code collides, then succeeds", async () => {
  let attempts = 0;
  const createImpl: CreateImpl = async (input) => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("Unique constraint failed") as Error & { code: string };
      error.code = "P2002";
      throw error;
    }
    return {
      id: "generated_after_retry",
      hrUserId: input.data.hrUserId,
      vacancyId: input.data.vacancyId,
      displayName: input.data.displayName,
      joinCode: input.data.joinCode,
      status: input.data.status,
      createdAt: new Date(),
    };
  };
  const fakePrisma = makeFakePrisma([], [confirmedVacancy], createImpl);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1");
    assert.equal(response.status, 201);
    assert.equal(attempts, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews returns 500 after exhausting retries on repeated collisions", async () => {
  const createImpl: CreateImpl = async () => {
    const error = new Error("Unique constraint failed") as Error & { code: string };
    error.code = "P2002";
    throw error;
  };
  const fakePrisma = makeFakePrisma([], [confirmedVacancy], createImpl);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1");
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Failed to generate unique join code");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("interview created via POST /interviews appears in GET /interviews/mine", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    await postInterview(port, "v1");
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    const body = await response.json();
    assert.equal(body.interviews.length, 1);
    assert.equal(body.interviews[0].status, "AWAITING_CANDIDATE");
    assert.equal(body.interviews[0].displayName, "Frontend Dev");
    assert.equal(body.interviews[0].vacancyTitle, "Frontend Dev");
    assert.equal(body.interviews[0].reportSummary, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/:id returns interview for owner", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(1),
      },
    ],
    [confirmedVacancy]
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/i1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "i1");
    assert.equal(body.interview.displayName, "Frontend Dev");
    assert.equal(body.interview.joinCode, "AAAAAA");
    assert.equal(body.interview.status, "AWAITING_CANDIDATE");
    assert.equal(body.interview.vacancyTitle, "Frontend Dev");
    assert.equal(body.interview.reportSummary, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/:id returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/missing`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Interview not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/:id returns 403 when interview belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_other",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(1),
      },
    ],
    [confirmedVacancy]
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/i1`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

function deleteInterview(port: number, interviewId: string) {
  return fetch(`http://127.0.0.1:${port}/api/interviews/${interviewId}`, {
    method: "DELETE",
  });
}

test("DELETE /interviews/:id returns 404 when not found", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await deleteInterview(port, "missing");
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Interview not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /interviews/:id returns 403 for another HR", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "int_1",
        hrUserId: "hr_other",
        vacancyId: "v1",
        displayName: "Backend",
        joinCode: "ABC123",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
      },
    ],
    [confirmedVacancy]
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await deleteInterview(port, "int_1");
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /interviews/:id cascades and returns 204", async () => {
  const deleted: string[] = [];
  const cascadeCalls: string[] = [];
  const interviews = [
    {
      id: "int_1",
      hrUserId: "hr_1",
      vacancyId: "v1",
      displayName: "Backend",
      joinCode: "ABC123",
      status: "ENDED",
      createdAt: new Date(),
    },
  ];
  const fakePrisma = makeFakePrisma(interviews, [confirmedVacancy]) as ReturnType<typeof makeFakePrisma> & {
    $transaction: (fn: (tx: typeof fakePrisma) => Promise<unknown>) => Promise<unknown>;
    liveSession: {
      findUnique: (args: { where: { interviewId: string } }) => Promise<{ id: string } | null>;
      delete: (args: { where: { id: string } }) => Promise<{ id: string }>;
    };
    liveMessage: {
      deleteMany: (args: { where: { sessionId: string } }) => Promise<{ count: number }>;
    };
    prepSessionCandidate: {
      findUnique: (args: { where: { interviewId: string } }) => Promise<{ id: string } | null>;
      delete: (args: { where: { id: string } }) => Promise<{ id: string }>;
    };
    prepMessageCandidate: {
      deleteMany: (args: { where: { sessionId: string } }) => Promise<{ count: number }>;
    };
    candidateProfile: {
      deleteMany: (args: { where: { interviewId: string } }) => Promise<{ count: number }>;
    };
    finalReport: {
      deleteMany: (args: { where: { interviewId: string } }) => Promise<{ count: number }>;
    };
  };

  fakePrisma.interview.delete = async ({ where }: { where: { id: string } }) => {
    deleted.push(where.id);
    const index = interviews.findIndex((item) => item.id === where.id);
    if (index >= 0) interviews.splice(index, 1);
    return {
      id: where.id,
      hrUserId: "hr_1",
      vacancyId: "v1",
      displayName: "Backend",
      joinCode: "ABC123",
      status: "ENDED",
      createdAt: new Date(),
    };
  };
  fakePrisma.$transaction = async (fn) => fn(fakePrisma);
  fakePrisma.liveSession = {
    findUnique: async () => ({ id: "ls_1" }),
    delete: async ({ where }) => {
      cascadeCalls.push(`liveSession:${where.id}`);
      return { id: where.id };
    },
  };
  fakePrisma.liveMessage = {
    deleteMany: async ({ where }) => {
      cascadeCalls.push(`liveMessage:${where.sessionId}`);
      return { count: 1 };
    },
  };
  fakePrisma.prepSessionCandidate = {
    findUnique: async () => ({ id: "ps_1" }),
    delete: async ({ where }) => {
      cascadeCalls.push(`prepSessionCandidate:${where.id}`);
      return { id: where.id };
    },
  };
  fakePrisma.prepMessageCandidate = {
    deleteMany: async ({ where }) => {
      cascadeCalls.push(`prepMessageCandidate:${where.sessionId}`);
      return { count: 1 };
    },
  };
  fakePrisma.candidateProfile = {
    deleteMany: async ({ where }) => {
      cascadeCalls.push(`candidateProfile:${where.interviewId}`);
      return { count: 1 };
    },
  };
  fakePrisma.finalReport = {
    deleteMany: async ({ where }) => {
      cascadeCalls.push(`finalReport:${where.interviewId}`);
      return { count: 1 };
    },
  };

  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await deleteInterview(port, "int_1");
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.deepEqual(deleted, ["int_1"]);
    assert.deepEqual(cascadeCalls, [
      "liveMessage:ls_1",
      "liveSession:ls_1",
      "prepMessageCandidate:ps_1",
      "prepSessionCandidate:ps_1",
      "candidateProfile:int_1",
      "finalReport:int_1",
    ]);
    assert.equal(interviews.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

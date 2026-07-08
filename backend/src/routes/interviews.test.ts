import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createInterviewsRouter } from "./interviews";

type FakeInterview = { id: string; hrUserId: string; joinCode: string; status: string; createdAt: Date };
type CreateInput = { data: { hrUserId: string; joinCode: string; status: string } };
type CreateImpl = (input: CreateInput) => Promise<FakeInterview> | FakeInterview;

function makeFakePrisma(interviews: FakeInterview[] = [], createImpl?: CreateImpl) {
  let counter = 0;
  return {
    interview: {
      findMany: async ({ where }: { where: { hrUserId: string } }) =>
        interviews
          .filter((item) => item.hrUserId === where.hrUserId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      create: async (input: CreateInput) => {
        if (createImpl) return createImpl(input);
        counter += 1;
        const created: FakeInterview = {
          id: `generated_${counter}`,
          hrUserId: input.data.hrUserId,
          joinCode: input.data.joinCode,
          status: input.data.status,
          createdAt: new Date(),
        };
        interviews.push(created);
        return created;
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
  app.use(withUser(user));
  app.use("/api", createInterviewsRouter(() => fakePrisma as never));
  return app;
}

test("GET /interviews/mine returns interviews for the current HR only, newest first", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "i1", hrUserId: "hr_1", joinCode: "AAAAAA", status: "DRAFT", createdAt: new Date(1) },
    { id: "i2", hrUserId: "hr_other", joinCode: "BBBBBB", status: "DRAFT", createdAt: new Date(2) },
    { id: "i3", hrUserId: "hr_1", joinCode: "CCCCCC", status: "DRAFT", createdAt: new Date(3) },
  ]);
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
    assert.deepEqual(Object.keys(body.interviews[0]).sort(), ["createdAt", "id", "joinCode", "status"]);
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

test("POST /interviews creates a DRAFT interview with a 6-character join code", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.interview.status, "DRAFT");
    assert.equal(typeof body.interview.id, "string");
    assert.match(body.interview.joinCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews returns a different join code on each call", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const first = await (await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" })).json();
    const second = await (await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" })).json();
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
      joinCode: input.data.joinCode,
      status: input.data.status,
      createdAt: new Date(),
    };
  };
  const fakePrisma = makeFakePrisma([], createImpl);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
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
  const fakePrisma = makeFakePrisma([], createImpl);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Failed to generate unique join code");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("interview created via POST /interviews appears in GET /interviews/mine", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    const body = await response.json();
    assert.equal(body.interviews.length, 1);
    assert.equal(body.interviews[0].status, "DRAFT");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

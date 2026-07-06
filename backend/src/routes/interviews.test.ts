import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createInterviewsRouter } from "./interviews";

type FakeInterview = { id: string; hrUserId: string; joinCode: string; status: string; createdAt: Date };

function makeFakePrisma(interviews: FakeInterview[] = []) {
  return {
    interview: {
      findMany: async ({ where }: { where: { hrUserId: string } }) =>
        interviews
          .filter((item) => item.hrUserId === where.hrUserId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

test("GET /interviews/mine returns interviews for the current HR only, newest first", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "i1", hrUserId: "hr_1", joinCode: "AAAAAA", status: "DRAFT", createdAt: new Date(1) },
    { id: "i2", hrUserId: "hr_other", joinCode: "BBBBBB", status: "DRAFT", createdAt: new Date(2) },
    { id: "i3", hrUserId: "hr_1", joinCode: "CCCCCC", status: "DRAFT", createdAt: new Date(3) },
  ]);

  const app = express();
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createInterviewsRouter(() => fakePrisma as never));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 2);
    assert.equal(body.interviews[0].id, "i3");
    assert.equal(body.interviews[1].id, "i1");
    assert.deepEqual(Object.keys(body.interviews[0]).sort(), ["id", "joinCode", "status"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/mine returns empty array when HR has no interviews", async () => {
  const fakePrisma = makeFakePrisma([]);

  const app = express();
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createInterviewsRouter(() => fakePrisma as never));

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

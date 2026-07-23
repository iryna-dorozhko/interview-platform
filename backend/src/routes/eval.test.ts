import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createEvalRouter } from "./eval";

function buildApp(prisma: {
  interviewEvalSnapshot: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
}) {
  const app = express();
  app.use("/api", createEvalRouter(() => prisma as never));
  return app;
}

async function listen(
  app: express.Express,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test("eval API returns 503 when EVAL_API_TOKEN unset", async () => {
  const prev = process.env.EVAL_API_TOKEN;
  delete process.env.EVAL_API_TOKEN;
  const app = buildApp({
    interviewEvalSnapshot: { findMany: async () => [] },
  });
  const { base, close } = await listen(app);
  try {
    const res = await fetch(`${base}/api/eval/summary?from=2026-07-01&to=2026-07-02`);
    assert.equal(res.status, 503);
  } finally {
    await close();
    if (prev !== undefined) process.env.EVAL_API_TOKEN = prev;
  }
});

test("eval API returns 401 with wrong token", async () => {
  process.env.EVAL_API_TOKEN = "secret";
  const app = buildApp({
    interviewEvalSnapshot: { findMany: async () => [] },
  });
  const { base, close } = await listen(app);
  try {
    const res = await fetch(`${base}/api/eval/summary?from=2026-07-01&to=2026-07-02`, {
      headers: { Authorization: "Bearer wrong" },
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
    delete process.env.EVAL_API_TOKEN;
  }
});

test("eval API returns summary with valid token", async () => {
  process.env.EVAL_API_TOKEN = "secret";
  const app = buildApp({
    interviewEvalSnapshot: {
      findMany: async () => [
        {
          interviewId: "i1",
          prepCandidateDurationMs: 1000,
          prepVacancyDurationMs: null,
          liveDurationMs: 2000,
          autoRetryCount: 1,
          manualRetryCount: 0,
          hrMessageCount: 2,
          hrControlActionCount: 1,
          clarifyingQuestionCount: 0,
          agentMessageCount: 3,
          finalMatchScore: 70,
          arbiterRecommendation: "HIRE",
          hrDecisionType: "ACCEPT",
          hrAgreedWithArbiter: true,
          reportCreatedAt: new Date("2026-07-01T12:00:00.000Z"),
          decisionUpdatedAt: new Date("2026-07-01T13:00:00.000Z"),
        },
      ],
    },
  });
  const { base, close } = await listen(app);
  try {
    const res = await fetch(`${base}/api/eval/summary?from=2026-07-01&to=2026-07-02`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { summary: { snapshotCount: number } };
    assert.equal(body.summary.snapshotCount, 1);
  } finally {
    await close();
    delete process.env.EVAL_API_TOKEN;
  }
});

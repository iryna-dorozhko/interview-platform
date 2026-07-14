import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createReportsRouter } from "./reports";

type FakeReport = {
  id: string;
  interviewId: string;
  hrUserId: string;
  reportMarkdown: string;
  recommendation: string;
  matchScore: number;
  strengths: string[];
  risks: string[];
  createdAt: Date;
};

function makeFakePrisma(reports: FakeReport[] = []) {
  return {
    finalReport: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { interview: { select: { hrUserId: true } } };
      }) => {
        const report = reports.find((r) => r.id === where.id) ?? null;
        if (!report) return null;
        return {
          id: report.id,
          interviewId: report.interviewId,
          reportMarkdown: report.reportMarkdown,
          recommendation: report.recommendation,
          matchScore: report.matchScore,
          strengths: report.strengths,
          risks: report.risks,
          createdAt: report.createdAt,
          ...(include?.interview
            ? { interview: { hrUserId: report.hrUserId } }
            : {}),
        };
      },
    },
  };
}

function withUser(user: AuthUser | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user?: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createReportsRouter(() => fakePrisma as never));
  return app;
}

const sampleReport: FakeReport = {
  id: "rep_1",
  interviewId: "i1",
  hrUserId: "hr_1",
  reportMarkdown: "## Підсумок\n\nКандидат підходить.",
  recommendation: "HIRE",
  matchScore: 82,
  strengths: ["Досвід Node.js"],
  risks: ["Мало leadership"],
  createdAt: new Date("2026-07-14T09:00:00.000Z"),
};

test("GET /reports/:id returns 404 when report does not exist", async () => {
  const app = makeApp(makeFakePrisma(), { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/missing`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Report not found");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports/:id returns 403 when report belongs to another HR", async () => {
  const app = makeApp(makeFakePrisma([{ ...sampleReport, hrUserId: "hr_other" }]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports/:id returns full report for owner HR", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.report.id, "rep_1");
    assert.equal(body.report.interviewId, "i1");
    assert.equal(body.report.recommendation, "HIRE");
    assert.equal(body.report.matchScore, 82);
    assert.deepEqual(body.report.strengths, ["Досвід Node.js"]);
    assert.deepEqual(body.report.risks, ["Мало leadership"]);
    assert.equal(body.report.reportMarkdown, "## Підсумок\n\nКандидат підходить.");
    assert.equal(body.report.createdAt, sampleReport.createdAt.toISOString());
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

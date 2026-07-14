import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createReportsRouter } from "./reports";

type FakeReport = {
  id: string;
  interviewId: string;
  hrUserId: string;
  candidateEmail: string | null;
  vacancyId: string;
  vacancyTitle: string;
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
      findMany: async ({
        where,
        include,
        orderBy,
      }: {
        where?: {
          interview?: {
            hrUserId?: string;
            vacancyId?: string;
            candidateUser?: { email?: { contains: string; mode: string } };
          };
          recommendation?: string;
          createdAt?: { gte?: Date; lte?: Date };
        };
        include?: {
          interview: {
            select: {
              vacancyId: true;
              candidateUser: { select: { email: true } };
              vacancy: { select: { id: true; title: true } };
            };
          };
        };
        orderBy?: { createdAt: "desc" | "asc" };
      }) => {
        let filtered = [...reports];
        if (where?.interview?.hrUserId) {
          filtered = filtered.filter((r) => r.hrUserId === where.interview!.hrUserId);
        }
        if (where?.interview?.vacancyId) {
          filtered = filtered.filter((r) => r.vacancyId === where.interview!.vacancyId);
        }
        if (where?.recommendation) {
          filtered = filtered.filter((r) => r.recommendation === where.recommendation);
        }
        if (where?.interview?.candidateUser?.email?.contains) {
          const needle = where.interview.candidateUser.email.contains.toLowerCase();
          filtered = filtered.filter(
            (r) => r.candidateEmail?.toLowerCase().includes(needle) ?? false,
          );
        }
        if (where?.createdAt?.gte) {
          filtered = filtered.filter((r) => r.createdAt >= where.createdAt!.gte!);
        }
        if (where?.createdAt?.lte) {
          filtered = filtered.filter((r) => r.createdAt <= where.createdAt!.lte!);
        }
        if (orderBy?.createdAt === "desc") {
          filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return filtered.map((report) => ({
          id: report.id,
          interviewId: report.interviewId,
          recommendation: report.recommendation,
          matchScore: report.matchScore,
          createdAt: report.createdAt,
          ...(include?.interview
            ? {
                interview: {
                  vacancyId: report.vacancyId,
                  candidateUser: report.candidateEmail
                    ? { email: report.candidateEmail }
                    : null,
                  vacancy: { id: report.vacancyId, title: report.vacancyTitle },
                },
              }
            : {}),
        }));
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
  candidateEmail: "anna@co.ua",
  vacancyId: "vac_1",
  vacancyTitle: "Senior Node",
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

test("GET /reports returns empty array when HR has no reports", async () => {
  const app = makeApp(makeFakePrisma(), { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.reports, []);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports returns only current HR reports with summary fields", async () => {
  const other: FakeReport = {
    ...sampleReport,
    id: "rep_other",
    interviewId: "i2",
    hrUserId: "hr_other",
    candidateEmail: "other@co.ua",
  };
  const app = makeApp(makeFakePrisma([sampleReport, other]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_1");
    assert.equal(body.reports[0].candidateEmail, "anna@co.ua");
    assert.equal(body.reports[0].vacancyId, "vac_1");
    assert.equal(body.reports[0].vacancyTitle, "Senior Node");
    assert.equal(body.reports[0].matchScore, 82);
    assert.equal(body.reports[0].recommendation, "HIRE");
    assert.equal(body.reports[0].interviewId, "i1");
    assert.equal(body.reports[0].createdAt, sampleReport.createdAt.toISOString());
    assert.equal(body.reports[0].reportMarkdown, undefined);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

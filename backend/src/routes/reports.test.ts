import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createReportsRouter } from "./reports";

type FakeReport = {
  id: string;
  interviewId: string;
  hrUserId: string;
  candidateUserId: string | null;
  candidateEmail: string | null;
  vacancyId: string;
  vacancyTitle: string;
  reportMarkdown: string;
  recommendation: string;
  matchScore: number;
  strengths: string[];
  risks: string[];
  overrideKind: string | null;
  overrideReason: string | null;
  createdAt: Date;
  companyProfile?: Record<string, unknown> | null;
  candidateProfile?: Record<string, unknown> | null;
};

type FakeDecision = {
  id: string;
  interviewId: string;
  finalReportId: string;
  decidedByUserId: string;
  type: string;
  letterBody: string;
  dialogMessageId: string | null;
  createdAt: Date;
};

type FakeDialog = {
  id: string;
  hrUserId: string;
  candidateUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

type FakeDialogMessage = {
  id: string;
  dialogId: string;
  senderUserId: string;
  body: string;
  kind: string;
  decisionId: string | null;
  createdAt: Date;
};

type FakePrismaSeed = {
  reports?: FakeReport[];
  decisions?: FakeDecision[];
  dialogs?: FakeDialog[];
  messages?: FakeDialogMessage[];
};

function makeFakePrisma(seed: FakeReport[] | FakePrismaSeed = []) {
  const reports = Array.isArray(seed) ? [...seed] : [...(seed.reports ?? [])];
  const decisions = Array.isArray(seed) ? [] : [...(seed.decisions ?? [])];
  const dialogs = Array.isArray(seed) ? [] : [...(seed.dialogs ?? [])];
  const messages = Array.isArray(seed) ? [] : [...(seed.messages ?? [])];
  let decisionSeq = decisions.length;
  let dialogSeq = dialogs.length;
  let messageSeq = messages.length;

  const prisma = {
    finalReport: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: {
          interview?: {
            select?: Record<string, unknown>;
          };
        };
      }) => {
        const report = reports.find((r) => r.id === where.id) ?? null;
        if (!report) return null;

        const interviewSelect = include?.interview?.select;
        let interview: Record<string, unknown> | undefined;
        if (include?.interview) {
          interview = { hrUserId: report.hrUserId };
          if (interviewSelect) {
            if ("candidateUserId" in interviewSelect) {
              interview.candidateUserId = report.candidateUserId;
            }
            if ("vacancy" in interviewSelect) {
              interview.vacancy = {
                title: report.vacancyTitle,
                companyProfile: report.companyProfile ?? null,
              };
            }
            if ("candidateProfile" in interviewSelect) {
              interview.candidateProfile = report.candidateProfile ?? null;
            }
          }
        }

        return {
          id: report.id,
          interviewId: report.interviewId,
          reportMarkdown: report.reportMarkdown,
          recommendation: report.recommendation,
          matchScore: report.matchScore,
          strengths: report.strengths,
          risks: report.risks,
          overrideKind: report.overrideKind,
          overrideReason: report.overrideReason,
          createdAt: report.createdAt,
          ...(interview ? { interview } : {}),
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
    interviewDecision: {
      findFirst: async ({
        where,
        orderBy,
        select,
      }: {
        where: { interviewId: string };
        orderBy?: { createdAt: "desc" | "asc" };
        select?: { id: true; type: true; createdAt: true };
      }) => {
        let matched = decisions.filter((d) => d.interviewId === where.interviewId);
        if (orderBy?.createdAt === "desc") {
          matched = [...matched].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        }
        const latest = matched[0] ?? null;
        if (!latest) return null;
        if (select) {
          return { id: latest.id, type: latest.type, createdAt: latest.createdAt };
        }
        return latest;
      },
      create: async ({
        data,
      }: {
        data: {
          interviewId: string;
          finalReportId: string;
          decidedByUserId: string;
          type: string;
          letterBody: string;
        };
      }) => {
        decisionSeq += 1;
        const created: FakeDecision = {
          id: `dec_${decisionSeq}`,
          interviewId: data.interviewId,
          finalReportId: data.finalReportId,
          decidedByUserId: data.decidedByUserId,
          type: data.type,
          letterBody: data.letterBody,
          dialogMessageId: null,
          createdAt: new Date(`2026-07-15T0${decisionSeq}:00:00.000Z`),
        };
        decisions.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { dialogMessageId?: string };
      }) => {
        const decision = decisions.find((d) => d.id === where.id);
        if (!decision) throw new Error("Decision not found");
        if (data.dialogMessageId !== undefined) {
          decision.dialogMessageId = data.dialogMessageId;
        }
        return decision;
      },
    },
    dialog: {
      findUnique: async ({
        where,
      }: {
        where: {
          hrUserId_candidateUserId: { hrUserId: string; candidateUserId: string };
        };
      }) => {
        const key = where.hrUserId_candidateUserId;
        return (
          dialogs.find(
            (d) =>
              d.hrUserId === key.hrUserId && d.candidateUserId === key.candidateUserId,
          ) ?? null
        );
      },
      create: async ({
        data,
      }: {
        data: { hrUserId: string; candidateUserId: string };
      }) => {
        dialogSeq += 1;
        const now = new Date();
        const created: FakeDialog = {
          id: `dlg_${dialogSeq}`,
          hrUserId: data.hrUserId,
          candidateUserId: data.candidateUserId,
          createdAt: now,
          updatedAt: now,
        };
        dialogs.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { updatedAt?: Date };
      }) => {
        const dialog = dialogs.find((d) => d.id === where.id);
        if (!dialog) throw new Error("Dialog not found");
        if (data.updatedAt) dialog.updatedAt = data.updatedAt;
        return dialog;
      },
    },
    dialogMessage: {
      create: async ({
        data,
      }: {
        data: {
          dialogId: string;
          senderUserId: string;
          body: string;
          kind: string;
          decisionId?: string | null;
        };
      }) => {
        messageSeq += 1;
        const created: FakeDialogMessage = {
          id: `msg_${messageSeq}`,
          dialogId: data.dialogId,
          senderUserId: data.senderUserId,
          body: data.body,
          kind: data.kind,
          decisionId: data.decisionId ?? null,
          createdAt: new Date(),
        };
        messages.push(created);
        return created;
      },
    },
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> =>
      fn(prisma),
    __decisions: decisions,
    __dialogs: dialogs,
    __messages: messages,
  };

  return prisma;
}

function withUser(user: AuthUser | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

const defaultFakeLlm = {
  complete: async () => "Шановний кандидате, …",
};

function makeApp(
  fakePrisma: ReturnType<typeof makeFakePrisma>,
  user?: AuthUser,
  fakeLlm: { complete: (...args: unknown[]) => Promise<string> } = defaultFakeLlm,
) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use(
    "/api",
    createReportsRouter(() => fakePrisma as never, () => fakeLlm as never),
  );
  return app;
}

const sampleReport: FakeReport = {
  id: "rep_1",
  interviewId: "i1",
  hrUserId: "hr_1",
  candidateUserId: "cand_1",
  candidateEmail: "anna@co.ua",
  vacancyId: "vac_1",
  vacancyTitle: "Senior Node",
  reportMarkdown: "## Підсумок\n\nКандидат підходить.",
  recommendation: "HIRE",
  matchScore: 82,
  strengths: ["Досвід Node.js"],
  risks: ["Мало leadership"],
  overrideKind: null,
  overrideReason: null,
  createdAt: new Date("2026-07-14T09:00:00.000Z"),
  companyProfile: { role: "Backend" },
  candidateProfile: { fullName: "Anna" },
};

const hrUser: AuthUser = { id: "hr_1", email: "hr@test.com", role: "HR" };

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
    assert.equal(body.report.overrideKind, null);
    assert.equal(body.report.overrideReason, null);
    assert.equal(body.report.reportMarkdown, "## Підсумок\n\nКандидат підходить.");
    assert.equal(body.report.createdAt, sampleReport.createdAt.toISOString());
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports/:id returns override fields when present", async () => {
  const withOverride = {
    ...sampleReport,
    overrideKind: "soft_skills",
    overrideReason: "Сильний red flag по комунікації під час live.",
  };
  const app = makeApp(makeFakePrisma([withOverride]), {
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
    assert.equal(body.report.overrideKind, "soft_skills");
    assert.equal(body.report.overrideReason, withOverride.overrideReason);
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

const maybeReport: FakeReport = {
  ...sampleReport,
  id: "rep_2",
  interviewId: "i2",
  candidateUserId: "cand_2",
  candidateEmail: "ivan@co.ua",
  vacancyId: "vac_2",
  vacancyTitle: "Frontend",
  recommendation: "MAYBE",
  matchScore: 61,
  createdAt: new Date("2026-07-12T12:00:00.000Z"),
};

test("GET /reports filters by recommendation", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?recommendation=MAYBE`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_2");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports returns 400 for invalid recommendation", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?recommendation=YES`,
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid recommendation");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports filters by vacancyId", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?vacancyId=vac_1`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_1");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports filters by email contains (case-insensitive)", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports?email=ANNA`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].candidateEmail, "anna@co.ua");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports filters by dateFrom and dateTo (UTC day bounds)", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?dateFrom=2026-07-14&dateTo=2026-07-14`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_1");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports returns 400 for invalid dateFrom", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?dateFrom=14-07-2026`,
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid dateFrom");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports/:id returns latestDecision null when none exist", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.report.latestDecision, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports/:id returns latest decision when two exist", async () => {
  const older: FakeDecision = {
    id: "dec_old",
    interviewId: "i1",
    finalReportId: "rep_1",
    decidedByUserId: "hr_1",
    type: "REJECT",
    letterBody: "Ні",
    dialogMessageId: null,
    createdAt: new Date("2026-07-15T10:00:00.000Z"),
  };
  const newer: FakeDecision = {
    id: "dec_new",
    interviewId: "i1",
    finalReportId: "rep_1",
    decidedByUserId: "hr_1",
    type: "ACCEPT",
    letterBody: "Так",
    dialogMessageId: null,
    createdAt: new Date("2026-07-16T10:00:00.000Z"),
  };
  const app = makeApp(
    makeFakePrisma({ reports: [sampleReport], decisions: [older, newer] }),
    hrUser,
  );
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.report.latestDecision.id, "dec_new");
    assert.equal(body.report.latestDecision.type, "ACCEPT");
    assert.equal(
      body.report.latestDecision.createdAt,
      newer.createdAt.toISOString(),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /reports/:id/decisions/draft returns generated letter body", async () => {
  const fakeLlm = {
    complete: async () => "Шановний кандидате, …",
  };
  const app = makeApp(makeFakePrisma([sampleReport]), hrUser, fakeLlm);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports/rep_1/decisions/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ACCEPT" }),
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.type, "ACCEPT");
    assert.equal(body.body, "Шановний кандидате, …");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /reports/:id/decisions/draft returns 400 without candidateUserId", async () => {
  const app = makeApp(
    makeFakePrisma([{ ...sampleReport, candidateUserId: null }]),
    hrUser,
  );
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports/rep_1/decisions/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ACCEPT" }),
      },
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Candidate user required");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /reports/:id/decisions/draft returns 403 for wrong HR", async () => {
  const app = makeApp(makeFakePrisma([{ ...sampleReport, hrUserId: "hr_other" }]), hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports/rep_1/decisions/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "REJECT" }),
      },
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /reports/:id/decisions creates decision, dialog, and letter message; second reuses dialog", async () => {
  const fakePrisma = makeFakePrisma([sampleReport]);
  const app = makeApp(fakePrisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ACCEPT", letterBody: "Вітаємо!" }),
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.equal(firstBody.decision.type, "ACCEPT");
    assert.ok(firstBody.decision.id);
    assert.ok(firstBody.decision.createdAt);
    assert.ok(firstBody.dialogId);
    assert.equal(fakePrisma.__decisions.length, 1);
    assert.equal(fakePrisma.__dialogs.length, 1);
    assert.equal(fakePrisma.__messages.length, 1);
    assert.equal(fakePrisma.__messages[0].kind, "DECISION_LETTER");
    assert.equal(fakePrisma.__messages[0].body, "Вітаємо!");
    assert.equal(fakePrisma.__decisions[0].dialogMessageId, fakePrisma.__messages[0].id);

    const second = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "ADDITIONAL_MEETING",
        letterBody: "Потрібна ще одна зустріч.",
      }),
    });
    assert.equal(second.status, 201);
    const secondBody = await second.json();
    assert.equal(secondBody.dialogId, firstBody.dialogId);
    assert.equal(secondBody.decision.type, "ADDITIONAL_MEETING");
    assert.equal(fakePrisma.__dialogs.length, 1);
    assert.equal(fakePrisma.__messages.length, 2);
    assert.equal(fakePrisma.__decisions.length, 2);
    assert.equal(fakePrisma.__messages[1].kind, "DECISION_LETTER");
    assert.equal(fakePrisma.__messages[1].body, "Потрібна ще одна зустріч.");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /reports/:id/decisions returns 400 for empty letterBody", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ACCEPT", letterBody: "   " }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /reports/:id/decisions/draft returns 502 when LLM throws", async () => {
  const fakeLlm = {
    complete: async () => {
      throw new Error("LLM down");
    },
  };
  const app = makeApp(makeFakePrisma([sampleReport]), hrUser, fakeLlm);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports/rep_1/decisions/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ACCEPT" }),
      },
    );
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, "Failed to generate letter");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

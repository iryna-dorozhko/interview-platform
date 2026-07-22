import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Server } from "socket.io";
import type { AuthUser } from "../auth/middleware";
import type { LlmProvider } from "../llm/types";
import { computeMatchScore } from "../services/match-score";
import { createInterviewsRouter } from "./interviews";

type EmittedEvent = { room: string; event: string; payload: unknown };

function makeMockIo(): { io: Server; emitted: EmittedEvent[] } {
  const emitted: EmittedEvent[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  } as unknown as Server;
  return { io, emitted };
}

function makeMockProvider(reply: string): LlmProvider {
  return { name: "test-provider", complete: async () => reply };
}

type FakeVacancy = { id: string; hrUserId: string; title: string; status: string; hiddenAt?: Date | null };
type FakeUser = { id: string; email: string; role: string };
type FakeInvitation = {
  id: string;
  interviewId: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};
type FakeInterview = {
  id: string;
  hrUserId: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: Date;
  scheduledAt: Date | null;
  candidateUserId?: string | null;
};
type FakeFinalReport = {
  id: string;
  interviewId: string;
  recommendation: string;
};
type CreateInput = {
  data: {
    hrUserId: string;
    vacancyId: string;
    displayName: string;
    joinCode: string;
    status: string;
    scheduledAt?: Date | null;
  };
};
type CreateImpl = (input: CreateInput) => Promise<FakeInterview> | FakeInterview;

function makeFakePrisma(
  interviews: FakeInterview[] = [],
  vacancies: FakeVacancy[] = [],
  createImpl?: CreateImpl,
  finalReports: FakeFinalReport[] = [],
  users: FakeUser[] = [],
) {
  let counter = 0;
  let invCounter = 0;
  const invitations: FakeInvitation[] = [];
  const prisma = {
    interview: {
      findMany: async ({
        where,
        include,
      }: {
        where: {
          hrUserId: string;
          displayName?: string | { not: string };
        };
        include?: {
          vacancy?: { select: { title: true } };
          finalReport?: { select: { id: true; recommendation: true } };
          invitations?: { where: { status: string }; take: number };
        };
      }) => {
        const filtered = interviews
          .filter((item) => {
            if (item.hrUserId !== where.hrUserId) return false;
            const displayNameFilter = where.displayName;
            if (typeof displayNameFilter === "string") {
              return item.displayName === displayNameFilter;
            }
            if (
              displayNameFilter &&
              typeof displayNameFilter === "object" &&
              "not" in displayNameFilter
            ) {
              return item.displayName !== displayNameFilter.not;
            }
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        if (include?.vacancy || include?.finalReport || include?.invitations) {
          return filtered.map((item) => {
            const vacancy = vacancies.find((v) => v.id === item.vacancyId);
            const finalReport = finalReports.find((r) => r.interviewId === item.id);
            return {
              ...item,
              scheduledAt: item.scheduledAt ?? null,
              ...(include?.vacancy
                ? { vacancy: { title: vacancy?.title ?? "" } }
                : {}),
              ...(include?.finalReport
                ? {
                    finalReport: finalReport
                      ? { id: finalReport.id, recommendation: finalReport.recommendation }
                      : null,
                  }
                : {}),
              ...(include?.invitations
                ? {
                    invitations: invitations
                      .filter(
                        (inv) =>
                          inv.interviewId === item.id &&
                          inv.status === include.invitations!.where.status,
                      )
                      .slice(0, include.invitations!.take),
                  }
                : {}),
            };
          });
        }
        return filtered.map((item) => ({ ...item, scheduledAt: item.scheduledAt ?? null }));
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: {
          vacancy?: { select: { title: true } };
          finalReport?: { select: { id: true; recommendation: true } };
          invitations?: { where: { status: string }; take: number };
        };
      }) => {
        const interview = interviews.find((item) => item.id === where.id) ?? null;
        if (!interview) return null;

        const withDefaults = { ...interview, scheduledAt: interview.scheduledAt ?? null };

        if (include?.vacancy || include?.finalReport || include?.invitations) {
          const vacancy = vacancies.find((v) => v.id === interview.vacancyId);
          const finalReport = finalReports.find((r) => r.interviewId === interview.id);
          return {
            ...withDefaults,
            ...(include?.vacancy
              ? { vacancy: { title: vacancy?.title ?? "" } }
              : {}),
            ...(include?.finalReport
              ? {
                  finalReport: finalReport
                    ? { id: finalReport.id, recommendation: finalReport.recommendation }
                    : null,
                }
              : {}),
            ...(include?.invitations
              ? {
                  invitations: invitations
                    .filter(
                      (inv) =>
                        inv.interviewId === interview.id &&
                        inv.status === include.invitations!.where.status,
                    )
                    .slice(0, include.invitations!.take),
                }
              : {}),
          };
        }
        return withDefaults;
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
          scheduledAt: input.data.scheduledAt ?? null,
          createdAt: new Date(),
        };
        interviews.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { scheduledAt?: Date | null };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("Interview not found");
        if (data.scheduledAt !== undefined) {
          interview.scheduledAt = data.scheduledAt;
        }
        return { ...interview, scheduledAt: interview.scheduledAt ?? null };
      },
    },
    vacancy: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        vacancies.find((v) => v.id === where.id) ?? null,
    },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
    },
    invitation: {
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
      findFirst: async ({
        where,
      }: {
        where: { interviewId?: string; status?: string };
      }) =>
        invitations.find(
          (inv) =>
            (where.interviewId === undefined || inv.interviewId === where.interviewId) &&
            (where.status === undefined || inv.status === where.status),
        ) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { interviewId?: string; status?: string };
        data: { status: string };
      }) => {
        let count = 0;
        for (const inv of invitations) {
          if (where.interviewId !== undefined && inv.interviewId !== where.interviewId) continue;
          if (where.status !== undefined && inv.status !== where.status) continue;
          inv.status = data.status;
          count += 1;
        }
        return { count };
      },
    },
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => fn(prisma),
  };
  return prisma;
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeAppWithEnd(
  fakePrisma: ReturnType<typeof makeFakePrisma>,
  user: AuthUser,
  options?: { provider?: LlmProvider; io?: Server },
) {
  const { io } = makeMockIo();
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use(
    "/api",
    createInterviewsRouter(
      () => fakePrisma as never,
      () => options?.io ?? io,
      () => options?.provider ?? makeMockProvider("{}"),
    ),
  );
  return app;
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user: AuthUser) {
  return makeAppWithEnd(fakePrisma, user);
}

const confirmedVacancy: FakeVacancy = {
  id: "v1",
  hrUserId: "hr_1",
  title: "Frontend Dev",
  status: "CONFIRMED",
};

async function postInterview(
  port: number,
  vacancyId: string,
  extra: { candidateEmail?: string; scheduledAt?: string } = {},
) {
  return fetch(`http://127.0.0.1:${port}/api/interviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vacancyId, ...extra }),
  });
}

test("POST /interviews/:id/end returns 201 and creates FinalReport when LIVE", async () => {
  const validReport = JSON.stringify({
    reportMarkdown: "## Підсумок\n\nOK",
    recommendation: "HIRE",
    contextFit: 78,
    assessments: [],
    strengths: ["Досвід"],
    risks: ["Невідомо"],
  });

  const interviews = [
    {
      id: "int_live",
      hrUserId: "hr_1",
      vacancyId: "v1",
      displayName: "Backend",
      joinCode: "ABC123",
      status: "LIVE",
      createdAt: new Date(),
    },
  ];

  let updatedStatus: string | null = null;
  let createdReport: Record<string, unknown> | null = null;

  const fakePrisma = makeFakePrisma(interviews, [confirmedVacancy]) as ReturnType<
    typeof makeFakePrisma
  > & {
    interview: ReturnType<typeof makeFakePrisma>["interview"] & {
      update: (args: { where: { id: string }; data: { status: string } }) => Promise<unknown>;
      findUnique: (args: { where: { id: string }; include?: unknown }) => Promise<unknown>;
    };
    finalReport: {
      create: (args: { data: Record<string, unknown> }) => Promise<{
        id: string;
        recommendation: string;
        matchScore: number;
      }>;
    };
    $transaction: (fn: (tx: typeof fakePrisma) => Promise<unknown>) => Promise<unknown>;
  };

  fakePrisma.interview.findUnique = async ({ where }) => {
    const interview = interviews.find((item) => item.id === where.id);
    if (!interview) return null;
    return {
      ...interview,
      finalReport: null,
      liveSession: {
        id: "ls_1",
        messages: [{ authorType: "HUMAN_HR", content: "Привіт", createdAt: new Date() }],
      },
      vacancy: {
        ...confirmedVacancy,
        companyProfile: { role: "Backend", requirements: [], culture: [], expectations: [] },
      },
      candidateProfile: { skills: [], experience: [], goals: [], summary: "Dev" },
    };
  };
  fakePrisma.interview.update = async ({ data }) => {
    updatedStatus = data.status;
    interviews[0].status = data.status;
    return interviews[0];
  };
  fakePrisma.finalReport = {
    create: async ({ data }) => {
      createdReport = data;
      return { id: "rep_1", recommendation: "HIRE", matchScore: data.matchScore as number };
    },
  };
  fakePrisma.$transaction = async (fn) => fn(fakePrisma);

  const { io, emitted } = makeMockIo();
  const app = makeAppWithEnd(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" }, {
    provider: makeMockProvider(validReport),
    io,
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/int_live/end`, {
      method: "POST",
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      report: { id: string; recommendation: string; matchScore: number };
    };
    assert.equal(body.report.id, "rep_1");
    assert.equal(body.report.recommendation, "HIRE");
    assert.equal(body.report.matchScore, 78);
    assert.equal(updatedStatus, "ENDED");
    assert.equal(createdReport?.recommendation, "HIRE");
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "room:status");
    assert.deepEqual(emitted[0].payload, { status: "ENDED" });
    assert.equal(emitted[0].room, "interview:int_live");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews/:id/end computes matchScore from assessments with critical unmet cap", async () => {
  const assessments = [
    {
      requirement: "Rust",
      priority: "critical" as const,
      status: "unmet" as const,
      evidence: "Немає",
    },
    {
      requirement: "Docker",
      priority: "desired" as const,
      status: "met" as const,
      evidence: "Є",
    },
  ];
  const llmReport = JSON.stringify({
    reportMarkdown:
      "## Підсумок\n\nOK\n## Відповідність вимогам\n### Критичні\n- Rust unmet\n### Бажані\n- Docker met",
    recommendation: "REJECT",
    contextFit: 100,
    assessments,
    strengths: ["Docker"],
    risks: ["Немає Rust"],
  });

  const interviews = [
    {
      id: "int_live_cap",
      hrUserId: "hr_1",
      vacancyId: "v1",
      displayName: "Backend",
      joinCode: "CAP123",
      status: "LIVE",
      createdAt: new Date(),
    },
  ];

  let createdReport: Record<string, unknown> | null = null;
  const expectedMatchScore = computeMatchScore(assessments, 100).matchScore;

  const fakePrisma = makeFakePrisma(interviews, [confirmedVacancy]) as ReturnType<
    typeof makeFakePrisma
  > & {
    interview: ReturnType<typeof makeFakePrisma>["interview"] & {
      update: (args: { where: { id: string }; data: { status: string } }) => Promise<unknown>;
      findUnique: (args: { where: { id: string }; include?: unknown }) => Promise<unknown>;
    };
    finalReport: {
      create: (args: { data: Record<string, unknown> }) => Promise<{
        id: string;
        recommendation: string;
        matchScore: number;
      }>;
    };
    $transaction: (fn: (tx: typeof fakePrisma) => Promise<unknown>) => Promise<unknown>;
  };

  fakePrisma.interview.findUnique = async ({ where }) => {
    const interview = interviews.find((item) => item.id === where.id);
    if (!interview) return null;
    return {
      ...interview,
      finalReport: null,
      liveSession: {
        id: "ls_cap",
        messages: [{ authorType: "HUMAN_HR", content: "Привіт", createdAt: new Date() }],
      },
      vacancy: {
        ...confirmedVacancy,
        companyProfile: {
          role: "Backend",
          requirements: { critical: ["Rust"], desired: ["Docker"] },
          culture: [],
          expectations: [],
        },
      },
      candidateProfile: { skills: [], experience: [], goals: [], summary: "Dev" },
    };
  };
  fakePrisma.interview.update = async ({ data }) => {
    interviews[0].status = data.status;
    return interviews[0];
  };
  fakePrisma.finalReport = {
    create: async ({ data }) => {
      createdReport = data;
      return {
        id: "rep_cap",
        recommendation: data.recommendation as string,
        matchScore: data.matchScore as number,
      };
    },
  };
  fakePrisma.$transaction = async (fn) => fn(fakePrisma);

  const app = makeAppWithEnd(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" }, {
    provider: makeMockProvider(llmReport),
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/int_live_cap/end`, {
      method: "POST",
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      report: { id: string; recommendation: string; matchScore: number };
    };
    assert.equal(body.report.recommendation, "REJECT");
    assert.equal(createdReport?.matchScore, expectedMatchScore);
    assert.equal(body.report.matchScore, expectedMatchScore);
    assert.ok((createdReport?.matchScore as number) <= 69);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews/:id/end returns 409 when status is not LIVE", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "int_ready",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Backend",
        joinCode: "ABC123",
        status: "READY",
        createdAt: new Date(),
      },
    ],
    [confirmedVacancy],
  );
  const app = makeAppWithEnd(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/int_ready/end`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

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
      "candidateLinked",
      "candidateUserId",
      "createdAt",
      "displayName",
      "id",
      "invitation",
      "joinCode",
      "reportId",
      "reportSummary",
      "scheduledAt",
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

test("GET /interviews/mine returns reportSummary from finalReport when present", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "ENDED",
        createdAt: new Date(1),
      },
      {
        id: "i2",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "BBBBBB",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(2),
      },
    ],
    [confirmedVacancy],
    undefined,
    [{ id: "rep_1", interviewId: "i1", recommendation: "HIRE" }]
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 2);
    assert.equal(body.interviews[0].id, "i2");
    assert.equal(body.interviews[0].reportSummary, null);
    assert.equal(body.interviews[1].id, "i1");
    assert.equal(body.interviews[1].reportSummary, "HIRE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/mine returns reportId from finalReport when present", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "ENDED",
        createdAt: new Date(1),
      },
    ],
    [confirmedVacancy],
    undefined,
    [{ id: "rep_1", interviewId: "i1", recommendation: "HIRE" }],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews[0].reportId, "rep_1");
    assert.equal(body.interviews[0].reportSummary, "HIRE");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
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

test("POST /interviews returns 409 VACANCY_HIDDEN when vacancy is hidden", async () => {
  const fakePrisma = makeFakePrisma([], [
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      hiddenAt: new Date("2026-07-22T12:00:00.000Z"),
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1");
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "VACANCY_HIDDEN");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews without email returns invitation null and null scheduledAt", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1");
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.interview.invitation, null);
    assert.equal(body.interview.scheduledAt, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews with candidateEmail creates PENDING invitation", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1", { candidateEmail: "Anna@Mail.com" });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.interview.invitation.email, "anna@mail.com");
    assert.equal(body.interview.invitation.status, "PENDING");
    assert.equal(typeof body.interview.invitation.id, "string");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews with scheduledAt stores ISO date", async () => {
  const scheduledAt = "2026-07-15T14:00:00.000Z";
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1", { scheduledAt });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.interview.scheduledAt, scheduledAt);
    assert.equal(body.interview.invitation, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews rejects invalid email with 400", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1", { candidateEmail: "not-an-email" });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid email");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews rejects invalid scheduledAt with 400", async () => {
  const fakePrisma = makeFakePrisma([], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1", { scheduledAt: "not-a-date" });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid scheduledAt");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews rejects HR email with 400", async () => {
  const fakePrisma = makeFakePrisma(
    [],
    [confirmedVacancy],
    undefined,
    [],
    [{ id: "hr_other", email: "hr@company.com", role: "HR" }],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await postInterview(port, "v1", { candidateEmail: "hr@company.com" });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Email belongs to a non-candidate user");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
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
      scheduledAt: input.data.scheduledAt ?? null,
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

test("GET /interviews/mine returns scheduledAt and pending invitation", async () => {
  const scheduledAt = new Date("2026-07-15T14:00:00.000Z");
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
        scheduledAt,
      },
    ],
    [confirmedVacancy],
  );
  await fakePrisma.invitation.create({
    data: { interviewId: "i1", email: "anna@mail.com", status: "PENDING" },
  });
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 1);
    assert.equal(body.interviews[0].scheduledAt, scheduledAt.toISOString());
    assert.equal(body.interviews[0].invitation.email, "anna@mail.com");
    assert.equal(body.interviews[0].invitation.status, "PENDING");
    assert.equal(typeof body.interviews[0].invitation.id, "string");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /interviews/:id returns scheduledAt and pending invitation", async () => {
  const scheduledAt = new Date("2026-07-15T14:00:00.000Z");
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
        scheduledAt,
      },
    ],
    [confirmedVacancy],
  );
  await fakePrisma.invitation.create({
    data: { interviewId: "i1", email: "anna@mail.com", status: "PENDING" },
  });
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/i1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.scheduledAt, scheduledAt.toISOString());
    assert.equal(body.interview.invitation.email, "anna@mail.com");
    assert.equal(body.interview.invitation.status, "PENDING");
    assert.equal(typeof body.interview.invitation.id, "string");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /interviews/mine returns null invitation when not PENDING", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i_cancelled",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(2),
        scheduledAt: null,
      },
      {
        id: "i_accepted",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "BBBBBB",
        status: "READY",
        createdAt: new Date(1),
        scheduledAt: null,
      },
    ],
    [confirmedVacancy],
  );
  await fakePrisma.invitation.create({
    data: { interviewId: "i_cancelled", email: "cancelled@mail.com", status: "CANCELLED" },
  });
  await fakePrisma.invitation.create({
    data: { interviewId: "i_accepted", email: "accepted@mail.com", status: "ACCEPTED" },
  });
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 2);
    assert.equal(body.interviews[0].invitation, null);
    assert.equal(body.interviews[1].invitation, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /interviews/:id returns null invitation when not PENDING", async () => {
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
        scheduledAt: null,
      },
    ],
    [confirmedVacancy],
  );
  await fakePrisma.invitation.create({
    data: { interviewId: "i1", email: "cancelled@mail.com", status: "CANCELLED" },
  });
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/i1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.invitation, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
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
    assert.equal(body.interview.reportId, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/:id returns reportId when finalReport exists", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "ENDED",
        createdAt: new Date(1),
      },
    ],
    [confirmedVacancy],
    undefined,
    [{ id: "rep_1", interviewId: "i1", recommendation: "HIRE" }],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/i1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.reportId, "rep_1");
    assert.equal(body.interview.reportSummary, "HIRE");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
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
        scheduledAt: null,
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

test("DELETE /interviews/:id returns 409 for self-service questionnaire", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "int_questionnaire",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Моя анкета",
        joinCode: "SELF01",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
    ],
    [confirmedVacancy],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await deleteInterview(port, "int_questionnaire");
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Self-service questionnaire cannot be deleted");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/mine excludes self-service questionnaires", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "int_real",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Backend",
        joinCode: "ABC123",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date("2026-07-16T12:00:00.000Z"),
        scheduledAt: null,
      },
      {
        id: "int_questionnaire",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Моя анкета",
        joinCode: "SELF01",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date("2026-07-16T13:00:00.000Z"),
        scheduledAt: null,
      },
    ],
    [confirmedVacancy],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 1);
    assert.equal(body.interviews[0].id, "int_real");
    assert.equal(body.interviews[0].displayName, "Backend");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/:id returns 404 for self-service questionnaire", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "int_questionnaire",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Моя анкета",
        joinCode: "SELF01",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date(),
        scheduledAt: null,
      },
    ],
    [confirmedVacancy],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/int_questionnaire`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Interview not found");
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

function patchInterviewSchedule(port: number, interviewId: string, scheduledAt: string | null) {
  return fetch(`http://127.0.0.1:${port}/api/interviews/${interviewId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledAt }),
  });
}

function patchInterviewInvitation(
  port: number,
  interviewId: string,
  candidateEmail: string | null,
) {
  return fetch(`http://127.0.0.1:${port}/api/interviews/${interviewId}/invitation`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateEmail }),
  });
}

const awaitingInterview: FakeInterview = {
  id: "int_await",
  hrUserId: "hr_1",
  vacancyId: "v1",
  displayName: "Frontend Dev",
  joinCode: "AAAAAA",
  status: "AWAITING_CANDIDATE",
  createdAt: new Date(1),
  scheduledAt: null,
};

test("PATCH /interviews/:id updates scheduledAt", async () => {
  const scheduledAt = "2026-07-20T10:00:00.000Z";
  const fakePrisma = makeFakePrisma([{ ...awaitingInterview }], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await patchInterviewSchedule(port, "int_await", scheduledAt);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.scheduledAt, scheduledAt);
    assert.equal(body.interview.id, "int_await");
    assert.equal(body.interview.invitation, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("PATCH /interviews/:id rejects ENDED with 409", async () => {
  const fakePrisma = makeFakePrisma(
    [{ ...awaitingInterview, id: "int_ended", status: "ENDED" }],
    [confirmedVacancy],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await patchInterviewSchedule(
      port,
      "int_ended",
      "2026-07-20T10:00:00.000Z",
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Cannot update schedule");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("PATCH /interviews/:id/invitation sets PENDING email", async () => {
  const fakePrisma = makeFakePrisma([{ ...awaitingInterview }], [confirmedVacancy]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await patchInterviewInvitation(port, "int_await", "Anna@Mail.com");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.invitation.email, "anna@mail.com");
    assert.equal(body.invitation.status, "PENDING");
    assert.equal(typeof body.invitation.id, "string");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("PATCH /interviews/:id/invitation replaces previous PENDING", async () => {
  const fakePrisma = makeFakePrisma([{ ...awaitingInterview }], [confirmedVacancy]);
  await fakePrisma.invitation.create({
    data: { interviewId: "int_await", email: "old@mail.com", status: "PENDING" },
  });
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await patchInterviewInvitation(port, "int_await", "new@mail.com");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.invitation.email, "new@mail.com");
    assert.equal(body.invitation.status, "PENDING");

    const oldInvitation = await fakePrisma.invitation.findFirst({
      where: { interviewId: "int_await", status: "CANCELLED" },
    });
    assert.ok(oldInvitation);
    assert.equal(oldInvitation.email, "old@mail.com");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("PATCH /interviews/:id/invitation with null cancels PENDING", async () => {
  const fakePrisma = makeFakePrisma([{ ...awaitingInterview }], [confirmedVacancy]);
  await fakePrisma.invitation.create({
    data: { interviewId: "int_await", email: "pending@mail.com", status: "PENDING" },
  });
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await patchInterviewInvitation(port, "int_await", null);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.invitation, null);

    const pending = await fakePrisma.invitation.findFirst({
      where: { interviewId: "int_await", status: "PENDING" },
    });
    assert.equal(pending, null);

    const cancelled = await fakePrisma.invitation.findFirst({
      where: { interviewId: "int_await", status: "CANCELLED" },
    });
    assert.ok(cancelled);
    assert.equal(cancelled.email, "pending@mail.com");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("PATCH invitation when candidate already joined returns 409", async () => {
  const fakePrisma = makeFakePrisma(
    [{ ...awaitingInterview, candidateUserId: "cand_1" }],
    [confirmedVacancy],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await patchInterviewInvitation(port, "int_await", "new@mail.com");
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Cannot update invitation");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

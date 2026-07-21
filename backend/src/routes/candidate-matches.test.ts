import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import type { LlmProvider } from "../llm/types";
import { createCandidateMatchesRouter } from "./candidate-matches";

process.env.JWT_SECRET = "test-secret-min-8-chars";

type FakeVacancy = {
  id: string;
  hrUserId: string;
  title: string;
  status: string;
  companyProfile: {
    role: string;
    requirements: unknown;
    culture: unknown;
    expectations: unknown;
    confirmedAt: Date | null;
  } | null;
};

type FakeInterview = {
  id: string;
  candidateUserId: string | null;
  displayName: string;
  status: string;
  createdAt: Date;
};

type FakeCandidateProfile = {
  interviewId: string;
  fullName: string;
  email: string;
  experience: unknown;
  skills: unknown;
  goals: unknown;
  summary: string;
  confirmedAt: Date | null;
};

type FakeMatchScore = {
  id: string;
  candidateUserId: string;
  vacancyId: string;
  matchScore: number;
  breakdown?: unknown;
  rankedForConfirmedAt: Date;
  rankedForVacancyConfirmedAt: Date;
};

type FakeOfferDecision = {
  id: string;
  candidateUserId: string;
  vacancyId: string;
  decision: string;
};

type FakeApplication = {
  id: string;
  candidateUserId: string;
  vacancyId: string;
  matchScore: number;
  matchBreakdown?: unknown;
  candidateSummary: string;
  status: string;
};

type FakeNotification = {
  id: string;
  hrUserId: string;
  type: string;
  payload: unknown;
};

function sameInstant(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function makeFakePrisma(seed: {
  vacancies?: FakeVacancy[];
  interviews?: FakeInterview[];
  candidateProfiles?: FakeCandidateProfile[];
  matchScores?: FakeMatchScore[];
  offerDecisions?: FakeOfferDecision[];
  applications?: FakeApplication[];
  notifications?: FakeNotification[];
}) {
  const vacancies = (seed.vacancies ?? []).map((item) => ({ ...item }));
  const interviews = (seed.interviews ?? []).map((item) => ({ ...item }));
  const candidateProfiles = (seed.candidateProfiles ?? []).map((item) => ({ ...item }));
  const matchScores = (seed.matchScores ?? []).map((item) => ({ ...item }));
  const offerDecisions = (seed.offerDecisions ?? []).map((item) => ({ ...item }));
  const applications = (seed.applications ?? []).map((item) => ({ ...item }));
  const notifications = (seed.notifications ?? []).map((item) => ({ ...item }));
  let scoreSeq = matchScores.length;
  let decisionSeq = offerDecisions.length;
  let appSeq = applications.length;
  let notifSeq = notifications.length;

  const prisma = {
    vacancy: {
      findMany: async ({
        where,
        include,
      }: {
        where?: {
          status?: string;
          companyProfile?: { confirmedAt?: { not: null } };
        };
        include?: { companyProfile?: boolean };
      }) =>
        vacancies
          .filter((item) => {
            if (where?.status != null && item.status !== where.status) return false;
            if (where?.companyProfile?.confirmedAt?.not === null) {
              if (item.companyProfile?.confirmedAt == null) return false;
            }
            return true;
          })
          .map((item) => ({
            ...item,
            companyProfile: include?.companyProfile ? item.companyProfile : undefined,
          })),
      findUnique: async ({ where }: { where: { id: string } }) =>
        vacancies.find((item) => item.id === where.id) ?? null,
    },
    interview: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: { createdAt: "desc" | "asc" };
      }) => {
        const matches = interviews.filter((item) => {
          if (where.candidateUserId != null && item.candidateUserId !== where.candidateUserId) {
            return false;
          }
          if (typeof where.displayName === "string" && item.displayName !== where.displayName) {
            return false;
          }
          const statusFilter = where.status as { in: string[] } | undefined;
          if (statusFilter?.in && !statusFilter.in.includes(item.status)) return false;
          return true;
        });
        if (orderBy?.createdAt === "desc") {
          matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return matches[0] ?? null;
      },
    },
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        candidateProfiles.find((item) => item.interviewId === where.interviewId) ?? null,
    },
    vacancyMatchScore: {
      findMany: async ({
        where,
        include,
      }: {
        where: {
          candidateUserId: string;
          rankedForConfirmedAt?: Date;
        };
        include?: { vacancy?: boolean };
      }) =>
        matchScores
          .filter((item) => {
            if (item.candidateUserId !== where.candidateUserId) return false;
            if (
              where.rankedForConfirmedAt != null &&
              !sameInstant(item.rankedForConfirmedAt, where.rankedForConfirmedAt)
            ) {
              return false;
            }
            return true;
          })
          .map((item) => ({
            ...item,
            vacancy: include?.vacancy
              ? vacancies.find((vacancy) => vacancy.id === item.vacancyId) ?? null
              : undefined,
          })),
      findUnique: async ({
        where,
      }: {
        where: { candidateUserId_vacancyId: { candidateUserId: string; vacancyId: string } };
      }) => {
        const key = where.candidateUserId_vacancyId;
        return (
          matchScores.find(
            (item) =>
              item.candidateUserId === key.candidateUserId && item.vacancyId === key.vacancyId,
          ) ?? null
        );
      },
      createMany: async ({
        data,
      }: {
        data: Array<{
          candidateUserId: string;
          vacancyId: string;
          matchScore: number;
          breakdown?: unknown;
          rankedForConfirmedAt: Date;
          rankedForVacancyConfirmedAt: Date;
        }>;
      }) => {
        for (const row of data) {
          scoreSeq += 1;
          matchScores.push({ id: `score_${scoreSeq}`, ...row });
        }
        return { count: data.length };
      },
    },
    vacancyOfferDecision: {
      findMany: async ({
        where,
      }: {
        where: { candidateUserId: string; decision?: string };
      }) =>
        offerDecisions.filter((item) => {
          if (item.candidateUserId !== where.candidateUserId) return false;
          if (where.decision != null && item.decision !== where.decision) return false;
          return true;
        }),
      findUnique: async ({
        where,
      }: {
        where: { candidateUserId_vacancyId: { candidateUserId: string; vacancyId: string } };
      }) => {
        const key = where.candidateUserId_vacancyId;
        return (
          offerDecisions.find(
            (item) =>
              item.candidateUserId === key.candidateUserId && item.vacancyId === key.vacancyId,
          ) ?? null
        );
      },
      create: async ({
        data,
      }: {
        data: { candidateUserId: string; vacancyId: string; decision: string };
      }) => {
        decisionSeq += 1;
        const created: FakeOfferDecision = { id: `dec_${decisionSeq}`, ...data };
        offerDecisions.push(created);
        return created;
      },
    },
    vacancyApplication: {
      findFirst: async ({
        where,
      }: {
        where: { candidateUserId: string; status?: string };
      }) =>
        applications.find((item) => {
          if (item.candidateUserId !== where.candidateUserId) return false;
          if (where.status != null && item.status !== where.status) return false;
          return true;
        }) ?? null,
      create: async ({
        data,
      }: {
        data: {
          candidateUserId: string;
          vacancyId: string;
          matchScore: number;
          matchBreakdown?: unknown;
          candidateSummary: string;
          status: string;
        };
      }) => {
        if (
          data.status === "PENDING" &&
          applications.some(
            (item) => item.candidateUserId === data.candidateUserId && item.status === "PENDING",
          )
        ) {
          const err = new Error("Unique constraint failed on VacancyApplication");
          (err as { code?: string }).code = "P2002";
          throw err;
        }
        appSeq += 1;
        const created: FakeApplication = { id: `app_${appSeq}`, ...data };
        applications.push(created);
        return created;
      },
    },
    hrNotification: {
      create: async ({
        data,
      }: {
        data: { hrUserId: string; type: string; payload: unknown };
      }) => {
        notifSeq += 1;
        const created: FakeNotification = { id: `notif_${notifSeq}`, ...data };
        notifications.push(created);
        return created;
      },
    },
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => {
      const appsSnap = applications.map((item) => ({ ...item }));
      const notifsSnap = notifications.map((item) => ({ ...item }));
      const appSeqSnap = appSeq;
      const notifSeqSnap = notifSeq;
      try {
        return await fn(prisma);
      } catch (error) {
        applications.length = 0;
        applications.push(...appsSnap);
        notifications.length = 0;
        notifications.push(...notifsSnap);
        appSeq = appSeqSnap;
        notifSeq = notifSeqSnap;
        throw error;
      }
    },
    __offerDecisions: offerDecisions,
    __applications: applications,
    __notifications: notifications,
  };

  return prisma;
}

const confirmedAt = new Date("2026-07-10T12:00:00.000Z");

const candidateUser: AuthUser = {
  id: "candidate_1",
  email: "candidate@test.com",
  role: "CANDIDATE",
};

function confirmedSeed(overrides?: {
  vacancies?: FakeVacancy[];
  matchScores?: FakeMatchScore[];
  offerDecisions?: FakeOfferDecision[];
  applications?: FakeApplication[];
  confirmedAt?: Date | null;
}) {
  const profileConfirmedAt =
    overrides && "confirmedAt" in overrides ? overrides.confirmedAt : confirmedAt;
  return {
    interviews: [
      {
        id: "q1",
        candidateUserId: "candidate_1",
        displayName: "Моя анкета",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    candidateProfiles: [
      {
        interviewId: "q1",
        fullName: "Ірина Тест",
        email: "candidate@test.com",
        experience: { years: 3 },
        skills: ["TS"],
        goals: { role: "backend" },
        summary: "Досвідчена розробниця",
        confirmedAt: profileConfirmedAt,
      },
    ],
    vacancies: overrides?.vacancies ?? [
      {
        id: "v1",
        hrUserId: "hr_1",
        title: "Senior Backend",
        status: "CONFIRMED",
        companyProfile: {
          role: "Backend",
          requirements: { critical: ["TS"], desired: [] },
          culture: { values: ["ownership"] },
          expectations: {},
          confirmedAt,
        },
      },
      {
        id: "v2",
        hrUserId: "hr_1",
        title: "Platform Engineer",
        status: "CONFIRMED",
        companyProfile: {
          role: "Platform",
          requirements: { critical: ["Go"], desired: [] },
          culture: {},
          expectations: {},
          confirmedAt,
        },
      },
    ],
    matchScores: overrides?.matchScores ?? [
      {
        id: "s1",
        candidateUserId: "candidate_1",
        vacancyId: "v1",
        matchScore: 90,
        rankedForConfirmedAt: confirmedAt,
        rankedForVacancyConfirmedAt: confirmedAt,
      },
      {
        id: "s2",
        candidateUserId: "candidate_1",
        vacancyId: "v2",
        matchScore: 80,
        rankedForConfirmedAt: confirmedAt,
        rankedForVacancyConfirmedAt: confirmedAt,
      },
    ],
    offerDecisions: overrides?.offerDecisions ?? [],
    applications: overrides?.applications ?? [],
  };
}

function makeFakeLlm(summary = "Сильний бекенд-досвід."): LlmProvider {
  return {
    name: "fake",
    complete: async () => JSON.stringify({ summary }),
  };
}

function makeApp(
  fakePrisma: ReturnType<typeof makeFakePrisma>,
  llm: LlmProvider = makeFakeLlm(),
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/candidate",
    createCandidateMatchesRouter(() => fakePrisma as never, () => llm),
  );
  return app;
}

function authHeaders(user: AuthUser): Record<string, string> {
  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  return { Authorization: `Bearer ${token}` };
}

test("GET /matches/next returns 403 when questionnaire not confirmed", async () => {
  const fakePrisma = makeFakePrisma(confirmedSeed({ confirmedAt: null }));
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/next`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Questionnaire not confirmed");
  } finally {
    server.close();
  }
});

test("GET /matches/next returns offers array with contract keys only", async () => {
  const fakePrisma = makeFakePrisma(confirmedSeed());
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/next`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      offers: Array<Record<string, unknown>>;
    };
    assert.ok(Array.isArray(body.offers));
    assert.equal(body.offers.length, 2);
    assert.deepEqual(Object.keys(body).sort(), ["offers"]);
    for (const offer of body.offers) {
      assert.deepEqual(Object.keys(offer).sort(), [
        "matchScore",
        "salaryDisplay",
        "title",
        "vacancyId",
        "workFormatDisplay",
      ]);
      assert.ok(!("culture" in offer));
    }
    assert.equal(body.offers[0]?.vacancyId, "v1");
    assert.equal(body.offers[0]?.matchScore, 90);
    assert.equal(body.offers[1]?.vacancyId, "v2");
    assert.equal(body.offers[1]?.matchScore, 80);
  } finally {
    server.close();
  }
});

test("GET /candidate/matches offers omit breakdown", async () => {
  const breakdown = {
    assessments: [
      {
        requirement: "TS",
        priority: "critical",
        status: "met",
        evidence: "Є в skills",
      },
    ],
    contextFit: 80,
    criticalFit: 100,
    desiredFit: null,
    requirementsFit: 100,
    rawScore: 90,
    cappedByCriticalUnmet: false,
    matchScore: 90,
  };
  const fakePrisma = makeFakePrisma(
    confirmedSeed({
      matchScores: [
        {
          id: "s1",
          candidateUserId: "candidate_1",
          vacancyId: "v1",
          matchScore: 90,
          breakdown,
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: confirmedAt,
        },
        {
          id: "s2",
          candidateUserId: "candidate_1",
          vacancyId: "v2",
          matchScore: 80,
          breakdown: { ...breakdown, matchScore: 80, rawScore: 80 },
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: confirmedAt,
        },
      ],
    }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/next`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      offers: Array<Record<string, unknown>>;
    };
    assert.equal(body.offers[0]?.breakdown, undefined);
    assert.deepEqual(Object.keys(body.offers[0]!).sort(), [
      "matchScore",
      "salaryDisplay",
      "title",
      "vacancyId",
      "workFormatDisplay",
    ]);
  } finally {
    server.close();
  }
});

test("GET /matches/next returns 409 when PENDING application exists", async () => {
  const fakePrisma = makeFakePrisma(
    confirmedSeed({
      applications: [
        {
          id: "app_1",
          candidateUserId: "candidate_1",
          vacancyId: "v1",
          matchScore: 90,
          candidateSummary: "summary",
          status: "PENDING",
        },
      ],
    }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/next`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "ACTIVE_APPLICATION_EXISTS");
  } finally {
    server.close();
  }
});

test("POST /matches/:id/reject records decision and returns updated offers", async () => {
  const fakePrisma = makeFakePrisma(confirmedSeed());
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/reject`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      offers: Array<{ vacancyId: string; title: string; matchScore: number }>;
    };
    assert.deepEqual(Object.keys(body).sort(), ["offers"]);
    assert.equal(body.offers.length, 1);
    assert.equal(body.offers[0]?.vacancyId, "v2");
    assert.equal(body.offers[0]?.title, "Platform Engineer");
    assert.equal(body.offers[0]?.matchScore, 80);
    assert.equal(fakePrisma.__offerDecisions.length, 1);
    assert.equal(fakePrisma.__offerDecisions[0]?.vacancyId, "v1");
  } finally {
    server.close();
  }
});

test("GET /matches/next returns at most 5 offers sorted by score", async () => {
  const vacancies = Array.from({ length: 6 }, (_, index) => ({
    id: `v${index + 1}`,
    hrUserId: "hr_1",
    title: `Role ${index + 1}`,
    status: "CONFIRMED",
    companyProfile: {
      role: "Dev",
      requirements: { critical: [`Skill-${index + 1}`], desired: [] as string[] },
      culture: {},
      expectations: {},
      confirmedAt,
    },
  }));
  const matchScores = Array.from({ length: 6 }, (_, index) => ({
    id: `s${index + 1}`,
    candidateUserId: "candidate_1",
    vacancyId: `v${index + 1}`,
    matchScore: 99 - index,
    rankedForConfirmedAt: confirmedAt,
    rankedForVacancyConfirmedAt: confirmedAt,
  }));

  const fakePrisma = makeFakePrisma(
    confirmedSeed({ vacancies, matchScores }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/next`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { offers: Array<{ vacancyId: string }> };
    assert.equal(body.offers.length, 5);
    assert.deepEqual(
      body.offers.map((item) => item.vacancyId),
      ["v1", "v2", "v3", "v4", "v5"],
    );
  } finally {
    server.close();
  }
});

test("POST /matches/:id/reject backfills sixth offer when available", async () => {
  const vacancies = Array.from({ length: 6 }, (_, index) => ({
    id: `v${index + 1}`,
    hrUserId: "hr_1",
    title: `Role ${index + 1}`,
    status: "CONFIRMED",
    companyProfile: {
      role: "Dev",
      requirements: { critical: [`Skill-${index + 1}`], desired: [] as string[] },
      culture: {},
      expectations: {},
      confirmedAt,
    },
  }));
  const matchScores = Array.from({ length: 6 }, (_, index) => ({
    id: `s${index + 1}`,
    candidateUserId: "candidate_1",
    vacancyId: `v${index + 1}`,
    matchScore: 99 - index,
    rankedForConfirmedAt: confirmedAt,
    rankedForVacancyConfirmedAt: confirmedAt,
  }));

  const fakePrisma = makeFakePrisma(
    confirmedSeed({ vacancies, matchScores }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/reject`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { offers: Array<{ vacancyId: string }> };
    assert.equal(body.offers.length, 5);
    assert.deepEqual(
      body.offers.map((item) => item.vacancyId),
      ["v2", "v3", "v4", "v5", "v6"],
    );
  } finally {
    server.close();
  }
});


test("POST /matches/:id/accept creates application and notification", async () => {
  const fakePrisma = makeFakePrisma(confirmedSeed());
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/accept`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.application.vacancyId, "v1");
    assert.equal(body.application.matchScore, 90);
    assert.equal(body.application.status, "PENDING");
    assert.ok(body.application.id);

    assert.equal(fakePrisma.__applications.length, 1);
    assert.equal(fakePrisma.__applications[0]?.candidateSummary, "Сильний бекенд-досвід.");
    assert.equal(fakePrisma.__notifications.length, 1);
    assert.equal(fakePrisma.__notifications[0]?.hrUserId, "hr_1");
    assert.equal(fakePrisma.__notifications[0]?.type, "VACANCY_APPLICATION");
    const payload = fakePrisma.__notifications[0]?.payload as Record<string, unknown>;
    assert.equal(payload.applicationId, body.application.id);
    assert.equal(payload.candidateName, "Ірина Тест");
    assert.equal(payload.email, "candidate@test.com");
    assert.equal(payload.vacancyTitle, "Senior Backend");
    assert.equal(payload.matchScore, 90);
  } finally {
    server.close();
  }
});

test("POST /candidate/matches/:vacancyId/accept stores matchBreakdown snapshot", async () => {
  const breakdown = {
    assessments: [
      {
        requirement: "TS",
        priority: "critical",
        status: "met",
        evidence: "Є в skills",
      },
    ],
    contextFit: 80,
    criticalFit: 100,
    desiredFit: null,
    requirementsFit: 100,
    rawScore: 90,
    cappedByCriticalUnmet: false,
    matchScore: 90,
  };
  const fakePrisma = makeFakePrisma(
    confirmedSeed({
      matchScores: [
        {
          id: "s1",
          candidateUserId: "candidate_1",
          vacancyId: "v1",
          matchScore: 90,
          breakdown,
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: confirmedAt,
        },
        {
          id: "s2",
          candidateUserId: "candidate_1",
          vacancyId: "v2",
          matchScore: 80,
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: confirmedAt,
        },
      ],
    }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/accept`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    assert.ok(fakePrisma.__applications[0]?.matchBreakdown);
    assert.equal(
      (fakePrisma.__applications[0]?.matchBreakdown as { matchScore: number }).matchScore,
      90,
    );
    const body = await response.json();
    assert.equal(body.application.breakdown, undefined);
    assert.equal(body.application.matchBreakdown, undefined);
  } finally {
    server.close();
  }
});

test("POST /matches/:id/accept returns 409 when PENDING exists", async () => {
  const fakePrisma = makeFakePrisma(
    confirmedSeed({
      applications: [
        {
          id: "app_1",
          candidateUserId: "candidate_1",
          vacancyId: "v2",
          matchScore: 80,
          candidateSummary: "summary",
          status: "PENDING",
        },
      ],
    }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/accept`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "ACTIVE_APPLICATION_EXISTS");
    assert.equal(fakePrisma.__applications.length, 1);
  } finally {
    server.close();
  }
});

test("POST /matches/:id/accept maps P2002 to 409 ACTIVE_APPLICATION_EXISTS", async () => {
  const fakePrisma = makeFakePrisma(confirmedSeed());
  // Simulate race: pre-check sees no pending, but unique index rejects create.
  fakePrisma.vacancyApplication.findFirst = async () => null;
  fakePrisma.vacancyApplication.create = async () => {
    const err = new Error("Unique constraint failed");
    (err as { code?: string }).code = "P2002";
    throw err;
  };

  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/accept`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "ACTIVE_APPLICATION_EXISTS");
    assert.equal(fakePrisma.__applications.length, 0);
    assert.equal(fakePrisma.__notifications.length, 0);
  } finally {
    server.close();
  }
});

test("GET /applications/active returns pending application", async () => {
  const fakePrisma = makeFakePrisma(
    confirmedSeed({
      applications: [
        {
          id: "app_1",
          candidateUserId: "candidate_1",
          vacancyId: "v1",
          matchScore: 90,
          candidateSummary: "summary",
          status: "PENDING",
        },
      ],
    }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/applications/active`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.application.id, "app_1");
    assert.equal(body.application.vacancyId, "v1");
    assert.equal(body.application.matchScore, 90);
    assert.equal(body.application.status, "PENDING");
  } finally {
    server.close();
  }
});

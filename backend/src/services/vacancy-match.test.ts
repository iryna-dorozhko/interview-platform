import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import type { MatchBreakdown } from "./match-score";
import {
  attachDisplaysToOffers,
  enrichOfferWithDisplays,
  ensureMatchScores,
  getTopMatchOffers,
  listMatchableVacancies,
  pickTopOffers,
  pickNextOffer,
  sortScoresDesc,
  toCandidateOfferPayload,
  VacancyMatchServiceError,
} from "./vacancy-match";

test("sortScoresDesc orders by matchScore descending", () => {
  const sorted = sortScoresDesc([
    { vacancyId: "a", title: "A", matchScore: 40 },
    { vacancyId: "b", title: "B", matchScore: 90 },
    { vacancyId: "c", title: "C", matchScore: 70 },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.vacancyId),
    ["b", "c", "a"],
  );
});

test("pickNextOffer skips rejected and returns highest remaining", () => {
  const next = pickNextOffer(
    [
      { vacancyId: "b", title: "B", matchScore: 90 },
      { vacancyId: "c", title: "C", matchScore: 70 },
      { vacancyId: "a", title: "A", matchScore: 40 },
    ],
    new Set(["b"]),
  );
  assert.deepEqual(next, { vacancyId: "c", title: "C", matchScore: 70 });
});

test("pickNextOffer returns null when all rejected", () => {
  const next = pickNextOffer(
    [{ vacancyId: "a", title: "A", matchScore: 50 }],
    new Set(["a"]),
  );
  assert.equal(next, null);
});

test("pickTopOffers returns top 5 by matchScore descending", () => {
  const scores = [
    { vacancyId: "v1", title: "One", matchScore: 95 },
    { vacancyId: "v2", title: "Two", matchScore: 90 },
    { vacancyId: "v3", title: "Three", matchScore: 85 },
    { vacancyId: "v4", title: "Four", matchScore: 80 },
    { vacancyId: "v5", title: "Five", matchScore: 75 },
    { vacancyId: "v6", title: "Six", matchScore: 70 },
  ];
  const top = pickTopOffers(scores, new Set());
  assert.equal(top.length, 5);
  assert.deepEqual(
    top.map((item) => item.vacancyId),
    ["v1", "v2", "v3", "v4", "v5"],
  );
});

test("pickTopOffers skips rejected vacancies", () => {
  const scores = [
    { vacancyId: "v1", title: "One", matchScore: 95 },
    { vacancyId: "v2", title: "Two", matchScore: 90 },
    { vacancyId: "v3", title: "Three", matchScore: 85 },
  ];
  const top = pickTopOffers(scores, new Set(["v1"]));
  assert.deepEqual(
    top.map((item) => item.vacancyId),
    ["v2", "v3"],
  );
});

test("pickTopOffers returns empty array when all rejected", () => {
  const top = pickTopOffers(
    [{ vacancyId: "v1", title: "One", matchScore: 50 }],
    new Set(["v1"]),
  );
  assert.deepEqual(top, []);
});

test("enrichOfferWithDisplays adds salary and format from company profile", () => {
  const offer = enrichOfferWithDisplays(
    { vacancyId: "v1", title: "Backend", matchScore: 88 },
    {
      workConditions: ["Формат: remote, 2 дні в офісі"],
      compensation: { displayText: "$4000 gross, USD" },
    },
  );
  assert.equal(offer.salaryDisplay, "$4000 gross, USD");
  assert.equal(offer.workFormatDisplay, "remote, 2 дні в офісі");
});

test("enrichOfferWithDisplays returns null displays for не вказано", () => {
  const offer = enrichOfferWithDisplays(
    { vacancyId: "v1", title: "Backend", matchScore: 50 },
    {
      workConditions: ["Формат: не вказано"],
      compensation: { displayText: "не вказано" },
    },
  );
  assert.equal(offer.salaryDisplay, null);
  assert.equal(offer.workFormatDisplay, null);
});

test("candidate offer payload includes display fields", () => {
  const offer = enrichOfferWithDisplays(
    { vacancyId: "v1", title: "Backend", matchScore: 88, companyName: "Acme" },
    {
      workConditions: ["Формат: remote"],
      compensation: { displayText: "$4000 gross" },
    },
  );
  assert.deepEqual(Object.keys(toCandidateOfferPayload(offer)).sort(), [
    "companyName",
    "matchScore",
    "salaryDisplay",
    "title",
    "vacancyId",
    "workFormatDisplay",
  ]);
});

type FakeVacancy = {
  id: string;
  title: string;
  status: string;
  hiddenAt?: Date | null;
  hrUserId?: string;
  companyProfile: {
    role: string;
    requirements: unknown;
    culture: unknown;
    expectations: unknown;
    workConditions?: unknown;
    compensation?: unknown;
    confirmedAt: Date | null;
  } | null;
  hrUser?: {
    hrCompanyProfile: { companyName: string | null } | null;
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
  breakdown?: MatchBreakdown | Record<string, unknown>;
  rankedForConfirmedAt: Date;
  rankedForVacancyConfirmedAt: Date;
};

type FakeOfferDecision = {
  candidateUserId: string;
  vacancyId: string;
  decision: string;
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
}) {
  const vacancies = (seed.vacancies ?? []).map((item) => ({ ...item }));
  const interviews = (seed.interviews ?? []).map((item) => ({ ...item }));
  const candidateProfiles = (seed.candidateProfiles ?? []).map((item) => ({ ...item }));
  const matchScores = (seed.matchScores ?? []).map((item) => ({ ...item }));
  const offerDecisions = (seed.offerDecisions ?? []).map((item) => ({ ...item }));
  let scoreSeq = matchScores.length;

  return {
    vacancy: {
      findMany: async ({
        where,
        include,
      }: {
        where?: {
          status?: string;
          hiddenAt?: null;
          id?: { in: string[] };
          companyProfile?: { confirmedAt?: { not: null } };
        };
        include?: {
          companyProfile?: boolean;
          hrUser?: boolean | { include?: { hrCompanyProfile?: boolean } };
        };
      }) => {
        return vacancies
          .filter((item) => {
            if (where?.status != null && item.status !== where.status) return false;
            if (where?.hiddenAt === null && (item.hiddenAt ?? null) !== null) return false;
            if (where?.id?.in != null && !where.id.in.includes(item.id)) return false;
            if (where?.companyProfile?.confirmedAt?.not === null) {
              if (item.companyProfile?.confirmedAt == null) return false;
            }
            return true;
          })
          .map((item) => ({
            ...item,
            companyProfile: include?.companyProfile ? item.companyProfile : undefined,
            hrUser: include?.hrUser
              ? item.hrUser ?? { hrCompanyProfile: null }
              : undefined,
          }));
      },
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
        include?: { vacancy?: boolean | { include?: { companyProfile?: boolean } } };
      }) => {
        return matchScores
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
          }));
      },
      createMany: async ({
        data,
      }: {
        data: Array<{
          candidateUserId: string;
          vacancyId: string;
          matchScore: number;
          breakdown?: MatchBreakdown | Record<string, unknown>;
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
    },
    __matchScores: matchScores,
  };
}

const confirmedAt = new Date("2026-07-10T12:00:00.000Z");
const olderConfirmedAt = new Date("2026-07-01T12:00:00.000Z");

test("attachDisplaysToOffers sets companyName from hrCompanyProfile", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [
      {
        id: "v1",
        title: "Backend",
        status: "CONFIRMED",
        hrUserId: "hr_1",
        companyProfile: {
          role: "Backend",
          requirements: { critical: [], desired: [] },
          culture: [],
          expectations: [],
          confirmedAt,
        },
        hrUser: {
          hrCompanyProfile: { companyName: "SoftServe" },
        },
      },
    ],
  });

  const offers = await attachDisplaysToOffers(fakePrisma as unknown as PrismaClient, [
    { vacancyId: "v1", title: "Backend", matchScore: 88 },
  ]);

  assert.equal(offers[0]?.companyName, "SoftServe");
});

test("attachDisplaysToOffers yields null companyName when profile name is missing", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [
      {
        id: "v1",
        title: "Backend",
        status: "CONFIRMED",
        hrUserId: "hr_1",
        companyProfile: {
          role: "Backend",
          requirements: { critical: [], desired: [] },
          culture: [],
          expectations: [],
          confirmedAt,
        },
        hrUser: {
          hrCompanyProfile: { companyName: null },
        },
      },
    ],
  });

  const offers = await attachDisplaysToOffers(fakePrisma as unknown as PrismaClient, [
    { vacancyId: "v1", title: "Backend", matchScore: 50 },
  ]);

  assert.equal(offers[0]?.companyName, null);
});

function confirmedCandidateSeed(overrides?: {
  confirmedAt?: Date;
  vacancies?: FakeVacancy[];
  matchScores?: FakeMatchScore[];
  offerDecisions?: FakeOfferDecision[];
}) {
  return {
    interviews: [
      {
        id: "q1",
        candidateUserId: "cd_1",
        displayName: "Моя анкета",
        status: "AWAITING_CANDIDATE",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    candidateProfiles: [
      {
        interviewId: "q1",
        fullName: "Ірина Тест",
        email: "iryna@example.com",
        experience: { years: 3 },
        skills: ["TS"],
        goals: { role: "backend" },
        summary: "Досвідчена розробниця",
        confirmedAt: overrides?.confirmedAt ?? confirmedAt,
      },
    ],
    vacancies: overrides?.vacancies ?? [],
    matchScores: overrides?.matchScores ?? [],
    offerDecisions: overrides?.offerDecisions ?? [],
  };
}

test("listMatchableVacancies excludes hidden vacancies", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [
      {
        id: "visible_id",
        title: "Visible",
        status: "CONFIRMED",
        hiddenAt: null,
        companyProfile: {
          role: "Backend",
          requirements: { critical: ["TS"], desired: [] },
          culture: [],
          expectations: [],
          confirmedAt,
        },
      },
      {
        id: "hidden_id",
        title: "Hidden",
        status: "CONFIRMED",
        hiddenAt: new Date("2026-07-22T10:00:00.000Z"),
        companyProfile: {
          role: "Backend",
          requirements: { critical: ["TS"], desired: [] },
          culture: [],
          expectations: [],
          confirmedAt,
        },
      },
    ],
  });

  const result = await listMatchableVacancies(fakePrisma as unknown as PrismaClient);
  assert.equal(result.length, 1);
  assert.equal(result[0].vacancyId, "visible_id");
});

test("ensureMatchScores returns empty without calling LLM when no confirmed vacancies", async () => {
  const fakePrisma = makeFakePrisma(confirmedCandidateSeed());
  let completeCalls = 0;
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      return '{"results":[]}';
    },
  };

  const offers = await ensureMatchScores(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.deepEqual(offers, []);
  assert.equal(completeCalls, 0);
});

test("getTopMatchOffers skips rejected vacancies and returns remaining", async () => {
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      vacancies: [
        {
          id: "v1",
          title: "Senior Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            requirements: { critical: ["TS"], desired: [] },
            culture: [],
            expectations: [],
            confirmedAt,
          },
        },
        {
          id: "v2",
          title: "Platform Engineer",
          status: "CONFIRMED",
          companyProfile: {
            role: "Platform",
            requirements: { critical: ["Go"], desired: [] },
            culture: [],
            expectations: [],
            confirmedAt,
          },
        },
      ],
      matchScores: [
        {
          id: "s1",
          candidateUserId: "cd_1",
          vacancyId: "v1",
          matchScore: 90,
          breakdown: { matchScore: 90, cappedByCriticalUnmet: false },
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: confirmedAt,
        },
        {
          id: "s2",
          candidateUserId: "cd_1",
          vacancyId: "v2",
          matchScore: 80,
          breakdown: { matchScore: 80, cappedByCriticalUnmet: false },
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: confirmedAt,
        },
      ],
      offerDecisions: [{ candidateUserId: "cd_1", vacancyId: "v1", decision: "REJECTED" }],
    }),
  );
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => '{"results":[]}',
  };

  const offers = await getTopMatchOffers(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.deepEqual(offers.map(toCandidateOfferPayload), [
    {
      vacancyId: "v2",
      title: "Platform Engineer",
      matchScore: 80,
      salaryDisplay: null,
      workFormatDisplay: null,
      companyName: null,
    },
  ]);
});

test("ensureMatchScores re-ranks when confirmedAt changes", async () => {
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      confirmedAt,
      vacancies: [
        {
          id: "v1",
          title: "Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            requirements: { critical: ["TS"], desired: [] },
            culture: [],
            expectations: [],
            confirmedAt,
          },
        },
      ],
      matchScores: [
        {
          id: "old",
          candidateUserId: "cd_1",
          vacancyId: "v1",
          matchScore: 40,
          breakdown: { matchScore: 40, cappedByCriticalUnmet: false },
          rankedForConfirmedAt: olderConfirmedAt,
          rankedForVacancyConfirmedAt: confirmedAt,
        },
      ],
    }),
  );
  let completeCalls = 0;
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      return JSON.stringify({
        results: [
          {
            vacancyId: "v1",
            contextFit: 55,
            assessments: [
              {
                requirement: "TS",
                priority: "critical",
                status: "met",
                evidence: "Є TS у skills",
              },
            ],
          },
        ],
      });
    },
  };

  const offers = await ensureMatchScores(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.equal(completeCalls, 1);
  assert.deepEqual(offers.map(toCandidateOfferPayload), [
    {
      vacancyId: "v1",
      title: "Backend",
      matchScore: 91,
      salaryDisplay: null,
      workFormatDisplay: null,
      companyName: null,
    },
  ]);
  assert.equal(
    fakePrisma.__matchScores.some(
      (row) =>
        row.vacancyId === "v1" &&
        row.matchScore === 91 &&
        sameInstant(row.rankedForConfirmedAt, confirmedAt) &&
        sameInstant(row.rankedForVacancyConfirmedAt, confirmedAt),
    ),
    true,
  );
});

test("ensureMatchScores ranks only vacancies missing current cache versions", async () => {
  const vacancyConfirmedAt = confirmedAt;
  let completeCalls = 0;
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      vacancies: [
        {
          id: "v1",
          title: "Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            requirements: { critical: ["Node.js"], desired: [] },
            culture: [],
            expectations: [],
            confirmedAt: vacancyConfirmedAt,
          },
        },
        {
          id: "v2",
          title: "Platform",
          status: "CONFIRMED",
          companyProfile: {
            role: "Platform",
            requirements: { critical: ["Go"], desired: ["K8s"] },
            culture: [],
            expectations: [],
            confirmedAt: vacancyConfirmedAt,
          },
        },
      ],
      matchScores: [
        {
          id: "s1",
          candidateUserId: "cd_1",
          vacancyId: "v1",
          matchScore: 90,
          breakdown: { matchScore: 90, cappedByCriticalUnmet: false },
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: vacancyConfirmedAt,
        },
      ],
    }),
  );
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async (messages) => {
      completeCalls += 1;
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      assert.match(user, /v2/);
      assert.doesNotMatch(user, /"vacancyId": "v1"/);
      return JSON.stringify({
        results: [
          {
            vacancyId: "v2",
            contextFit: 80,
            assessments: [
              {
                requirement: "Go",
                priority: "critical",
                status: "met",
                evidence: "Є Go у skills",
              },
              {
                requirement: "K8s",
                priority: "desired",
                status: "unknown",
                evidence: "Не згадується",
              },
            ],
          },
        ],
      });
    },
  };

  const offers = await ensureMatchScores(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.equal(completeCalls, 1);
  assert.equal(offers.length, 2);
  assert.ok(offers.some((item) => item.vacancyId === "v2"));
});

test("ensureMatchScores applies critical unmet cap via computeMatchScore", async () => {
  const vacancyConfirmedAt = confirmedAt;
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      vacancies: [
        {
          id: "v1",
          title: "Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            // Two critical items so rawScore stays above 69 when one is unmet,
            // and the critical-unmet cap clamps the stored score to 69.
            requirements: { critical: ["Rust", "Systems"], desired: ["Docker"] },
            culture: [],
            expectations: [],
            confirmedAt: vacancyConfirmedAt,
          },
        },
      ],
    }),
  );
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () =>
      JSON.stringify({
        results: [
          {
            vacancyId: "v1",
            contextFit: 100,
            assessments: [
              {
                requirement: "Rust",
                priority: "critical",
                status: "met",
                evidence: "Є Rust",
              },
              {
                requirement: "Systems",
                priority: "critical",
                status: "unmet",
                evidence: "Немає Systems",
              },
              {
                requirement: "Docker",
                priority: "desired",
                status: "met",
                evidence: "Є Docker",
              },
            ],
          },
        ],
      }),
  };

  const offers = await ensureMatchScores(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.equal(offers[0]?.matchScore, 69);
  assert.equal(fakePrisma.__matchScores[0]?.breakdown?.cappedByCriticalUnmet, true);
  assert.ok(fakePrisma.__matchScores[0]?.rankedForVacancyConfirmedAt);
});

test("getTopMatchOffers throws QUESTIONNAIRE_NOT_CONFIRMED when profile missing", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [], interviews: [], candidateProfiles: [] });
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      throw new Error("should not call LLM");
    },
  };

  await assert.rejects(
    () => getTopMatchOffers(fakePrisma as unknown as PrismaClient, fakeLlm, "cd_1"),
    (error: unknown) => {
      assert.ok(error instanceof VacancyMatchServiceError);
      assert.equal(error.code, "QUESTIONNAIRE_NOT_CONFIRMED");
      return true;
    },
  );
});

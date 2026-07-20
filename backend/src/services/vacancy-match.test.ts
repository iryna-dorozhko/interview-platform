import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import {
  ensureMatchScores,
  getNextMatchOffer,
  pickTopOffers,
  pickNextOffer,
  sortScoresDesc,
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

test("candidate offer payload has only vacancyId, title, matchScore", () => {
  const offer = { vacancyId: "v1", title: "Backend", matchScore: 88 };
  assert.deepEqual(Object.keys(offer).sort(), ["matchScore", "title", "vacancyId"]);
});

type FakeVacancy = {
  id: string;
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
  rankedForConfirmedAt: Date;
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
          companyProfile?: { confirmedAt?: { not: null } };
        };
        include?: { companyProfile?: boolean };
      }) => {
        return vacancies
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
        include?: { vacancy?: boolean };
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
          rankedForConfirmedAt: Date;
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

test("ensureMatchScores returns empty without calling LLM when no confirmed vacancies", async () => {
  const fakePrisma = makeFakePrisma(confirmedCandidateSeed());
  let completeCalls = 0;
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      return '{"scores":[]}';
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

test("getNextMatchOffer skips rejected vacancies", async () => {
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      vacancies: [
        {
          id: "v1",
          title: "Senior Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            requirements: {},
            culture: {},
            expectations: {},
            confirmedAt,
          },
        },
        {
          id: "v2",
          title: "Platform Engineer",
          status: "CONFIRMED",
          companyProfile: {
            role: "Platform",
            requirements: {},
            culture: {},
            expectations: {},
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
          rankedForConfirmedAt: confirmedAt,
        },
        {
          id: "s2",
          candidateUserId: "cd_1",
          vacancyId: "v2",
          matchScore: 80,
          rankedForConfirmedAt: confirmedAt,
        },
      ],
      offerDecisions: [{ candidateUserId: "cd_1", vacancyId: "v1", decision: "REJECTED" }],
    }),
  );
  let completeCalls = 0;
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      return '{"scores":[]}';
    },
  };

  const next = await getNextMatchOffer(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.deepEqual(next, { vacancyId: "v2", title: "Platform Engineer", matchScore: 80 });
  assert.equal(completeCalls, 0);
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
            requirements: { lang: "TS" },
            culture: { remote: true },
            expectations: { ownership: "high" },
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
          rankedForConfirmedAt: olderConfirmedAt,
        },
      ],
    }),
  );
  let completeCalls = 0;
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      completeCalls += 1;
      return JSON.stringify({ scores: [{ vacancyId: "v1", matchScore: 91 }] });
    },
  };

  const offers = await ensureMatchScores(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.equal(completeCalls, 1);
  assert.deepEqual(offers, [{ vacancyId: "v1", title: "Backend", matchScore: 91 }]);
  assert.equal(
    fakePrisma.__matchScores.some(
      (row) =>
        row.vacancyId === "v1" &&
        row.matchScore === 91 &&
        sameInstant(row.rankedForConfirmedAt, confirmedAt),
    ),
    true,
  );
});

test("getNextMatchOffer throws QUESTIONNAIRE_NOT_CONFIRMED when profile missing", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [], interviews: [], candidateProfiles: [] });
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      throw new Error("should not call LLM");
    },
  };

  await assert.rejects(
    () => getNextMatchOffer(fakePrisma as unknown as PrismaClient, fakeLlm, "cd_1"),
    (error: unknown) => {
      assert.ok(error instanceof VacancyMatchServiceError);
      assert.equal(error.code, "QUESTIONNAIRE_NOT_CONFIRMED");
      return true;
    },
  );
});

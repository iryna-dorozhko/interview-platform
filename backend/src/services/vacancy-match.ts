import type { PrismaClient } from "@prisma/client";
import {
  rankVacanciesWithLlm,
  type CandidateMatchInput,
  type VacancyMatchInput,
} from "../agents/vacancy-match-agent";
import type { LlmProvider } from "../llm/types";
import { getConfirmedQuestionnaireProfile } from "../utils/interview-readiness";
import {
  assertNonEmptyRequirements,
  normalizeVacancyRequirements,
} from "../utils/vacancy-requirements";
import {
  formatSalaryDisplay,
  formatWorkFormatDisplay,
} from "../utils/vacancy-work-conditions";
import { computeMatchScore, type MatchBreakdown } from "./match-score";

export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
  salaryDisplay: string | null;
  workFormatDisplay: string | null;
  companyName: string | null;
  /** Internal only — not exposed in candidate-facing serializers. */
  breakdown?: MatchBreakdown;
};

export type VacancyMatchErrorCode = "QUESTIONNAIRE_NOT_CONFIRMED" | "MATCH_UNAVAILABLE";

export class VacancyMatchServiceError extends Error {
  readonly code: VacancyMatchErrorCode;

  constructor(code: VacancyMatchErrorCode, message?: string) {
    super(message ?? code);
    this.name = "VacancyMatchServiceError";
    this.code = code;
  }
}

type MatchableVacancy = VacancyMatchInput & { confirmedAt: Date };

type OfferBase = {
  vacancyId: string;
  title: string;
  matchScore: number;
  companyName?: string | null;
  breakdown?: MatchBreakdown;
};

export function sortScoresDesc<T extends { matchScore: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.matchScore - a.matchScore);
}

export function pickNextOffer<T extends { vacancyId: string; matchScore: number }>(
  scores: T[],
  rejectedVacancyIds: Set<string>,
): T | null {
  const ordered = sortScoresDesc(scores);
  for (const item of ordered) {
    if (!rejectedVacancyIds.has(item.vacancyId)) return item;
  }
  return null;
}

export function pickTopOffers<T extends { vacancyId: string; matchScore: number }>(
  scores: T[],
  rejectedVacancyIds: Set<string>,
  limit = 5,
): T[] {
  const ordered = sortScoresDesc(scores);
  const result: T[] = [];
  for (const item of ordered) {
    if (rejectedVacancyIds.has(item.vacancyId)) continue;
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export function enrichOfferWithDisplays(
  base: OfferBase,
  profile: { workConditions: unknown; compensation: unknown } | null,
  companyName: string | null = base.companyName ?? null,
): CandidateMatchOffer {
  return {
    ...base,
    companyName,
    salaryDisplay: formatSalaryDisplay(profile?.compensation ?? null),
    workFormatDisplay: formatWorkFormatDisplay(profile?.workConditions ?? null),
  };
}

export async function attachDisplaysToOffers(
  prisma: PrismaClient,
  offers: OfferBase[],
): Promise<CandidateMatchOffer[]> {
  if (offers.length === 0) return [];

  const vacancyIds = offers.map((offer) => offer.vacancyId);
  const vacancies = await prisma.vacancy.findMany({
    where: { id: { in: vacancyIds } },
    include: {
      companyProfile: true,
      hrUser: { include: { hrCompanyProfile: true } },
    },
  });
  const vacancyById = new Map(vacancies.map((vacancy) => [vacancy.id, vacancy]));

  return offers.map((offer) => {
    const vacancy = vacancyById.get(offer.vacancyId);
    const companyProfile = vacancy?.companyProfile;
    return enrichOfferWithDisplays(
      offer,
      companyProfile
        ? {
            workConditions: companyProfile.workConditions,
            compensation: companyProfile.compensation,
          }
        : null,
      vacancy?.hrUser.hrCompanyProfile?.companyName ?? null,
    );
  });
}

export function toCandidateOfferPayload(offer: CandidateMatchOffer): CandidateMatchOffer {
  return {
    vacancyId: offer.vacancyId,
    title: offer.title,
    matchScore: offer.matchScore,
    salaryDisplay: offer.salaryDisplay,
    workFormatDisplay: offer.workFormatDisplay,
    companyName: offer.companyName,
  };
}

export async function getConfirmedCandidateProfile(
  prisma: PrismaClient,
  candidateUserId: string,
): Promise<(CandidateMatchInput & { confirmedAt: Date }) | null> {
  const profile = await getConfirmedQuestionnaireProfile(prisma, candidateUserId);
  if (!profile || profile.confirmedAt == null) return null;

  return {
    fullName: profile.fullName,
    email: profile.email,
    experience: profile.experience,
    skills: profile.skills,
    goals: profile.goals,
    summary: profile.summary,
    confirmedAt: profile.confirmedAt,
  };
}

export async function listMatchableVacancies(prisma: PrismaClient): Promise<MatchableVacancy[]> {
  const vacancies = await prisma.vacancy.findMany({
    where: {
      status: "CONFIRMED",
      hiddenAt: null,
      companyProfile: { confirmedAt: { not: null } },
    },
    include: { companyProfile: true },
  });

  const result: MatchableVacancy[] = [];
  for (const vacancy of vacancies) {
    if (!vacancy.companyProfile || vacancy.companyProfile.confirmedAt == null) continue;
    const requirements = normalizeVacancyRequirements(vacancy.companyProfile.requirements);
    if (!requirements || !assertNonEmptyRequirements(requirements)) continue;
    result.push({
      vacancyId: vacancy.id,
      title: vacancy.title,
      role: vacancy.companyProfile.role,
      requirements,
      culture: vacancy.companyProfile.culture,
      expectations: vacancy.companyProfile.expectations,
      confirmedAt: vacancy.companyProfile.confirmedAt,
    });
  }
  return result;
}

export async function getRejectedVacancyIds(
  prisma: PrismaClient,
  candidateUserId: string,
): Promise<Set<string>> {
  const decisions = await prisma.vacancyOfferDecision.findMany({
    where: { candidateUserId, decision: "REJECTED" },
  });
  return new Set(decisions.map((item) => item.vacancyId));
}

function sameInstant(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function toVacancyMatchInput(vacancy: MatchableVacancy): VacancyMatchInput {
  return {
    vacancyId: vacancy.vacancyId,
    title: vacancy.title,
    role: vacancy.role,
    requirements: vacancy.requirements,
    culture: vacancy.culture,
    expectations: vacancy.expectations,
  };
}

function toOffersFromCachedScores(
  scores: Array<{
    vacancyId: string;
    matchScore: number;
    breakdown?: unknown;
    vacancy: { title: string } | null;
  }>,
): OfferBase[] {
  const offers: OfferBase[] = [];
  for (const score of scores) {
    if (!score.vacancy) continue;
    offers.push({
      vacancyId: score.vacancyId,
      title: score.vacancy.title,
      matchScore: score.matchScore,
      ...(score.breakdown != null ? { breakdown: score.breakdown as MatchBreakdown } : {}),
    });
  }
  return offers;
}

export async function ensureMatchScores(
  prisma: PrismaClient,
  llm: LlmProvider,
  candidateUserId: string,
): Promise<CandidateMatchOffer[]> {
  const profile = await getConfirmedCandidateProfile(prisma, candidateUserId);
  if (!profile) {
    throw new VacancyMatchServiceError("QUESTIONNAIRE_NOT_CONFIRMED");
  }

  const vacancies = await listMatchableVacancies(prisma);
  if (vacancies.length === 0) return [];

  const cached = await prisma.vacancyMatchScore.findMany({
    where: {
      candidateUserId,
      rankedForConfirmedAt: profile.confirmedAt,
    },
    include: { vacancy: { include: { companyProfile: true } } },
  });

  const cachedHits: typeof cached = [];
  const toRank: MatchableVacancy[] = [];

  for (const vacancy of vacancies) {
    const hit = cached.find(
      (row) =>
        row.vacancyId === vacancy.vacancyId &&
        sameInstant(row.rankedForVacancyConfirmedAt, vacancy.confirmedAt),
    );
    if (hit) {
      cachedHits.push(hit);
    } else {
      toRank.push(vacancy);
    }
  }

  if (toRank.length === 0) {
    return attachDisplaysToOffers(prisma, toOffersFromCachedScores(cachedHits));
  }

  let ranked;
  try {
    ranked = await rankVacanciesWithLlm(llm, profile, toRank.map(toVacancyMatchInput));
  } catch {
    throw new VacancyMatchServiceError("MATCH_UNAVAILABLE");
  }

  const vacancyById = new Map(toRank.map((item) => [item.vacancyId, item]));
  const newOffers: OfferBase[] = [];
  const createData: Array<{
    candidateUserId: string;
    vacancyId: string;
    matchScore: number;
    breakdown: MatchBreakdown;
    rankedForConfirmedAt: Date;
    rankedForVacancyConfirmedAt: Date;
  }> = [];

  for (const item of ranked) {
    const vacancy = vacancyById.get(item.vacancyId);
    if (!vacancy) continue;
    const breakdown = computeMatchScore(item.assessments, item.contextFit);
    createData.push({
      candidateUserId,
      vacancyId: item.vacancyId,
      matchScore: breakdown.matchScore,
      breakdown,
      rankedForConfirmedAt: profile.confirmedAt,
      rankedForVacancyConfirmedAt: vacancy.confirmedAt,
    });
    newOffers.push({
      vacancyId: item.vacancyId,
      title: vacancy.title,
      matchScore: breakdown.matchScore,
      breakdown,
    });
  }

  if (createData.length > 0) {
    await prisma.vacancyMatchScore.createMany({ data: createData });
  }

  return attachDisplaysToOffers(prisma, [
    ...toOffersFromCachedScores(cachedHits),
    ...newOffers,
  ]);
}

export async function getTopMatchOffers(
  prisma: PrismaClient,
  llm: LlmProvider,
  candidateUserId: string,
): Promise<CandidateMatchOffer[]> {
  const offers = await ensureMatchScores(prisma, llm, candidateUserId);
  const rejected = await getRejectedVacancyIds(prisma, candidateUserId);
  return pickTopOffers(offers, rejected, 5);
}

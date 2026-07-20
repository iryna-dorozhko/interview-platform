import type { PrismaClient } from "@prisma/client";
import {
  rankVacanciesWithLlm,
  type CandidateMatchInput,
  type VacancyMatchInput,
} from "../agents/vacancy-match-agent";
import type { LlmProvider } from "../llm/types";
import { getConfirmedQuestionnaireProfile } from "../utils/interview-readiness";
import {
  formatSalaryDisplay,
  formatWorkFormatDisplay,
} from "../utils/vacancy-work-conditions";

export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
  salaryDisplay: string | null;
  workFormatDisplay: string | null;
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

export function sortScoresDesc<T extends { matchScore: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.matchScore - a.matchScore);
}

export function pickNextOffer(
  scores: CandidateMatchOffer[],
  rejectedVacancyIds: Set<string>,
): CandidateMatchOffer | null {
  const ordered = sortScoresDesc(scores);
  for (const item of ordered) {
    if (!rejectedVacancyIds.has(item.vacancyId)) return item;
  }
  return null;
}

export function pickTopOffers(
  scores: CandidateMatchOffer[],
  rejectedVacancyIds: Set<string>,
  limit = 5,
): CandidateMatchOffer[] {
  const ordered = sortScoresDesc(scores);
  const result: CandidateMatchOffer[] = [];
  for (const item of ordered) {
    if (rejectedVacancyIds.has(item.vacancyId)) continue;
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export function enrichOfferWithDisplays(
  base: { vacancyId: string; title: string; matchScore: number },
  profile: { workConditions: unknown; compensation: unknown } | null,
): CandidateMatchOffer {
  return {
    ...base,
    salaryDisplay: formatSalaryDisplay(profile?.compensation ?? null),
    workFormatDisplay: formatWorkFormatDisplay(profile?.workConditions ?? null),
  };
}

export async function attachDisplaysToOffers(
  prisma: PrismaClient,
  offers: Array<{ vacancyId: string; title: string; matchScore: number }>,
): Promise<CandidateMatchOffer[]> {
  if (offers.length === 0) return [];

  const vacancyIds = offers.map((offer) => offer.vacancyId);
  const vacancies = await prisma.vacancy.findMany({
    where: { id: { in: vacancyIds } },
    include: { companyProfile: true },
  });
  const profileByVacancyId = new Map(
    vacancies.map((vacancy) => [vacancy.id, vacancy.companyProfile]),
  );

  return offers.map((offer) => {
    const companyProfile = profileByVacancyId.get(offer.vacancyId);
    return enrichOfferWithDisplays(
      offer,
      companyProfile
        ? {
            workConditions: companyProfile.workConditions,
            compensation: companyProfile.compensation,
          }
        : null,
    );
  });
}

export function toCandidateOfferPayload(offer: CandidateMatchOffer): CandidateMatchOffer {
  return offer;
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

export async function listMatchableVacancies(prisma: PrismaClient): Promise<VacancyMatchInput[]> {
  const vacancies = await prisma.vacancy.findMany({
    where: {
      status: "CONFIRMED",
      companyProfile: { confirmedAt: { not: null } },
    },
    include: { companyProfile: true },
  });

  const result: VacancyMatchInput[] = [];
  for (const vacancy of vacancies) {
    if (!vacancy.companyProfile) continue;
    result.push({
      vacancyId: vacancy.id,
      title: vacancy.title,
      role: vacancy.companyProfile.role,
      requirements: vacancy.companyProfile.requirements,
      culture: vacancy.companyProfile.culture,
      expectations: vacancy.companyProfile.expectations,
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

function toOffersFromCachedScores(
  scores: Array<{
    vacancyId: string;
    matchScore: number;
    vacancy: { title: string } | null;
  }>,
): Array<{ vacancyId: string; title: string; matchScore: number }> {
  const offers: Array<{ vacancyId: string; title: string; matchScore: number }> = [];
  for (const score of scores) {
    if (!score.vacancy) continue;
    offers.push({
      vacancyId: score.vacancyId,
      title: score.vacancy.title,
      matchScore: score.matchScore,
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
  if (cached.length > 0) {
    return attachDisplaysToOffers(prisma, toOffersFromCachedScores(cached));
  }

  let ranked;
  try {
    ranked = await rankVacanciesWithLlm(llm, profile, vacancies);
  } catch {
    throw new VacancyMatchServiceError("MATCH_UNAVAILABLE");
  }

  const titleByVacancyId = new Map(vacancies.map((item) => [item.vacancyId, item.title]));
  const baseOffers: Array<{ vacancyId: string; title: string; matchScore: number }> = [];
  for (const item of ranked) {
    const title = titleByVacancyId.get(item.vacancyId);
    if (!title) continue;
    baseOffers.push({
      vacancyId: item.vacancyId,
      title,
      matchScore: item.matchScore,
    });
  }

  if (baseOffers.length > 0) {
    await prisma.vacancyMatchScore.createMany({
      data: baseOffers.map((offer) => ({
        candidateUserId,
        vacancyId: offer.vacancyId,
        matchScore: offer.matchScore,
        rankedForConfirmedAt: profile.confirmedAt,
      })),
    });
  }

  return attachDisplaysToOffers(prisma, baseOffers);
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

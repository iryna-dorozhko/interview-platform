export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
};

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

export function toCandidateOfferPayload(offer: CandidateMatchOffer): CandidateMatchOffer {
  return offer;
}

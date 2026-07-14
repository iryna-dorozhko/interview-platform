import type { CandidateInterview } from "../api/candidate-interview";

export const JOINED_BANNER_KEY = "candidate-joined-banner";

export function storeJoinedBanner(interview: CandidateInterview): void {
  sessionStorage.setItem(JOINED_BANNER_KEY, JSON.stringify(interview));
}

export function consumeJoinedBanner(): CandidateInterview | null {
  const stored = sessionStorage.getItem(JOINED_BANNER_KEY);
  if (!stored) return null;
  sessionStorage.removeItem(JOINED_BANNER_KEY);
  try {
    return JSON.parse(stored) as CandidateInterview;
  } catch {
    return null;
  }
}

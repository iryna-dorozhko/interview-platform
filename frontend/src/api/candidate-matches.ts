import { fetchWithAuth } from "./client";

export type CandidateMatchOffer = {
  vacancyId: string | null;
  title: string | null;
  matchScore: number | null;
};

export type ActiveApplication = {
  id: string;
  vacancyId: string;
  matchScore: number;
  status: "PENDING" | "CONVERTED" | "WITHDRAWN" | "DECLINED_BY_HR";
  vacancyTitle?: string;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore parse errors
  }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchActiveApplication(): Promise<ActiveApplication | null> {
  const response = await fetchWithAuth("/api/candidate/applications/active");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити заявку");
  }
  const body = (await response.json()) as { application: ActiveApplication | null };
  return body.application;
}

export async function fetchNextMatch(): Promise<CandidateMatchOffer> {
  const response = await fetchWithAuth("/api/candidate/matches/next");
  if (!response.ok) {
    if (response.status === 503) {
      throw await parseError(response, "Підбір тимчасово недоступний");
    }
    throw await parseError(response, "Не вдалося завантажити вакансію");
  }
  return response.json() as Promise<CandidateMatchOffer>;
}

export async function rejectMatch(vacancyId: string): Promise<CandidateMatchOffer> {
  const response = await fetchWithAuth(`/api/candidate/matches/${vacancyId}/reject`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 503) {
      throw await parseError(response, "Підбір тимчасово недоступний");
    }
    throw await parseError(response, "Не вдалося відхилити вакансію");
  }
  return response.json() as Promise<CandidateMatchOffer>;
}

export async function acceptMatch(
  vacancyId: string,
): Promise<{ application: ActiveApplication }> {
  const response = await fetchWithAuth(`/api/candidate/matches/${vacancyId}/accept`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 503) {
      throw await parseError(response, "Підбір тимчасово недоступний");
    }
    throw await parseError(response, "Не вдалося подати заявку");
  }
  return response.json() as Promise<{ application: ActiveApplication }>;
}

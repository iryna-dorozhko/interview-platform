import { ApiError, fetchWithAuth } from "./client";

export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
  salaryDisplay: string | null;
  workFormatDisplay: string | null;
  companyName: string | null;
};

export type CandidateMatchOffersResponse = {
  offers: CandidateMatchOffer[];
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

export function isQuestionnaireNotConfirmedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export async function fetchNextMatch(): Promise<CandidateMatchOffersResponse> {
  const response = await fetchWithAuth("/api/candidate/matches/next");
  if (!response.ok) {
    if (response.status === 403) {
      throw new ApiError("Questionnaire not confirmed", 403);
    }
    if (response.status === 503) {
      throw await parseError(response, "Підбір тимчасово недоступний");
    }
    throw await parseError(response, "Не вдалося завантажити вакансії");
  }
  return response.json() as Promise<CandidateMatchOffersResponse>;
}

export async function rejectMatch(vacancyId: string): Promise<CandidateMatchOffersResponse> {
  const response = await fetchWithAuth(`/api/candidate/matches/${vacancyId}/reject`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 503) {
      throw await parseError(response, "Підбір тимчасово недоступний");
    }
    throw await parseError(response, "Не вдалося відхилити вакансію");
  }
  return response.json() as Promise<CandidateMatchOffersResponse>;
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

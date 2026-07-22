import { fetchWithAuth } from "./client";

export type PrepAuthorType = "HUMAN_HR" | "AGENT_COMPANY";

export type PrepMessage = {
  id: string;
  authorType: PrepAuthorType;
  content: string;
  createdAt: string;
};

export type VacancyCompensation = {
  min?: number;
  max?: number;
  currency?: string;
  grossNet?: "gross" | "net";
  displayText: string;
};

export type VacancyRequirements = {
  critical: string[];
  desired: string[];
};

export type CompanyProfile = {
  role: string;
  requirements: VacancyRequirements;
  expectations: string[];
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
  workConditions: string[];
  compensation: VacancyCompensation | null;
  confirmedAt: string | null;
};

export type PrepState = {
  messages: PrepMessage[];
  isClosed: boolean;
  profile: CompanyProfile | null;
  missingCompanyProfile: boolean;
};

export type SendMessageResponse = {
  message: string;
  readyForConfirmation: boolean;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore parse errors
  }
  const detail = body.error ?? body.detail;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchPrepState(vacancyId: string): Promise<PrepState> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  return response.json() as Promise<PrepState>;
}

export async function sendPrepMessage(
  vacancyId: string,
  message?: string
): Promise<SendMessageResponse> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}/message`, {
    method: "POST",
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати повідомлення");
  }
  return response.json() as Promise<SendMessageResponse>;
}

export async function finishPrepChat(vacancyId: string): Promise<{ profile: CompanyProfile }> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}/finish`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити чат");
  }
  return response.json() as Promise<{ profile: CompanyProfile }>;
}

export async function confirmPrepProfile(
  vacancyId: string
): Promise<{ profile: CompanyProfile; vacancyStatus: string }> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}/confirm`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося підтвердити профіль");
  }
  return response.json() as Promise<{ profile: CompanyProfile; vacancyStatus: string }>;
}

export async function deletePrepChat(vacancyId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити чат");
  }
}

export async function updatePrepProfile(
  vacancyId: string,
  payload: Partial<Omit<CompanyProfile, "confirmedAt">>
): Promise<{ profile: CompanyProfile }> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося оновити профіль");
  }
  return response.json() as Promise<{ profile: CompanyProfile }>;
}

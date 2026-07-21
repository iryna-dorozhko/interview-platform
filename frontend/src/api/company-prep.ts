import { fetchWithAuth } from "./client";

export type CompanyPrepAuthorType = "HUMAN_HR" | "AGENT_COMPANY";

export type CompanyPrepMessage = {
  id: string;
  authorType: CompanyPrepAuthorType;
  content: string;
  createdAt: string;
};

export type HrCompanyProfile = {
  companyName: string | null;
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
  confirmedAt: string | null;
};

export type CompanyPrepState = {
  messages: CompanyPrepMessage[];
  isClosed: boolean;
  profile: HrCompanyProfile | null;
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
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchCompanyPrepState(): Promise<CompanyPrepState> {
  const response = await fetchWithAuth("/api/company-prep");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  return response.json() as Promise<CompanyPrepState>;
}

export async function sendCompanyPrepMessage(message?: string): Promise<SendMessageResponse> {
  const response = await fetchWithAuth("/api/company-prep/message", {
    method: "POST",
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати повідомлення");
  }
  return response.json() as Promise<SendMessageResponse>;
}

export async function finishCompanyPrepChat(): Promise<{ profile: HrCompanyProfile }> {
  const response = await fetchWithAuth("/api/company-prep/finish", { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити чат");
  }
  return response.json() as Promise<{ profile: HrCompanyProfile }>;
}

export async function confirmCompanyPrepProfile(): Promise<{ profile: HrCompanyProfile }> {
  const response = await fetchWithAuth("/api/company-prep/confirm", { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося підтвердити профіль");
  }
  return response.json() as Promise<{ profile: HrCompanyProfile }>;
}

export async function updateCompanyPrepProfile(
  payload: Partial<Omit<HrCompanyProfile, "confirmedAt">>
): Promise<{ profile: HrCompanyProfile }> {
  const response = await fetchWithAuth("/api/company-prep/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося зберегти профіль");
  }
  return response.json() as Promise<{ profile: HrCompanyProfile }>;
}

export async function deleteCompanyPrepChat(): Promise<void> {
  const response = await fetchWithAuth("/api/company-prep", { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити чат");
  }
}

import { fetchWithAuth } from "./client";

export type PrepAuthorType = "HUMAN_HR" | "AGENT_COMPANY";

export type PrepMessage = {
  id: string;
  authorType: PrepAuthorType;
  content: string;
  createdAt: string;
};

export type CompanyProfile = {
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
  confirmedAt: string | null;
};

export type PrepState = {
  messages: PrepMessage[];
  isClosed: boolean;
  profile: CompanyProfile | null;
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

export async function fetchPrepState(interviewId: string): Promise<PrepState> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  return response.json() as Promise<PrepState>;
}

export async function sendPrepMessage(
  interviewId: string,
  message?: string
): Promise<SendMessageResponse> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}/message`, {
    method: "POST",
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати повідомлення");
  }
  return response.json() as Promise<SendMessageResponse>;
}

export async function finishPrepChat(interviewId: string): Promise<{ profile: CompanyProfile }> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}/finish`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити чат");
  }
  return response.json() as Promise<{ profile: CompanyProfile }>;
}

export async function confirmPrepProfile(
  interviewId: string
): Promise<{ profile: CompanyProfile; interviewStatus: string }> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}/confirm`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося підтвердити профіль");
  }
  return response.json() as Promise<{ profile: CompanyProfile; interviewStatus: string }>;
}

export async function deletePrepChat(interviewId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити чат");
  }
}

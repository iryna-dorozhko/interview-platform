import { fetchWithAuth } from "./client";

export type CandidatePrepAuthorType = "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";

export type CandidatePrepMessage = {
  id: string;
  authorType: CandidatePrepAuthorType;
  content: string;
  createdAt: string;
};

export type CandidateSkills = {
  strong: string[];
  growth: string[];
};

export type CandidateProfile = {
  experience: string[];
  skills: CandidateSkills;
  goals: string[];
  summary: string;
  confirmedAt: string | null;
};

export type CandidatePrepState = {
  messages: CandidatePrepMessage[];
  isClosed: boolean;
  profile: CandidateProfile | null;
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

export async function fetchCandidatePrepState(interviewId: string): Promise<CandidatePrepState> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  return response.json() as Promise<CandidatePrepState>;
}

export async function sendCandidatePrepMessage(
  interviewId: string,
  message?: string
): Promise<SendMessageResponse> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}/message`, {
    method: "POST",
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати повідомлення");
  }
  return response.json() as Promise<SendMessageResponse>;
}

export async function deleteCandidatePrepChat(interviewId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити чат");
  }
}

export async function finishCandidatePrepChat(
  interviewId: string
): Promise<{ profile: CandidateProfile }> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}/finish`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити чат");
  }
  return response.json() as Promise<{ profile: CandidateProfile }>;
}

export async function confirmCandidatePrepProfile(
  interviewId: string
): Promise<{ profile: CandidateProfile; interviewStatus: string }> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}/confirm`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося підтвердити профіль");
  }
  return response.json() as Promise<{ profile: CandidateProfile; interviewStatus: string }>;
}

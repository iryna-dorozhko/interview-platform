import type { CandidateInterview } from "./candidate-interview";
import { fetchWithAuth } from "./client";

export type CandidateInvitation = {
  id: string;
  interviewId: string;
  displayName: string;
  scheduledAt: string | null;
  status: string;
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

function mapAcceptConflictError(body: ErrorBody): Error {
  const code = body.error;
  if (code === "Interview is not joinable") {
    return new Error("Співбесіду вже завершено або вона в ефірі");
  }
  if (code === "Candidate already has active interview") {
    return new Error("У вас уже є активна співбесіда");
  }
  if (code === "Candidate questionnaire required") {
    return new Error("Спочатку створіть анкету в розділі «Моя анкета»");
  }
  if (code === "Candidate questionnaire not confirmed") {
    return new Error("Спочатку підтвердіть анкету в розділі «Моя анкета»");
  }
  return new Error("Ця співбесіда вже зайнята іншим кандидатом");
}

export async function fetchMyInvitations(): Promise<CandidateInvitation[]> {
  const response = await fetchWithAuth("/api/candidate/invitations");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити запрошення");
  }
  const body = (await response.json()) as { invitations: CandidateInvitation[] };
  return body.invitations;
}

export async function acceptInvitation(id: string): Promise<CandidateInterview> {
  const response = await fetchWithAuth(`/api/candidate/invitations/${id}/accept`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Запрошення не знайдено");
    }
    if (response.status === 409) {
      let body: ErrorBody = {};
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        // ignore
      }
      throw mapAcceptConflictError(body);
    }
    throw await parseError(response, "Не вдалося прийняти запрошення");
  }
  const body = (await response.json()) as { interview: CandidateInterview };
  return body.interview;
}

export async function declineInvitation(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/candidate/invitations/${id}/decline`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Запрошення не знайдено");
    }
    throw await parseError(response, "Не вдалося відхилити запрошення");
  }
}

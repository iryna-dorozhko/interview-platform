import { fetchWithAuth } from "./client";

export type CandidateInterview = {
  id: string;
  displayName: string;
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

export async function fetchCandidateInterview(): Promise<CandidateInterview | null> {
  const response = await fetchWithAuth("/api/candidate/interview");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити співбесіду");
  }
  const body = (await response.json()) as { interview: CandidateInterview | null };
  return body.interview;
}

export async function fetchCandidateQuestionnaire(): Promise<CandidateInterview | null> {
  const response = await fetchWithAuth("/api/candidate/questionnaire");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  const body = (await response.json()) as { interview: CandidateInterview | null };
  return body.interview;
}

export async function startCandidateQuestionnaire(): Promise<CandidateInterview> {
  const response = await fetchWithAuth("/api/candidate/interview/start", {
    method: "POST",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося створити анкету");
  }
  const body = (await response.json()) as { interview: CandidateInterview };
  return body.interview;
}

export async function joinInterviewByCode(joinCode: string): Promise<CandidateInterview> {
  const response = await fetchWithAuth("/api/candidate/interview/join", {
    method: "POST",
    body: JSON.stringify({ joinCode: joinCode.trim() }),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Невірний код співбесіди");
    }
    if (response.status === 409) {
      let body: ErrorBody = {};
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        // ignore
      }
      const code = body.error;
      if (code === "Interview is not joinable") {
        throw new Error("Співбесіду вже завершено або вона в ефірі");
      }
      if (code === "Candidate already has active interview") {
        throw new Error("У вас уже є активна співбесіда");
      }
      if (code === "Candidate questionnaire required") {
        throw new Error("Спочатку створіть анкету в розділі «Моя анкета»");
      }
      if (code === "Candidate questionnaire not confirmed") {
        throw new Error("Спочатку підтвердіть анкету в розділі «Моя анкета»");
      }
      throw new Error("Ця співбесіда вже зайнята іншим кандидатом");
    }
    throw await parseError(response, "Не вдалося приєднатися до співбесіди");
  }
  const body = (await response.json()) as { interview: CandidateInterview };
  return body.interview;
}

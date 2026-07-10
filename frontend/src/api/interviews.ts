import { fetchWithAuth } from "./client";

export type InterviewSummary = {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: string;
  reportSummary: string | null;
};

export type InterviewDetail = InterviewSummary;

export type CreatedInterview = {
  id: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: string;
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

export async function fetchInterview(id: string): Promise<InterviewDetail> {
  const response = await fetchWithAuth(`/api/interviews/${id}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити співбесіду");
  }
  const body = (await response.json()) as { interview: InterviewDetail };
  return body.interview;
}

export async function fetchMyInterviews(): Promise<InterviewSummary[]> {
  const response = await fetchWithAuth("/api/interviews/mine");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити список співбесід");
  }
  const body = (await response.json()) as { interviews: InterviewSummary[] };
  return body.interviews;
}

export async function createInterview(vacancyId: string): Promise<CreatedInterview> {
  const response = await fetchWithAuth("/api/interviews", {
    method: "POST",
    body: JSON.stringify({ vacancyId }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося створити співбесіду");
  }
  const body = (await response.json()) as { interview: CreatedInterview };
  return body.interview;
}

export async function deleteInterview(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/interviews/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити співбесіду");
  }
}

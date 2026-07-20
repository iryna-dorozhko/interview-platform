import { fetchWithAuth } from "./client";

export type InterviewInvitation = {
  id: string;
  email: string;
  status: string;
};

export type InterviewSummary = {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  invitation: InterviewInvitation | null;
  candidateLinked: boolean;
  reportId: string | null;
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
  scheduledAt: string | null;
  invitation: InterviewInvitation | null;
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

export async function createInterview(
  vacancyId: string,
  options?: { candidateEmail?: string; scheduledAt?: string | null },
): Promise<CreatedInterview> {
  const response = await fetchWithAuth("/api/interviews", {
    method: "POST",
    body: JSON.stringify({
      vacancyId,
      ...(options?.candidateEmail ? { candidateEmail: options.candidateEmail } : {}),
      ...(options?.scheduledAt !== undefined ? { scheduledAt: options.scheduledAt } : {}),
    }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося створити співбесіду");
  }
  const body = (await response.json()) as { interview: CreatedInterview };
  return body.interview;
}

export async function updateInterviewSchedule(
  id: string,
  scheduledAt: string | null,
): Promise<InterviewDetail> {
  const response = await fetchWithAuth(`/api/interviews/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledAt }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося оновити час співбесіди");
  }
  const body = (await response.json()) as { interview: InterviewDetail };
  return body.interview;
}

export async function updateInterviewInvitation(
  id: string,
  candidateEmail: string | null,
): Promise<{ invitation: InterviewInvitation | null }> {
  const response = await fetchWithAuth(`/api/interviews/${id}/invitation`, {
    method: "PATCH",
    body: JSON.stringify({ candidateEmail }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося оновити запрошення");
  }
  return (await response.json()) as { invitation: InterviewInvitation | null };
}

export async function deleteInterview(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/interviews/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити співбесіду");
  }
}

export type EndInterviewResult = {
  reportId: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
};

export async function endInterview(id: string): Promise<EndInterviewResult> {
  const response = await fetchWithAuth(`/api/interviews/${id}/end`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити співбесіду");
  }
  const body = (await response.json()) as {
    report: { id: string; recommendation: EndInterviewResult["recommendation"]; matchScore: number };
  };
  return {
    reportId: body.report.id,
    recommendation: body.report.recommendation,
    matchScore: body.report.matchScore,
  };
}

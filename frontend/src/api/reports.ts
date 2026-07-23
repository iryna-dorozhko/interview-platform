import { fetchWithAuth } from "./client";

export type InterviewDecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

export type LatestDecision = {
  id: string;
  type: InterviewDecisionType;
  createdAt: string;
};

export type RecommendationOverrideKind =
  | "culture_fit"
  | "soft_skills"
  | "critical_gap_ok"
  | "red_flag"
  | "other";

export type FinalReport = {
  id: string;
  interviewId: string;
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
  overrideKind: RecommendationOverrideKind | null;
  overrideReason: string | null;
  createdAt: string;
  latestDecision: LatestDecision | null;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore
  }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export type ReportSummary = {
  id: string;
  interviewId: string;
  candidateEmail: string | null;
  vacancyId: string;
  vacancyTitle: string;
  matchScore: number;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  createdAt: string;
};

export type ReportListFilters = {
  vacancyId?: string;
  recommendation?: "HIRE" | "MAYBE" | "REJECT";
  email?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function fetchReport(id: string): Promise<FinalReport> {
  const response = await fetchWithAuth(`/api/reports/${id}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити звіт");
  }
  const body = (await response.json()) as { report: FinalReport };
  return body.report;
}

export async function fetchReports(
  filters: ReportListFilters = {},
): Promise<ReportSummary[]> {
  const params = new URLSearchParams();
  if (filters.vacancyId) params.set("vacancyId", filters.vacancyId);
  if (filters.recommendation) params.set("recommendation", filters.recommendation);
  if (filters.email) params.set("email", filters.email);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString();
  const response = await fetchWithAuth(`/api/reports${qs ? `?${qs}` : ""}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити список звітів");
  }
  const body = (await response.json()) as { reports: ReportSummary[] };
  return body.reports;
}

export async function draftDecisionLetter(
  reportId: string,
  type: InterviewDecisionType,
): Promise<{ type: InterviewDecisionType; body: string }> {
  const response = await fetchWithAuth(`/api/reports/${reportId}/decisions/draft`, {
    method: "POST",
    body: JSON.stringify({ type }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося згенерувати лист");
  }
  return (await response.json()) as { type: InterviewDecisionType; body: string };
}

export async function sendDecision(
  reportId: string,
  type: InterviewDecisionType,
  letterBody: string,
): Promise<{ decision: LatestDecision; dialogId: string }> {
  const response = await fetchWithAuth(`/api/reports/${reportId}/decisions`, {
    method: "POST",
    body: JSON.stringify({ type, letterBody }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати рішення");
  }
  return (await response.json()) as {
    decision: LatestDecision;
    dialogId: string;
  };
}

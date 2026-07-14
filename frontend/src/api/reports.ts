import { fetchWithAuth } from "./client";

export type FinalReport = {
  id: string;
  interviewId: string;
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
  createdAt: string;
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

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

export async function fetchReport(id: string): Promise<FinalReport> {
  const response = await fetchWithAuth(`/api/reports/${id}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити звіт");
  }
  const body = (await response.json()) as { report: FinalReport };
  return body.report;
}

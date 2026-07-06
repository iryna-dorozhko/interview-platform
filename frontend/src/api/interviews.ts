import { fetchWithAuth } from "./client";

export type InterviewSummary = {
  id: string;
  joinCode: string;
  status: string;
};

export async function fetchMyInterviews(): Promise<InterviewSummary[]> {
  const response = await fetchWithAuth("/api/interviews/mine");
  if (!response.ok) {
    throw new Error("Не вдалося завантажити список співбесід");
  }
  const body = (await response.json()) as { interviews: InterviewSummary[] };
  return body.interviews;
}

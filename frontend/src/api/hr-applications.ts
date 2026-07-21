import { fetchWithAuth } from "./client";
import type { CreatedInterview } from "./interviews";

export type HrNotification = {
  id: string;
  type: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
};

export type HrApplicationSummary = {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  matchScore: number;
  candidateSummary: string;
  status: string;
  interviewId: string | null;
  createdAt: string;
};

export type RequirementAssessment = {
  requirement: string;
  priority: "critical" | "desired";
  status: "met" | "unknown" | "unmet";
  evidence: string;
};

export type MatchBreakdown = {
  assessments: RequirementAssessment[];
  contextFit: number;
  criticalFit: number | null;
  desiredFit: number | null;
  requirementsFit: number | null;
  rawScore: number;
  cappedByCriticalUnmet: boolean;
  matchScore: number;
};

export type HrApplicationDetail = HrApplicationSummary & {
  candidate: {
    fullName: string | null;
    email: string | null;
  };
  /** Full snapshot, `null`, or legacy empty `{}` from older applications. */
  matchBreakdown: MatchBreakdown | Record<string, never> | null;
};

export type CreateInterviewFromApplicationResult = {
  interview: CreatedInterview;
  application: {
    id: string;
    status: string;
    interviewId: string | null;
  };
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

export async function fetchHrNotifications(): Promise<HrNotification[]> {
  const response = await fetchWithAuth("/api/hr/notifications");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити сповіщення");
  }
  const body = (await response.json()) as { notifications: HrNotification[] };
  return body.notifications;
}

export async function markNotificationRead(id: string): Promise<HrNotification> {
  const response = await fetchWithAuth(`/api/hr/notifications/${id}/read`, {
    method: "POST",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося позначити сповіщення прочитаним");
  }
  const body = (await response.json()) as { notification: HrNotification };
  return body.notification;
}

export async function fetchHrApplications(): Promise<HrApplicationSummary[]> {
  const response = await fetchWithAuth("/api/hr/applications");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити заявки");
  }
  const body = (await response.json()) as { applications: HrApplicationSummary[] };
  return body.applications;
}

export async function fetchHrApplication(id: string): Promise<HrApplicationDetail> {
  const response = await fetchWithAuth(`/api/hr/applications/${id}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити заявку");
  }
  const body = (await response.json()) as { application: HrApplicationDetail };
  return body.application;
}

export async function createInterviewFromApplication(
  id: string,
  options?: { scheduledAt?: string | null },
): Promise<CreateInterviewFromApplicationResult> {
  const response = await fetchWithAuth(`/api/hr/applications/${id}/create-interview`, {
    method: "POST",
    body: JSON.stringify({
      ...(options?.scheduledAt !== undefined ? { scheduledAt: options.scheduledAt } : {}),
    }),
  });
  if (!response.ok) {
    if (response.status === 409) {
      let body: ErrorBody = {};
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        // ignore parse errors
      }
      if (body.error === "Candidate already has active interview") {
        throw new Error("У кандидата вже є активна співбесіда");
      }
      if (body.error === "Application is not pending") {
        throw new Error("Заявка вже оброблена");
      }
    }
    throw await parseError(response, "Не вдалося створити співбесіду з заявки");
  }
  return (await response.json()) as CreateInterviewFromApplicationResult;
}

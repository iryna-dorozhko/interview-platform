import { fetchWithAuth } from "./client";
import type { CompanyProfile } from "./prep";

export type VacancySummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  hiddenAt: string | null;
};

export type VacancyDetail = VacancySummary & {
  profile: CompanyProfile | null;
};

type ErrorBody = { error?: string; detail?: string; message?: string };

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

export async function fetchMyVacancies(
  visibility: "active" | "hidden" = "active",
): Promise<VacancySummary[]> {
  const params = new URLSearchParams({ visibility });
  const response = await fetchWithAuth(`/api/vacancies/mine?${params}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити список анкет");
  }
  const body = (await response.json()) as { vacancies: VacancySummary[] };
  return body.vacancies;
}

export async function fetchVacancy(id: string): Promise<VacancyDetail> {
  const response = await fetchWithAuth(`/api/vacancies/${id}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  const body = (await response.json()) as { vacancy: VacancyDetail };
  return body.vacancy;
}

export async function createVacancy(title: string): Promise<VacancySummary> {
  const response = await fetchWithAuth("/api/vacancies", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося створити анкету");
  }
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}

export async function updateVacancyTitle(id: string, title: string): Promise<VacancySummary> {
  const response = await fetchWithAuth(`/api/vacancies/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося оновити анкету");
  }
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}

export async function hideVacancy(id: string): Promise<VacancySummary> {
  const response = await fetchWithAuth(`/api/vacancies/${id}/hide`, { method: "POST" });
  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // ignore
    }
    if (response.status === 409 && body.error === "ACTIVE_INTERVIEWS_EXIST") {
      throw new Error(body.message ?? "Неможливо сховати: є активні співбесіди");
    }
    throw await parseError(response, "Не вдалося сховати вакансію");
  }
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}

export async function unhideVacancy(id: string): Promise<VacancySummary> {
  const response = await fetchWithAuth(`/api/vacancies/${id}/unhide`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося показати вакансію");
  }
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}

export async function deleteVacancy(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/vacancies/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити анкету");
  }
}

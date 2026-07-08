import { fetchWithAuth } from "./client";

export type VacancySummary = {
  id: string;
  title: string;
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

export async function fetchMyVacancies(): Promise<VacancySummary[]> {
  const response = await fetchWithAuth("/api/vacancies/mine");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити список анкет");
  }
  const body = (await response.json()) as { vacancies: VacancySummary[] };
  return body.vacancies;
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

export async function deleteVacancy(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/vacancies/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити анкету");
  }
}

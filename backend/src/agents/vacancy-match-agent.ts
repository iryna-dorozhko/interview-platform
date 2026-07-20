import type { ChatMessage, LlmProvider } from "../llm/types";
import {
  CANDIDATE_SUMMARY_SYSTEM_PROMPT_UK,
  VACANCY_MATCH_SYSTEM_PROMPT_UK,
} from "./prompts/vacancy-match.uk";

export type VacancyMatchInput = {
  vacancyId: string;
  title: string;
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
};

export type CandidateMatchInput = {
  fullName: string;
  email: string;
  experience: unknown;
  skills: unknown;
  goals: unknown;
  summary: string;
};

export type VacancyMatchScoreResult = {
  vacancyId: string;
  matchScore: number;
};

export class VacancyMatchExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VacancyMatchExtractionError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function parseVacancyMatchScores(
  rawText: string,
  allowedVacancyIds: Set<string>,
): VacancyMatchScoreResult[] {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new VacancyMatchExtractionError("LLM returned invalid JSON for vacancy match scores");
  }

  if (typeof data !== "object" || data === null) {
    throw new VacancyMatchExtractionError("LLM response is not a JSON object");
  }

  const { scores } = data as Record<string, unknown>;
  if (!Array.isArray(scores)) {
    throw new VacancyMatchExtractionError("missing or invalid field: scores");
  }

  const results: VacancyMatchScoreResult[] = [];
  const seen = new Set<string>();

  for (const item of scores) {
    if (typeof item !== "object" || item === null) continue;
    const { vacancyId, matchScore } = item as Record<string, unknown>;
    if (typeof vacancyId !== "string" || !allowedVacancyIds.has(vacancyId)) continue;
    if (typeof matchScore !== "number" || !Number.isFinite(matchScore)) continue;
    if (seen.has(vacancyId)) continue;
    seen.add(vacancyId);
    results.push({ vacancyId, matchScore: clampScore(matchScore) });
  }

  return results;
}

export function buildVacancyMatchMessages(
  candidate: CandidateMatchInput,
  vacancies: VacancyMatchInput[],
): ChatMessage[] {
  const userContent = [
    "=== ПРОФІЛЬ КАНДИДАТА (JSON) ===",
    JSON.stringify(candidate, null, 2),
    "",
    "=== ВАКАНСІЇ (JSON) ===",
    JSON.stringify(vacancies, null, 2),
  ].join("\n");

  return [
    { role: "system", content: VACANCY_MATCH_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}

export async function rankVacanciesWithLlm(
  provider: LlmProvider,
  candidate: CandidateMatchInput,
  vacancies: VacancyMatchInput[],
): Promise<VacancyMatchScoreResult[]> {
  if (vacancies.length === 0) return [];

  const messages = buildVacancyMatchMessages(candidate, vacancies);
  const rawText = await provider.complete(messages);
  const allowedVacancyIds = new Set(vacancies.map((v) => v.vacancyId));
  return parseVacancyMatchScores(rawText, allowedVacancyIds);
}

export function buildCandidateSummaryMessages(
  candidate: CandidateMatchInput,
  vacancyTitle: string,
): ChatMessage[] {
  const userContent = [
    `=== ВАКАНСІЯ ===`,
    vacancyTitle,
    "",
    "=== ПРОФІЛЬ КАНДИДАТА (JSON) ===",
    JSON.stringify(candidate, null, 2),
  ].join("\n");

  return [
    { role: "system", content: CANDIDATE_SUMMARY_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}

export function parseCandidateSummary(rawText: string): string {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new VacancyMatchExtractionError("LLM returned invalid JSON for candidate summary");
  }

  if (typeof data !== "object" || data === null) {
    throw new VacancyMatchExtractionError("LLM response is not a JSON object");
  }

  const { summary } = data as Record<string, unknown>;
  if (typeof summary !== "string" || !summary.trim()) {
    throw new VacancyMatchExtractionError("missing or invalid field: summary");
  }

  return summary.trim();
}

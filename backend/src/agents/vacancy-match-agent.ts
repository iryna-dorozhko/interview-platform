import type { ChatMessage, LlmProvider } from "../llm/types";
import type { RequirementAssessment, RequirementStatus } from "../services/match-score";
import type { VacancyRequirements } from "../utils/vacancy-requirements";
import {
  CANDIDATE_SUMMARY_SYSTEM_PROMPT_UK,
  VACANCY_MATCH_SYSTEM_PROMPT_UK,
} from "./prompts/vacancy-match.uk";

export type VacancyMatchInput = {
  vacancyId: string;
  title: string;
  role: string;
  requirements: VacancyRequirements;
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

export type VacancyMatchAssessmentResult = {
  vacancyId: string;
  assessments: RequirementAssessment[];
  contextFit: number;
};

export class VacancyMatchExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VacancyMatchExtractionError";
  }
}

const VALID_STATUSES = new Set<RequirementStatus>(["met", "unknown", "unmet"]);

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function expectedRequirements(requirements: VacancyRequirements): Map<string, "critical" | "desired"> {
  const map = new Map<string, "critical" | "desired">();
  for (const requirement of requirements.critical) {
    map.set(requirement, "critical");
  }
  for (const requirement of requirements.desired) {
    map.set(requirement, "desired");
  }
  return map;
}

function parseAssessmentItem(item: unknown): RequirementAssessment {
  if (typeof item !== "object" || item === null) {
    throw new VacancyMatchExtractionError("invalid assessment item");
  }

  const { requirement, priority, status, evidence } = item as Record<string, unknown>;

  if (typeof requirement !== "string" || !requirement) {
    throw new VacancyMatchExtractionError("missing or invalid field: requirement");
  }
  if (priority !== "critical" && priority !== "desired") {
    throw new VacancyMatchExtractionError("missing or invalid field: priority");
  }
  if (typeof status !== "string" || !VALID_STATUSES.has(status as RequirementStatus)) {
    throw new VacancyMatchExtractionError("missing or invalid field: status");
  }
  if (typeof evidence !== "string" || !evidence.trim()) {
    throw new VacancyMatchExtractionError("missing or invalid field: evidence");
  }

  return {
    requirement,
    priority,
    status: status as RequirementStatus,
    evidence: evidence.trim(),
  };
}

function parseVacancyResultItem(item: unknown): {
  vacancyId: string;
  contextFit: number;
  assessments: RequirementAssessment[];
} {
  if (typeof item !== "object" || item === null) {
    throw new VacancyMatchExtractionError("invalid vacancy result item");
  }

  const { vacancyId, contextFit, assessments } = item as Record<string, unknown>;

  if (typeof vacancyId !== "string" || !vacancyId) {
    throw new VacancyMatchExtractionError("missing or invalid field: vacancyId");
  }
  if (typeof contextFit !== "number" || !Number.isFinite(contextFit)) {
    throw new VacancyMatchExtractionError("missing or invalid field: contextFit");
  }
  if (!Array.isArray(assessments)) {
    throw new VacancyMatchExtractionError("missing or invalid field: assessments");
  }

  return {
    vacancyId,
    contextFit,
    assessments: assessments.map(parseAssessmentItem),
  };
}

export function parseVacancyMatchAssessments(
  rawText: string,
  vacancies: VacancyMatchInput[],
): VacancyMatchAssessmentResult[] {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new VacancyMatchExtractionError("LLM returned invalid JSON for vacancy match assessments");
  }

  if (typeof data !== "object" || data === null) {
    throw new VacancyMatchExtractionError("LLM response is not a JSON object");
  }

  const { results } = data as Record<string, unknown>;
  if (!Array.isArray(results)) {
    throw new VacancyMatchExtractionError("missing or invalid field: results");
  }

  const vacancyById = new Map(vacancies.map((vacancy) => [vacancy.vacancyId, vacancy]));
  const resultsByVacancyId = new Map<string, ReturnType<typeof parseVacancyResultItem>>();

  for (const item of results) {
    const parsed = parseVacancyResultItem(item);
    if (!vacancyById.has(parsed.vacancyId)) {
      throw new VacancyMatchExtractionError(`unexpected vacancyId: ${parsed.vacancyId}`);
    }
    if (resultsByVacancyId.has(parsed.vacancyId)) {
      throw new VacancyMatchExtractionError(`duplicate vacancyId: ${parsed.vacancyId}`);
    }
    resultsByVacancyId.set(parsed.vacancyId, parsed);
  }

  const output: VacancyMatchAssessmentResult[] = [];

  for (const vacancy of vacancies) {
    const result = resultsByVacancyId.get(vacancy.vacancyId);
    if (!result) {
      throw new VacancyMatchExtractionError(`missing result for vacancyId: ${vacancy.vacancyId}`);
    }

    const expected = expectedRequirements(vacancy.requirements);
    const seen = new Set<string>();
    const validatedAssessments: RequirementAssessment[] = [];

    for (const assessment of result.assessments) {
      const expectedPriority = expected.get(assessment.requirement);
      if (!expectedPriority) {
        throw new VacancyMatchExtractionError(`unexpected requirement: ${assessment.requirement}`);
      }
      if (seen.has(assessment.requirement)) {
        throw new VacancyMatchExtractionError(`duplicate requirement: ${assessment.requirement}`);
      }
      if (assessment.priority !== expectedPriority) {
        throw new VacancyMatchExtractionError(
          `priority mismatch for requirement: ${assessment.requirement}`,
        );
      }
      seen.add(assessment.requirement);
      validatedAssessments.push(assessment);
    }

    if (seen.size !== expected.size) {
      throw new VacancyMatchExtractionError(
        `incomplete assessments for vacancyId: ${vacancy.vacancyId}`,
      );
    }

    output.push({
      vacancyId: vacancy.vacancyId,
      assessments: validatedAssessments,
      contextFit: result.contextFit,
    });
  }

  return output;
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
): Promise<VacancyMatchAssessmentResult[]> {
  if (vacancies.length === 0) return [];

  const messages = buildVacancyMatchMessages(candidate, vacancies);
  const rawText = await provider.complete(messages);
  return parseVacancyMatchAssessments(rawText, vacancies);
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

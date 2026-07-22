import type { CandidateConfidence, LiveAuthorType } from "@prisma/client";
import type { ChatMessage } from "../llm/types";
import type { RequirementAssessment, RequirementStatus } from "../services/match-score";
import { computeMatchScore } from "../services/match-score";
import type { VacancyRequirements } from "../utils/vacancy-requirements";
import { FINAL_REPORT_SYSTEM_PROMPT_UK } from "./prompts/final-report.uk";

export type LiveTranscriptItem = {
  authorType: LiveAuthorType;
  content: string;
  candidateConfidence?: CandidateConfidence | null;
};

export type ExtractedFinalReport = {
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
};

export class FinalReportExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalReportExtractionError";
  }
}

const AUTHOR_LABELS: Record<LiveAuthorType, string> = {
  HUMAN_HR: "HR",
  HUMAN_CANDIDATE: "Кандидат",
  AGENT_ARBITER: "Arbiter",
  AGENT_COMPANY: "Компанія",
  AGENT_CANDIDATE: "Кандидат (AI)",
};

const VALID_RECOMMENDATIONS = new Set(["HIRE", "MAYBE", "REJECT"]);
const VALID_STATUSES = new Set<RequirementStatus>(["met", "unknown", "unmet"]);

function expectedRequirements(
  requirements: VacancyRequirements,
): Map<string, "critical" | "desired"> {
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
    throw new FinalReportExtractionError("invalid assessment item");
  }
  const { requirement, priority, status, evidence } = item as Record<string, unknown>;
  if (typeof requirement !== "string" || !requirement) {
    throw new FinalReportExtractionError("missing or invalid field: requirement");
  }
  if (priority !== "critical" && priority !== "desired") {
    throw new FinalReportExtractionError("missing or invalid field: priority");
  }
  if (typeof status !== "string" || !VALID_STATUSES.has(status as RequirementStatus)) {
    throw new FinalReportExtractionError("missing or invalid field: status");
  }
  if (typeof evidence !== "string" || !evidence.trim()) {
    throw new FinalReportExtractionError("missing or invalid field: evidence");
  }
  return {
    requirement,
    priority,
    status: status as RequirementStatus,
    evidence: evidence.trim(),
  };
}

function validateAssessments(
  assessments: unknown,
  requirements: VacancyRequirements,
): RequirementAssessment[] {
  if (!Array.isArray(assessments)) {
    throw new FinalReportExtractionError("missing or invalid field: assessments");
  }
  const expected = expectedRequirements(requirements);
  const seen = new Set<string>();
  const validated: RequirementAssessment[] = [];
  for (const item of assessments) {
    const assessment = parseAssessmentItem(item);
    const expectedPriority = expected.get(assessment.requirement);
    if (!expectedPriority) {
      throw new FinalReportExtractionError(`unexpected requirement: ${assessment.requirement}`);
    }
    if (seen.has(assessment.requirement)) {
      throw new FinalReportExtractionError(`duplicate requirement: ${assessment.requirement}`);
    }
    if (assessment.priority !== expectedPriority) {
      throw new FinalReportExtractionError(
        `priority mismatch for requirement: ${assessment.requirement}`,
      );
    }
    seen.add(assessment.requirement);
    validated.push(assessment);
  }
  if (seen.size !== expected.size) {
    throw new FinalReportExtractionError("incomplete assessments");
  }
  return validated;
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FinalReportExtractionError(`missing or invalid field: ${field}`);
  }
  return value.map((item) => String(item));
}

const CONFIDENCE_LABELS: Record<string, string> = {
  CONFIRMED: "confirmed",
  INFERRED: "inferred",
  UNKNOWN: "unknown",
};

function formatAuthorLabel(item: LiveTranscriptItem): string {
  const base = AUTHOR_LABELS[item.authorType];
  if (
    item.authorType === "AGENT_CANDIDATE" &&
    item.candidateConfidence &&
    CONFIDENCE_LABELS[item.candidateConfidence]
  ) {
    return `${base} · ${CONFIDENCE_LABELS[item.candidateConfidence]}`;
  }
  return base;
}

export function formatLiveTranscript(messages: LiveTranscriptItem[]): string {
  if (messages.length === 0) return "(розмова порожня)";
  return messages
    .map((item) => `[${formatAuthorLabel(item)}] ${item.content}`)
    .join("\n");
}

export function parseFinalReport(
  rawText: string,
  requirements: VacancyRequirements,
): ExtractedFinalReport {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new FinalReportExtractionError("LLM returned invalid JSON for final report");
  }

  if (typeof data !== "object" || data === null) {
    throw new FinalReportExtractionError("LLM response is not a JSON object");
  }

  const { reportMarkdown, recommendation, contextFit, assessments, strengths, risks } =
    data as Record<string, unknown>;

  if (typeof reportMarkdown !== "string" || !reportMarkdown.trim()) {
    throw new FinalReportExtractionError("missing or invalid field: reportMarkdown");
  }

  if (typeof recommendation !== "string" || !VALID_RECOMMENDATIONS.has(recommendation)) {
    throw new FinalReportExtractionError("missing or invalid field: recommendation");
  }

  if (
    typeof contextFit !== "number" ||
    !Number.isFinite(contextFit) ||
    !Number.isInteger(contextFit) ||
    contextFit < 0 ||
    contextFit > 100
  ) {
    throw new FinalReportExtractionError("missing or invalid field: contextFit");
  }

  const validatedAssessments = validateAssessments(assessments, requirements);
  const breakdown = computeMatchScore(validatedAssessments, contextFit);

  return {
    reportMarkdown: reportMarkdown.trim(),
    recommendation: recommendation as ExtractedFinalReport["recommendation"],
    matchScore: breakdown.matchScore,
    strengths: toStringArray(strengths, "strengths"),
    risks: toStringArray(risks, "risks"),
  };
}

export function buildFinalReportMessages(input: {
  transcript: string;
  companyProfile: unknown;
  candidateProfile: unknown;
  requirements: VacancyRequirements;
}): ChatMessage[] {
  const userContent = [
    "=== СТЕНОГРАМА ===",
    input.transcript,
    "",
    "=== ПРОФІЛЬ КОМПАНІЇ (JSON) ===",
    JSON.stringify(input.companyProfile, null, 2),
    "",
    "=== ПРОФІЛЬ КАНДИДАТА (JSON) ===",
    JSON.stringify(input.candidateProfile, null, 2),
    "",
    "=== ВИМОГИ ВАКАНСІЇ (critical / desired) ===",
    JSON.stringify(input.requirements, null, 2),
  ].join("\n");

  return [
    { role: "system", content: FINAL_REPORT_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}

import type { LiveAuthorType } from "@prisma/client";
import type { ChatMessage } from "../llm/types";
import { FINAL_REPORT_SYSTEM_PROMPT_UK } from "./prompts/final-report.uk";

export type LiveTranscriptItem = {
  authorType: LiveAuthorType;
  content: string;
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

export function formatLiveTranscript(messages: LiveTranscriptItem[]): string {
  if (messages.length === 0) return "(розмова порожня)";
  return messages
    .map((item) => `[${AUTHOR_LABELS[item.authorType]}] ${item.content}`)
    .join("\n");
}

export function parseFinalReport(rawText: string): ExtractedFinalReport {
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

  const { reportMarkdown, recommendation, matchScore, strengths, risks } = data as Record<
    string,
    unknown
  >;

  if (typeof reportMarkdown !== "string" || !reportMarkdown.trim()) {
    throw new FinalReportExtractionError("missing or invalid field: reportMarkdown");
  }

  if (typeof recommendation !== "string" || !VALID_RECOMMENDATIONS.has(recommendation)) {
    throw new FinalReportExtractionError("missing or invalid field: recommendation");
  }

  if (
    typeof matchScore !== "number" ||
    !Number.isInteger(matchScore) ||
    matchScore < 0 ||
    matchScore > 100
  ) {
    throw new FinalReportExtractionError("missing or invalid field: matchScore");
  }

  return {
    reportMarkdown: reportMarkdown.trim(),
    recommendation: recommendation as ExtractedFinalReport["recommendation"],
    matchScore,
    strengths: toStringArray(strengths, "strengths"),
    risks: toStringArray(risks, "risks"),
  };
}

export function buildFinalReportMessages(input: {
  transcript: string;
  companyProfile: unknown;
  candidateProfile: unknown;
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
  ].join("\n");

  return [
    { role: "system", content: FINAL_REPORT_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}

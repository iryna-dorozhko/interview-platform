import type { ChatMessage, LlmProvider } from "../llm/types";
import {
  formatSalaryDisplay,
  parseWorkConditionsArray,
} from "../utils/vacancy-work-conditions";
import { DECISION_LETTER_SYSTEM_PROMPT_UK } from "./prompts/decision-letter.uk";

export type DecisionLetterType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

export type VacancyOfferExtraction = {
  offerAvailable: boolean;
  offerLines: string[];
};

export type DecisionLetterContext = {
  type: DecisionLetterType;
  vacancyTitle: string;
  reportMarkdown: string;
  recommendation: string;
  matchScore: number;
  strengths: string[];
  risks: string[];
  companyProfileJson: string;
  candidateProfileJson: string;
  offerAvailable: boolean;
  offerLines: string[];
};

const NOT_SPECIFIED = "не вказано";

function isUnspecifiedValue(value: string): boolean {
  return value.trim().toLowerCase() === NOT_SPECIFIED;
}

function workConditionLineIsSpecified(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const colon = trimmed.indexOf(":");
  const value = colon >= 0 ? trimmed.slice(colon + 1).trim() : trimmed;
  return !isUnspecifiedValue(value);
}

export function extractVacancyOffer(companyProfile: unknown): VacancyOfferExtraction {
  if (typeof companyProfile !== "object" || companyProfile === null) {
    return { offerAvailable: false, offerLines: [] };
  }
  const record = companyProfile as Record<string, unknown>;
  const offerLines: string[] = [];

  const salary = formatSalaryDisplay(record.compensation);
  if (salary) {
    offerLines.push(`Зарплата: ${salary}`);
  }

  for (const line of parseWorkConditionsArray(record.workConditions)) {
    if (workConditionLineIsSpecified(line)) {
      offerLines.push(line.trim());
    }
  }

  return {
    offerAvailable: offerLines.length > 0,
    offerLines,
  };
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

export function normalizeDecisionLetter(raw: string): string {
  const normalized = stripCodeFences(raw.trim()).trim();
  if (!normalized) {
    throw new Error("Decision letter is empty");
  }
  return normalized;
}

export function buildDecisionLetterMessages(ctx: DecisionLetterContext): ChatMessage[] {
  const userContent = [
    `=== ТИП РІШЕННЯ ===`,
    ctx.type,
    "",
    `=== ВАКАНСІЯ ===`,
    ctx.vacancyTitle,
    "",
    `=== РЕКОМЕНДАЦІЯ ЗВІТУ ===`,
    ctx.recommendation,
    "",
    `=== MATCH SCORE ===`,
    String(ctx.matchScore),
    "",
    `=== СИЛЬНІ СТОРОНИ ===`,
    ctx.strengths.map((item) => `- ${item}`).join("\n") || "(немає)",
    "",
    `=== РИЗИКИ ===`,
    ctx.risks.map((item) => `- ${item}`).join("\n") || "(немає)",
    "",
    `=== ОФЕР (УМОВИ ВАКАНСІЇ) ===`,
    `available: ${ctx.offerAvailable ? "true" : "false"}`,
    ctx.offerAvailable
      ? ctx.offerLines.map((item) => `- ${item}`).join("\n")
      : "(умови не вказані — узгодити в діалозі)",
    "",
    `=== ЗВІТ (MARKDOWN) ===`,
    ctx.reportMarkdown,
    "",
    `=== ПРОФІЛЬ КОМПАНІЇ (JSON) ===`,
    ctx.companyProfileJson,
    "",
    `=== ПРОФІЛЬ КАНДИДАТА (JSON) ===`,
    ctx.candidateProfileJson,
  ].join("\n");

  return [
    { role: "system", content: DECISION_LETTER_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}

export async function generateDecisionLetter(
  provider: LlmProvider,
  ctx: DecisionLetterContext,
): Promise<string> {
  const messages = buildDecisionLetterMessages(ctx);
  const raw = await provider.complete(messages);
  return normalizeDecisionLetter(raw);
}

import type { ChatMessage, LlmProvider } from "../llm/types";
import { DECISION_LETTER_SYSTEM_PROMPT_UK } from "./prompts/decision-letter.uk";

export type DecisionLetterType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

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
};

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

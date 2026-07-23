import type { ChatMessage, LlmProvider } from "../llm/types";
import { normalizeDecisionLetter } from "./decision-letter-agent";
import { APPLICATION_DECLINE_LETTER_SYSTEM_PROMPT_UK } from "./prompts/application-decline-letter.uk";

export type ApplicationDeclineLetterContext = {
  vacancyTitle: string;
  candidateSummary: string;
  matchScore: number;
};

export function buildApplicationDeclineLetterMessages(
  ctx: ApplicationDeclineLetterContext,
): ChatMessage[] {
  const userContent = [
    `=== ВАКАНСІЯ ===`,
    ctx.vacancyTitle,
    "",
    `=== MATCH SCORE ===`,
    String(ctx.matchScore),
    "",
    `=== КОРОТКО ПРО КАНДИДАТА ===`,
    ctx.candidateSummary,
  ].join("\n");

  return [
    { role: "system", content: APPLICATION_DECLINE_LETTER_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}

export async function generateApplicationDeclineLetter(
  provider: LlmProvider,
  ctx: ApplicationDeclineLetterContext,
): Promise<string> {
  const messages = buildApplicationDeclineLetterMessages(ctx);
  const raw = await provider.complete(messages);
  return normalizeDecisionLetter(raw);
}

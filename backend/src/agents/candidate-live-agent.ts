import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmProvider } from "../llm/types";
import { AgentPostReplyParseError } from "./agent-post-reply";
import type { LiveAgentTurnContext } from "./live-agent-turn-context";
import { CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-live-agent.uk";
import { resolveCandidateProfileForInterview } from "../utils/interview-readiness";

export type CandidateConfidenceLevel = "confirmed" | "inferred" | "unknown";

export interface ParsedCandidateLiveReply {
  post: boolean;
  message?: string;
  confidence?: CandidateConfidenceLevel;
  needsHuman: boolean;
}

export { AgentPostReplyParseError as CandidateLiveReplyParseError };
export type { LiveAgentTurnContext };

const CONFIDENCE_LEVELS = new Set<CandidateConfidenceLevel>([
  "confirmed",
  "inferred",
  "unknown",
]);

function parseConfidenceLevel(value: unknown): CandidateConfidenceLevel {
  if (typeof value !== "string" || !CONFIDENCE_LEVELS.has(value as CandidateConfidenceLevel)) {
    throw new AgentPostReplyParseError("missing or invalid field: confidence");
  }
  return value as CandidateConfidenceLevel;
}

export function parseCandidateLiveReply(
  rawText: string,
  options?: { requireConfidence?: boolean },
): ParsedCandidateLiveReply {
  const withoutFences = rawText.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new AgentPostReplyParseError("LLM returned invalid JSON for agent reply");
  }

  if (typeof data !== "object" || data === null) {
    throw new AgentPostReplyParseError("Agent reply is not a JSON object");
  }

  const record = data as Record<string, unknown>;
  const { post, message } = record;

  if (typeof post !== "boolean") {
    throw new AgentPostReplyParseError("missing or invalid field: post");
  }

  if (!post) {
    return { post: false, needsHuman: false };
  }

  if (typeof message !== "string" || !message.trim()) {
    throw new AgentPostReplyParseError("missing or invalid field: message");
  }

  const confidenceRaw = record.confidence;
  if (confidenceRaw === undefined || confidenceRaw === null) {
    if (options?.requireConfidence) {
      throw new AgentPostReplyParseError("missing or invalid field: confidence");
    }
    return { post: true, message: message.trim(), needsHuman: false };
  }

  const confidence = parseConfidenceLevel(confidenceRaw);
  return {
    post: true,
    message: message.trim(),
    confidence,
    needsHuman: confidence === "unknown",
  };
}

export function toPrismaCandidateConfidence(
  level: CandidateConfidenceLevel,
): import("@prisma/client").CandidateConfidence {
  const map = {
    confirmed: "CONFIRMED",
    inferred: "INFERRED",
    unknown: "UNKNOWN",
  } as const;
  return map[level];
}

export interface CandidateLiveProfileContext {
  summary: string;
  experience: unknown;
  skills: unknown;
  goals: unknown;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

export class CandidateLiveContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateLiveContextError";
  }
}

function formatProfileBlock(data: CandidateLiveProfileContext): string {
  return JSON.stringify(data, null, 2);
}

function buildSystemPrompt(candidateProfile: CandidateLiveProfileContext): string {
  return CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{CANDIDATE_PROFILE}}",
    formatProfileBlock(candidateProfile),
  );
}

function mapHistoryItem(item: LiveHistoryItem): ChatMessage {
  switch (item.authorType) {
    case "HUMAN_HR":
      return { role: "user", content: `[HR] ${item.content}` };
    case "HUMAN_CANDIDATE":
      return { role: "user", content: `[Кандидат] ${item.content}` };
    case "AGENT_ARBITER":
    case "AGENT_COMPANY":
    case "AGENT_CANDIDATE":
      return { role: "assistant", content: item.content };
    default: {
      const _exhaustive: never = item.authorType;
      return _exhaustive;
    }
  }
}

export const COMPANY_QUESTION_NUDGE_UK =
  "[Система] Company Agent поставив питання. Відповідай про кандидата (третя особа) згідно з профілем. Не повторюй факти з попередніх повідомлень AGENT_CANDIDATE або HUMAN_CANDIDATE у цьому чаті — лише нове для поточного питання.";

export const ANSWER_NUDGE_UK =
  "[Система] Команда Arbiter: ANSWER. Відповідай на відкрите питання про кандидата (третя особа) згідно з профілем. Спочатку перевір історію чату — не дублюй уже сказане. Якщо з профілю видно прогалину — post:true, needsHuman:true, висунь припущення і попроси підтвердити/доповнити. Якщо даних немає — post:true, needsHuman:true і природно попроси живу людину відповісти (не мовчи, не копіюй шаблон).";

export const CANDIDATE_QUESTIONS_NUDGE_UK =
  "[Система] Команда Arbiter: CANDIDATE_QUESTIONS. Постав одне нове питання компанії в інтересах кандидата (не те, що вже питали або на яке відповіли в чаті), або коротко скажи, що питань немає.";

export function formatCandidateTurnNudge(turnContext: LiveAgentTurnContext): string {
  const brief = turnContext.briefUk?.trim();
  const briefPart = brief ? ` Підказка Arbiter: ${brief}` : "";

  if (turnContext.action === "CANDIDATE_QUESTIONS") {
    return `${CANDIDATE_QUESTIONS_NUDGE_UK}${briefPart}`;
  }

  return `${ANSWER_NUDGE_UK}${briefPart}`;
}

export function buildCandidateLiveMessages(input: {
  candidateProfile: CandidateLiveProfileContext;
  history: LiveHistoryItem[];
  turnContext?: LiveAgentTurnContext;
}): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(input.candidateProfile),
    },
    ...input.history.map(mapHistoryItem),
  ];

  if (input.turnContext) {
    messages.push({
      role: "user",
      content: formatCandidateTurnNudge(input.turnContext),
    });
    return messages;
  }

  const last = input.history[input.history.length - 1];
  if (last?.authorType === "AGENT_COMPANY") {
    messages.push({ role: "user", content: COMPANY_QUESTION_NUDGE_UK });
  }

  return messages;
}

export async function runCandidateLiveTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
  turnContext?: LiveAgentTurnContext,
): Promise<ParsedCandidateLiveReply> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
  });

  if (!interview) {
    throw new CandidateLiveContextError("Missing interview for candidate live turn");
  }

  const candidateProfile = await resolveCandidateProfileForInterview(prisma, interviewId);

  if (!candidateProfile) {
    throw new CandidateLiveContextError("Missing candidate profile for candidate live turn");
  }

  const history = await prisma.liveMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { authorType: true, content: true },
  });

  const llmMessages = buildCandidateLiveMessages({
    candidateProfile: {
      summary: candidateProfile.summary,
      experience: candidateProfile.experience,
      skills: candidateProfile.skills,
      goals: candidateProfile.goals,
    },
    history,
    turnContext,
  });

  const rawReply = await provider.complete(llmMessages);
  return parseCandidateLiveReply(rawReply);
}

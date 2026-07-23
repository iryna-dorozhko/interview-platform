import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import { withLlmRetry } from "../llm/retry";
import type { ChatMessage, LlmProvider } from "../llm/types";
import { bumpAutoRetry } from "../services/interview-eval-counters";
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
  kind?: "clarifying" | "normal";
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

  const kindRaw = record.kind;
  let kind: "clarifying" | "normal" = "normal";
  if (kindRaw !== undefined && kindRaw !== null) {
    if (kindRaw !== "clarifying" && kindRaw !== "normal") {
      throw new AgentPostReplyParseError("invalid field: kind");
    }
    kind = kindRaw;
  }

  const confidenceRaw = record.confidence;
  if (confidenceRaw === undefined || confidenceRaw === null) {
    if (options?.requireConfidence) {
      throw new AgentPostReplyParseError("missing or invalid field: confidence");
    }
    return { post: true, message: message.trim(), needsHuman: false, kind };
  }

  const confidence = parseConfidenceLevel(confidenceRaw);
  return {
    post: true,
    message: message.trim(),
    confidence,
    needsHuman: confidence === "unknown",
    kind,
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
  "[Система] Company Agent поставив питання. Відповідай про кандидата (третя особа) з confidence: confirmed | inferred | unknown. Не перефразовуй питання.";

export const ANSWER_NUDGE_UK =
  "[Система] Команда Arbiter: ANSWER. Відповідай про кандидата (третя особа) згідно з профілем. Обов'язково вкажи confidence: confirmed (факт з профілю), inferred (висновок/часткові дані), unknown (немає даних — попроси живу людину). Не перефразовуй питання — лише відповідь. Не дублюй уже сказане в чаті.";

export const CANDIDATE_QUESTIONS_NUDGE_UK =
  "[Система] Команда Arbiter: CANDIDATE_QUESTIONS. Постав одне нове питання компанії в інтересах кандидата (не те, що вже питали AGENT_COMPANY, HUMAN_HR або AGENT_CANDIDATE, і не перефразовуй їх), або коротко скажи, що питань немає.";

const INTERVIEWER_AUTHOR_TYPES = new Set<LiveAuthorType>(["AGENT_COMPANY", "HUMAN_HR"]);

export function collectRecentInterviewerQuestions(history: LiveHistoryItem[]): string[] {
  return history
    .filter((item) => INTERVIEWER_AUTHOR_TYPES.has(item.authorType))
    .map((item) => item.content.trim())
    .filter(Boolean);
}

export function formatInterviewerQuestionsBlock(history: LiveHistoryItem[]): string {
  const questions = collectRecentInterviewerQuestions(history);
  if (questions.length === 0) {
    return "";
  }

  const lines = questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
  return `\n\nПитання Company/HR у чаті (не дублюй і не перефразовуй):\n${lines}`;
}

export function formatCandidateTurnNudge(
  turnContext: LiveAgentTurnContext,
  history: LiveHistoryItem[] = [],
): string {
  const brief = turnContext.briefUk?.trim();
  const briefPart = brief ? ` Підказка Arbiter: ${brief}` : "";
  const questionBlock = formatInterviewerQuestionsBlock(history);

  if (turnContext.action === "CANDIDATE_QUESTIONS") {
    return `${CANDIDATE_QUESTIONS_NUDGE_UK}${briefPart}${questionBlock}`;
  }

  return `${ANSWER_NUDGE_UK}${briefPart}${questionBlock}`;
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
      content: formatCandidateTurnNudge(input.turnContext, input.history),
    });
    return messages;
  }

  const last = input.history[input.history.length - 1];
  if (last?.authorType === "AGENT_COMPANY") {
    messages.push({
      role: "user",
      content: `${COMPANY_QUESTION_NUDGE_UK}${formatInterviewerQuestionsBlock(input.history)}`,
    });
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

  const requireConfidence =
    turnContext?.action === "ANSWER" || turnContext?.action === undefined;

  return withLlmRetry(async () => {
    const rawReply = await provider.complete(llmMessages);
    return parseCandidateLiveReply(rawReply, { requireConfidence });
  }, {
    label: "candidate-live",
    onRetry: () => bumpAutoRetry(interviewId),
  });
}

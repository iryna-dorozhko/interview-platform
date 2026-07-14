import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmProvider } from "../llm/types";
import {
  AgentPostReplyParseError,
  parsePostReply,
  type ParsedPostReply,
} from "./agent-post-reply";
import { CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-live-agent.uk";
import { resolveCandidateProfileForInterview } from "../utils/interview-readiness";

export type ParsedCandidateLiveReply = ParsedPostReply;
export { AgentPostReplyParseError as CandidateLiveReplyParseError };

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

export function parseCandidateLiveReply(rawText: string): ParsedCandidateLiveReply {
  return parsePostReply(rawText);
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
  "[Система] Company Agent поставив питання. Відповідай від імені кандидата згідно з профілем.";

export function buildCandidateLiveMessages(input: {
  candidateProfile: CandidateLiveProfileContext;
  history: LiveHistoryItem[];
}): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(input.candidateProfile),
    },
    ...input.history.map(mapHistoryItem),
  ];

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
  });

  const rawReply = await provider.complete(llmMessages);
  return parseCandidateLiveReply(rawReply);
}

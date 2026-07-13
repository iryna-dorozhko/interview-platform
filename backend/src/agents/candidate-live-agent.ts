import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmProvider } from "../llm/types";
import {
  AgentPostReplyParseError,
  parsePostReply,
  type ParsedPostReply,
} from "./agent-post-reply";
import { CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-live-agent.uk";

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

export function buildCandidateLiveMessages(input: {
  candidateProfile: CandidateLiveProfileContext;
  history: LiveHistoryItem[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(input.candidateProfile),
    },
    ...input.history.map(mapHistoryItem),
  ];
}

export async function runCandidateLiveTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
): Promise<ParsedCandidateLiveReply> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      candidateProfile: true,
    },
  });

  const candidateProfile = interview?.candidateProfile;

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

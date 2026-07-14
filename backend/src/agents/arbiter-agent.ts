import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmCompleteOptions, LlmProvider } from "../llm/types";
import {
  AgentPostReplyParseError,
  parsePostReply,
  type ParsedPostReply,
} from "./agent-post-reply";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";

export type ParsedArbiterReply = ParsedPostReply;
export { AgentPostReplyParseError as ArbiterReplyParseError };

export interface ArbiterCompanyProfileContext {
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

export class ArbiterContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterContextError";
  }
}

export function parseArbiterReply(rawText: string): ParsedArbiterReply {
  return parsePostReply(rawText);
}

function formatProfileBlock(label: string, data: unknown): string {
  return `${label}: ${JSON.stringify(data)}`;
}

const ARBITER_LLM_OPTIONS: LlmCompleteOptions = {
  maxTokens: 128,
  temperature: 0,
};

function buildSystemPrompt(companyProfile: ArbiterCompanyProfileContext): string {
  return ARBITER_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{COMPANY_PROFILE}}",
    formatProfileBlock("Company", companyProfile),
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

export function buildArbiterMessages(input: {
  companyProfile: ArbiterCompanyProfileContext;
  history: LiveHistoryItem[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(input.companyProfile),
    },
    ...input.history.map(mapHistoryItem),
  ];
}

export async function runArbiterTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
): Promise<ParsedArbiterReply> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      vacancy: { include: { companyProfile: true } },
    },
  });

  const companyProfile = interview?.vacancy?.companyProfile;

  if (!companyProfile) {
    throw new ArbiterContextError("Missing company profile for arbiter turn");
  }

  const history = await prisma.liveMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { authorType: true, content: true },
  });

  const llmMessages = buildArbiterMessages({
    companyProfile: {
      role: companyProfile.role,
      requirements: companyProfile.requirements,
      culture: companyProfile.culture,
      expectations: companyProfile.expectations,
    },
    history,
  });

  const rawReply = await provider.complete(llmMessages, ARBITER_LLM_OPTIONS);

  return parseArbiterReply(rawReply);
}

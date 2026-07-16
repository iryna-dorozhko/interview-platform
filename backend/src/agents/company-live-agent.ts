import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmProvider } from "../llm/types";
import {
  AgentPostReplyParseError,
  parsePostReply,
  type ParsedPostReply,
} from "./agent-post-reply";
import type { LiveAgentTurnContext } from "./live-agent-turn-context";
import { COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-live-agent.uk";

export type ParsedCompanyLiveReply = ParsedPostReply;
export { AgentPostReplyParseError as CompanyLiveReplyParseError };
export type { LiveAgentTurnContext };

export interface CompanyLiveProfileContext {
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

export class CompanyLiveContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyLiveContextError";
  }
}

export function parseCompanyLiveReply(rawText: string): ParsedCompanyLiveReply {
  return parsePostReply(rawText);
}

function formatProfileBlock(data: CompanyLiveProfileContext): string {
  return JSON.stringify(data, null, 2);
}

function buildSystemPrompt(companyProfile: CompanyLiveProfileContext): string {
  return COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{COMPANY_PROFILE}}",
    formatProfileBlock(companyProfile),
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

export function formatCompanyTurnNudge(turnContext: LiveAgentTurnContext): string {
  const brief = turnContext.briefUk?.trim();
  const briefPart = brief ? ` Підказка Arbiter: ${brief}` : "";
  if (turnContext.action === "CLARIFY") {
    return `[Система] Команда Arbiter: CLARIFY. Постав одне уточнююче питання.${briefPart}`;
  }
  return `[Система] Команда Arbiter: NEXT_QUESTION. Постав одне нове інтерв'ю-питання.${briefPart}`;
}

export function buildCompanyLiveMessages(input: {
  companyProfile: CompanyLiveProfileContext;
  history: LiveHistoryItem[];
  turnContext?: LiveAgentTurnContext;
}): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(input.companyProfile),
    },
    ...input.history.map(mapHistoryItem),
  ];

  if (input.turnContext) {
    messages.push({
      role: "user",
      content: formatCompanyTurnNudge(input.turnContext),
    });
  }

  return messages;
}

export async function runCompanyLiveTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
  turnContext?: LiveAgentTurnContext,
): Promise<ParsedCompanyLiveReply> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      vacancy: { include: { companyProfile: true } },
    },
  });

  const companyProfile = interview?.vacancy?.companyProfile;

  if (!companyProfile) {
    throw new CompanyLiveContextError("Missing company profile for company live turn");
  }

  const history = await prisma.liveMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { authorType: true, content: true },
  });

  const llmMessages = buildCompanyLiveMessages({
    companyProfile: {
      role: companyProfile.role,
      requirements: companyProfile.requirements,
      culture: companyProfile.culture,
      expectations: companyProfile.expectations,
    },
    history,
    turnContext,
  });

  const rawReply = await provider.complete(llmMessages);
  return parseCompanyLiveReply(rawReply);
}

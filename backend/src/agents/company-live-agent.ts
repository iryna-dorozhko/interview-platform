import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import { withLlmRetry } from "../llm/retry";
import type { ChatMessage, LlmProvider } from "../llm/types";
import {
  parseVacancyCompensation,
  parseWorkConditionsArray,
  type VacancyCompensation,
} from "../utils/vacancy-work-conditions";
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
  workConditions: string[];
  compensation: VacancyCompensation | null;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

export interface CompanyLiveFollowUpReport {
  reportMarkdown: string;
  risks: unknown;
}

export interface CompanyLiveInterviewContext {
  kind: string;
  followUpFromFinalReport?: CompanyLiveFollowUpReport | null;
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

export function formatFollowUpContext(
  interview?: CompanyLiveInterviewContext | null,
): string {
  if (
    !interview ||
    interview.kind !== "ADDITIONAL_MEETING" ||
    !interview.followUpFromFinalReport
  ) {
    return "none";
  }
  return JSON.stringify(
    {
      risks: interview.followUpFromFinalReport.risks,
      reportMarkdown: interview.followUpFromFinalReport.reportMarkdown,
    },
    null,
    2,
  );
}

function buildSystemPrompt(
  companyProfile: CompanyLiveProfileContext,
  interview?: CompanyLiveInterviewContext | null,
): string {
  return COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{COMPANY_PROFILE}}",
    formatProfileBlock(companyProfile),
  ).replace("{{FOLLOW_UP_CONTEXT}}", formatFollowUpContext(interview));
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

export const ANSWER_CANDIDATE_NUDGE_UK =
  "[Система] Команда Arbiter: ANSWER_CANDIDATE. Відповідай на питання кандидата про компанію або умови вакансії з профілю. Якщо факту немає — попроси HR відповісти самому.";

export function formatCompanyTurnNudge(turnContext: LiveAgentTurnContext): string {
  const brief = turnContext.briefUk?.trim();
  const briefPart = brief ? ` Підказка Arbiter: ${brief}` : "";
  if (turnContext.action === "ANSWER_CANDIDATE") {
    return `${ANSWER_CANDIDATE_NUDGE_UK}${briefPart}`;
  }
  if (turnContext.action === "CLARIFY") {
    return `[Система] Команда Arbiter: CLARIFY. Постав одне уточнююче питання.${briefPart}`;
  }
  return `[Система] Команда Arbiter: NEXT_QUESTION. Постав одне нове інтерв'ю-питання.${briefPart}`;
}

export function buildCompanyLiveMessages(input: {
  companyProfile: CompanyLiveProfileContext;
  history: LiveHistoryItem[];
  turnContext?: LiveAgentTurnContext;
  interview?: CompanyLiveInterviewContext | null;
}): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(input.companyProfile, input.interview),
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
      followUpFromFinalReport: { select: { reportMarkdown: true, risks: true } },
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
      workConditions: parseWorkConditionsArray(companyProfile.workConditions),
      compensation: parseVacancyCompensation(companyProfile.compensation),
    },
    history,
    turnContext,
    interview: {
      kind: interview.kind,
      followUpFromFinalReport: interview.followUpFromFinalReport,
    },
  });

  return withLlmRetry(async () => {
    const rawReply = await provider.complete(llmMessages);
    return parseCompanyLiveReply(rawReply);
  }, { label: "company-live" });
}

import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmProvider } from "../llm/types";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";

export interface ParsedArbiterReply {
  post: boolean;
  message?: string;
}

export interface ArbiterCompanyProfileContext {
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
}

export interface ArbiterCandidateProfileContext {
  summary: string;
  experience: unknown;
  skills: unknown;
  goals: unknown;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

export class ArbiterReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterReplyParseError";
  }
}

export class ArbiterContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterContextError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

export function parseArbiterReply(rawText: string): ParsedArbiterReply {
  const trimmed = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new ArbiterReplyParseError("LLM returned invalid JSON for arbiter reply");
  }

  if (typeof data !== "object" || data === null) {
    throw new ArbiterReplyParseError("Arbiter reply is not a JSON object");
  }

  const { post, message } = data as Record<string, unknown>;

  if (typeof post !== "boolean") {
    throw new ArbiterReplyParseError("missing or invalid field: post");
  }

  if (post) {
    if (typeof message !== "string" || !message.trim()) {
      throw new ArbiterReplyParseError("missing or invalid field: message");
    }
    return { post: true, message: message.trim() };
  }

  return { post: false };
}

function formatProfileBlock(label: string, data: unknown): string {
  return `${label}:\n${JSON.stringify(data, null, 2)}`;
}

function buildSystemPrompt(
  companyProfile: ArbiterCompanyProfileContext,
  candidateProfile: ArbiterCandidateProfileContext,
): string {
  return ARBITER_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{COMPANY_PROFILE}}",
    formatProfileBlock("Company", companyProfile),
  ).replace(
    "{{CANDIDATE_PROFILE}}",
    formatProfileBlock("Candidate", candidateProfile),
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
  candidateProfile: ArbiterCandidateProfileContext;
  history: LiveHistoryItem[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(input.companyProfile, input.candidateProfile),
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
      candidateProfile: true,
    },
  });

  const companyProfile = interview?.vacancy?.companyProfile;
  const candidateProfile = interview?.candidateProfile;

  if (!companyProfile || !candidateProfile) {
    throw new ArbiterContextError("Missing profiles for arbiter turn");
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
    candidateProfile: {
      summary: candidateProfile.summary,
      experience: candidateProfile.experience,
      skills: candidateProfile.skills,
      goals: candidateProfile.goals,
    },
    history,
  });

  const rawReply = await provider.complete(llmMessages);
  return parseArbiterReply(rawReply);
}

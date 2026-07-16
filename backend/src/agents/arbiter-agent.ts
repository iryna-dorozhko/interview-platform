import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmCompleteOptions, LlmProvider } from "../llm/types";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";

export const ARBITER_ACTIONS = [
  "START",
  "ANSWER",
  "NEXT_QUESTION",
  "CLARIFY",
  "CANDIDATE_QUESTIONS",
  "WAIT",
  "SUGGEST_END",
] as const;

export type ArbiterAction = (typeof ARBITER_ACTIONS)[number];

export type ParsedArbiterCommand = {
  action: ArbiterAction;
  summaryUk: string;
  briefUk?: string;
  publicMessage?: string;
};

export type ArbiterTurnOptions = {
  pendingQuestion: boolean;
};

export class ArbiterReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterReplyParseError";
  }
}

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

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function isArbiterAction(value: unknown): value is ArbiterAction {
  return typeof value === "string" && (ARBITER_ACTIONS as readonly string[]).includes(value);
}

export function parseArbiterCommand(rawText: string): ParsedArbiterCommand {
  const trimmed = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new ArbiterReplyParseError("LLM returned invalid JSON for arbiter command");
  }

  if (typeof data !== "object" || data === null) {
    throw new ArbiterReplyParseError("Arbiter command is not a JSON object");
  }

  const record = data as Record<string, unknown>;
  const { action, summaryUk, briefUk, publicMessage } = record;

  if (!isArbiterAction(action)) {
    throw new ArbiterReplyParseError("missing or invalid field: action");
  }

  if (typeof summaryUk !== "string" || !summaryUk.trim()) {
    throw new ArbiterReplyParseError("missing or invalid field: summaryUk");
  }

  const result: ParsedArbiterCommand = {
    action,
    summaryUk: summaryUk.trim(),
  };

  if (briefUk !== undefined) {
    if (typeof briefUk !== "string") {
      throw new ArbiterReplyParseError("invalid field: briefUk");
    }
    const trimmedBrief = briefUk.trim();
    if (trimmedBrief) {
      result.briefUk = trimmedBrief;
    }
  }

  if (publicMessage !== undefined && publicMessage !== null) {
    if (typeof publicMessage !== "string") {
      throw new ArbiterReplyParseError("invalid field: publicMessage");
    }
    const trimmedPublic = publicMessage.trim();
    if (trimmedPublic) {
      result.publicMessage = trimmedPublic;
    }
  }

  if (
    (action === "START" || action === "SUGGEST_END") &&
    !result.publicMessage
  ) {
    throw new ArbiterReplyParseError(
      `action ${action} requires non-empty publicMessage`,
    );
  }

  return result;
}

/** @deprecated Use parseArbiterCommand */
export function parseArbiterReply(rawText: string): ParsedArbiterCommand {
  return parseArbiterCommand(rawText);
}

const ARBITER_LLM_OPTIONS: LlmCompleteOptions = {
  maxTokens: 256,
  temperature: 0,
};

function formatProfileBlock(label: string, data: unknown): string {
  return `${label}: ${JSON.stringify(data)}`;
}

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

export const PENDING_QUESTION_NUDGE_UK =
  "[Система] Зараз є ВІДКРИТЕ питання (від HR або Company). Правила: якщо Candidate щойно попросив живу людину відповісти (немає даних у профілі) або висунув припущення з проханням підтвердити/доповнити — WAIT; якщо HR приймає відповідь або просить наступне питання — NEXT_QUESTION; якщо є змістовна відповідь і її мало — CLARIFY; інакше (питання ще без відповіді) — ANSWER.";

export const NO_PENDING_QUESTION_NUDGE_UK =
  "[Система] Відкритого питання немає. Можна START / NEXT_QUESTION / CANDIDATE_QUESTIONS / WAIT / SUGGEST_END залежно від контексту.";

export function buildArbiterMessages(input: {
  companyProfile: ArbiterCompanyProfileContext;
  history: LiveHistoryItem[];
  pendingQuestion: boolean;
}): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(input.companyProfile),
    },
    ...input.history.map(mapHistoryItem),
  ];

  messages.push({
    role: "user",
    content: input.pendingQuestion ? PENDING_QUESTION_NUDGE_UK : NO_PENDING_QUESTION_NUDGE_UK,
  });

  return messages;
}

export async function runArbiterTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
  options: ArbiterTurnOptions = { pendingQuestion: false },
): Promise<ParsedArbiterCommand> {
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
    pendingQuestion: options.pendingQuestion,
  });

  const rawReply = await provider.complete(llmMessages, ARBITER_LLM_OPTIONS);

  return parseArbiterCommand(rawReply);
}

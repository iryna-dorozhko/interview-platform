import type { ChatMessage } from "../llm/types";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";
import { PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/company-profile-extraction.uk";

export type PrepAuthorType = "HUMAN_HR" | "AGENT_COMPANY";

export interface PrepHistoryItem {
  authorType: PrepAuthorType;
  content: string;
}

export interface ParsedAgentReply {
  message: string;
  readyForConfirmation: boolean;
}

const READY_MARKER_PATTERN = /\n?[[(]?\s*READY:\s*(true|false)\s*[\])]?[.!]?\s*$/i;

export function parseAgentReply(rawText: string): ParsedAgentReply {
  const trimmed = rawText.trim();
  const match = trimmed.match(READY_MARKER_PATTERN);

  if (!match) {
    return { message: trimmed, readyForConfirmation: false };
  }

  const message = trimmed.slice(0, match.index).trim();
  const readyForConfirmation = match[1].toLowerCase() === "true";
  return { message, readyForConfirmation };
}

const EMPTY_TURN_PLACEHOLDER = "(порожнє повідомлення)";

export function buildCompanyAgentMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: COMPANY_AGENT_SYSTEM_PROMPT_UK,
  };

  const historyMessages: ChatMessage[] = history.map((item) => ({
    role: item.authorType === "HUMAN_HR" ? "user" : "assistant",
    content: item.content,
  }));

  // Some providers (e.g. Gemini) require the last message to be from the user.
  // On a fresh session (or if the agent somehow has the last word), append a
  // placeholder user turn so the agent can still greet first, per its system prompt.
  const lastMessage = historyMessages[historyMessages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    historyMessages.push({ role: "user", content: EMPTY_TURN_PLACEHOLDER });
  }

  return [systemMessage, ...historyMessages];
}

export interface ExtractedProfile {
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
}

export class ProfileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileExtractionError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProfileExtractionError(`missing or invalid field: ${field}`);
  }
  return value.map((item) => String(item));
}

export function parseProfileExtraction(rawText: string): ExtractedProfile {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new ProfileExtractionError("LLM returned invalid JSON for profile extraction");
  }

  if (typeof data !== "object" || data === null) {
    throw new ProfileExtractionError("LLM response is not a JSON object");
  }

  const { role, requirements, culture, expectations } = data as Record<string, unknown>;

  if (typeof role !== "string" || !role.trim()) {
    throw new ProfileExtractionError("missing or invalid field: role");
  }

  return {
    role: role.trim(),
    requirements: toStringArray(requirements, "requirements"),
    culture: toStringArray(culture, "culture"),
    expectations: toStringArray(expectations, "expectations"),
  };
}

export function buildProfileExtractionMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const transcript = history
    .map((item) => `${item.authorType === "HUMAN_HR" ? "HR" : "Агент"}: ${item.content}`)
    .join("\n");

  return [
    { role: "system", content: PROFILE_EXTRACTION_SYSTEM_PROMPT_UK },
    { role: "user", content: transcript || "(розмова порожня)" },
  ];
}

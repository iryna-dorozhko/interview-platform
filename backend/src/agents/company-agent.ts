import type { ChatMessage } from "../llm/types";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";
import { VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/vacancy-profile-extraction.uk";

export type PrepAuthorType = "HUMAN_HR" | "AGENT_COMPANY";

export interface PrepHistoryItem {
  authorType: PrepAuthorType;
  content: string;
}

export { parseAgentReply, type ParsedAgentReply } from "./agent-reply";

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

export interface ExtractedVacancyProfile {
  role: string;
  requirements: string[];
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

export function parseVacancyProfileExtraction(rawText: string): ExtractedVacancyProfile {
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

  const { role, requirements, expectations } = data as Record<string, unknown>;

  if (typeof role !== "string" || !role.trim()) {
    throw new ProfileExtractionError("missing or invalid field: role");
  }

  return {
    role: role.trim(),
    requirements: toStringArray(requirements, "requirements"),
    expectations: toStringArray(expectations, "expectations"),
  };
}

export function buildProfileExtractionMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const transcript = history
    .map((item) => `${item.authorType === "HUMAN_HR" ? "HR" : "Агент"}: ${item.content}`)
    .join("\n");

  return [
    { role: "system", content: VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK },
    { role: "user", content: transcript || "(розмова порожня)" },
  ];
}

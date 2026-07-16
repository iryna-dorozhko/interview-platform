import type { ChatMessage } from "../llm/types";
import { COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-profile-agent.uk";
import { HR_COMPANY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/hr-company-profile-extraction.uk";
import type { PrepHistoryItem } from "./company-agent";
import { ProfileExtractionError } from "./company-agent";

export type { PrepHistoryItem } from "./company-agent";
export { parseAgentReply, type ParsedAgentReply } from "./agent-reply";

const EMPTY_TURN_PLACEHOLDER = "(порожнє повідомлення)";

export function buildCompanyProfileAgentMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK,
  };

  const historyMessages: ChatMessage[] = history.map((item) => ({
    role: item.authorType === "HUMAN_HR" ? "user" : "assistant",
    content: item.content,
  }));

  const lastMessage = historyMessages[historyMessages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    historyMessages.push({ role: "user", content: EMPTY_TURN_PLACEHOLDER });
  }

  return [systemMessage, ...historyMessages];
}

export interface HrCompanyProfileExtracted {
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
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

export function parseHrCompanyProfileExtraction(rawText: string): HrCompanyProfileExtracted {
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

  const { culture, companyDirection, policies, workFormat, onboardingApproach } =
    data as Record<string, unknown>;

  return {
    culture: toStringArray(culture, "culture"),
    companyDirection: toStringArray(companyDirection, "companyDirection"),
    policies: toStringArray(policies, "policies"),
    workFormat: toStringArray(workFormat, "workFormat"),
    onboardingApproach: toStringArray(onboardingApproach, "onboardingApproach"),
  };
}

export function buildHrCompanyProfileExtractionMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const transcript = history
    .map((item) => `${item.authorType === "HUMAN_HR" ? "HR" : "Агент"}: ${item.content}`)
    .join("\n");

  return [
    { role: "system", content: HR_COMPANY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK },
    { role: "user", content: transcript || "(розмова порожня)" },
  ];
}

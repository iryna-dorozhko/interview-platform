import type { ChatMessage } from "../llm/types";
import { CANDIDATE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-agent.uk";
import { CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/candidate-profile-extraction.uk";

export type CandidatePrepAuthorType = "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";

export interface CandidatePrepHistoryItem {
  authorType: CandidatePrepAuthorType;
  content: string;
}

const EMPTY_TURN_PLACEHOLDER = "(порожнє повідомлення)";

export function buildCandidateAgentMessages(history: CandidatePrepHistoryItem[]): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: CANDIDATE_AGENT_SYSTEM_PROMPT_UK,
  };

  const historyMessages: ChatMessage[] = history.map((item) => ({
    role: item.authorType === "HUMAN_CANDIDATE" ? "user" : "assistant",
    content: item.content,
  }));

  const lastMessage = historyMessages[historyMessages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    historyMessages.push({ role: "user", content: EMPTY_TURN_PLACEHOLDER });
  }

  return [systemMessage, ...historyMessages];
}

export interface ExtractedCandidateProfile {
  experience: string[];
  skills: {
    strong: string[];
    growth: string[];
  };
  goals: string[];
  summary: string;
}

export class CandidateProfileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateProfileExtractionError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CandidateProfileExtractionError(`missing or invalid field: ${field}`);
  }
  return value.map((item) => String(item));
}

export function parseCandidateProfileExtraction(rawText: string): ExtractedCandidateProfile {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new CandidateProfileExtractionError("LLM returned invalid JSON for profile extraction");
  }

  if (typeof data !== "object" || data === null) {
    throw new CandidateProfileExtractionError("LLM response is not a JSON object");
  }

  const { experience, skills, goals, summary } = data as Record<string, unknown>;

  if (typeof skills !== "object" || skills === null) {
    throw new CandidateProfileExtractionError("missing or invalid field: skills");
  }

  const skillsObj = skills as Record<string, unknown>;

  if (typeof summary !== "string" || !summary.trim()) {
    throw new CandidateProfileExtractionError("missing or invalid field: summary");
  }

  return {
    experience: toStringArray(experience, "experience"),
    skills: {
      strong: toStringArray(skillsObj.strong, "skills.strong"),
      growth: toStringArray(skillsObj.growth, "skills.growth"),
    },
    goals: toStringArray(goals, "goals"),
    summary: summary.trim(),
  };
}

export function buildCandidateProfileExtractionMessages(
  history: CandidatePrepHistoryItem[]
): ChatMessage[] {
  const transcript = history
    .map(
      (item) =>
        `${item.authorType === "HUMAN_CANDIDATE" ? "Кандидат" : "Агент"}: ${item.content}`
    )
    .join("\n");

  return [
    { role: "system", content: CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK },
    { role: "user", content: transcript || "(розмова порожня)" },
  ];
}

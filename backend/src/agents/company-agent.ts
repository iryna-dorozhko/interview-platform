import type { ChatMessage } from "../llm/types";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";

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

export function buildCompanyAgentMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: COMPANY_AGENT_SYSTEM_PROMPT_UK,
  };

  const historyMessages: ChatMessage[] = history.map((item) => ({
    role: item.authorType === "HUMAN_HR" ? "user" : "assistant",
    content: item.content,
  }));

  return [systemMessage, ...historyMessages];
}

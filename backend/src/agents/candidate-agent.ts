import type { ChatMessage } from "../llm/types";
import { CANDIDATE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-agent.uk";

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

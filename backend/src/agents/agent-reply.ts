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

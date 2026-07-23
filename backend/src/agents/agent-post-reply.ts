export interface ParsedPostReply {
  post: boolean;
  message?: string;
  /** Candidate asks the live human to answer; conductor must stop and WAIT. */
  needsHuman?: boolean;
  kind?: "clarifying" | "normal";
}

export class AgentPostReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPostReplyParseError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function parseKind(value: unknown): "clarifying" | "normal" {
  if (value === undefined || value === null) return "normal";
  if (value === "clarifying" || value === "normal") return value;
  throw new AgentPostReplyParseError("invalid field: kind");
}

export function parsePostReply(rawText: string): ParsedPostReply {
  const trimmed = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new AgentPostReplyParseError("LLM returned invalid JSON for agent reply");
  }

  if (typeof data !== "object" || data === null) {
    throw new AgentPostReplyParseError("Agent reply is not a JSON object");
  }

  const { post, message, needsHuman, kind } = data as Record<string, unknown>;

  if (typeof post !== "boolean") {
    throw new AgentPostReplyParseError("missing or invalid field: post");
  }

  if (needsHuman !== undefined && typeof needsHuman !== "boolean") {
    throw new AgentPostReplyParseError("invalid field: needsHuman");
  }

  if (post) {
    if (typeof message !== "string" || !message.trim()) {
      throw new AgentPostReplyParseError("missing or invalid field: message");
    }
    return {
      post: true,
      message: message.trim(),
      needsHuman: needsHuman === true,
      kind: parseKind(kind),
    };
  }

  return { post: false };
}

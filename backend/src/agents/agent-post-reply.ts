export interface ParsedPostReply {
  post: boolean;
  message?: string;
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

  const { post, message } = data as Record<string, unknown>;

  if (typeof post !== "boolean") {
    throw new AgentPostReplyParseError("missing or invalid field: post");
  }

  if (post) {
    if (typeof message !== "string" || !message.trim()) {
      throw new AgentPostReplyParseError("missing or invalid field: message");
    }
    return { post: true, message: message.trim() };
  }

  return { post: false };
}

export interface ParsedArbiterReply {
  post: boolean;
  message?: string;
}

export class ArbiterReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterReplyParseError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

export function parseArbiterReply(rawText: string): ParsedArbiterReply {
  const trimmed = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new ArbiterReplyParseError("LLM returned invalid JSON for arbiter reply");
  }

  if (typeof data !== "object" || data === null) {
    throw new ArbiterReplyParseError("Arbiter reply is not a JSON object");
  }

  const { post, message } = data as Record<string, unknown>;

  if (typeof post !== "boolean") {
    throw new ArbiterReplyParseError("missing or invalid field: post");
  }

  if (post) {
    if (typeof message !== "string" || !message.trim()) {
      throw new ArbiterReplyParseError("missing or invalid field: message");
    }
    return { post: true, message: message.trim() };
  }

  return { post: false };
}

import { Router, type Request, type Response } from "express";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { ChatMessage, LlmProvider } from "../llm/types";

type CompleteBody = {
  message?: unknown;
  messages?: unknown;
};

export function normalizeLlmMessages(body: CompleteBody): ChatMessage[] | null {
  if (typeof body.message === "string" && body.message.trim()) {
    return [{ role: "user", content: body.message.trim() }];
  }

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const messages: ChatMessage[] = [];
    for (const item of body.messages) {
      if (
        typeof item === "object" &&
        item !== null &&
        (item as ChatMessage).role &&
        typeof (item as ChatMessage).content === "string"
      ) {
        const role = (item as ChatMessage).role;
        if (role === "system" || role === "user" || role === "assistant") {
          messages.push({
            role,
            content: (item as ChatMessage).content.trim(),
          });
        }
      }
    }
    return messages.length > 0 ? messages : null;
  }

  return null;
}

export function createLlmRouter(getProvider: () => LlmProvider): Router {
  const router = Router();

  router.post("/llm/complete", async (req: Request, res: Response) => {
    const messages = normalizeLlmMessages(req.body ?? {});

    if (!messages) {
      res.status(400).json({ error: "message or messages required" });
      return;
    }

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[llm] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    try {
      const text = await provider.complete(messages);
      res.status(200).json({ text, provider: provider.name });
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[llm:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[llm:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[llm:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
    }
  });

  return router;
}

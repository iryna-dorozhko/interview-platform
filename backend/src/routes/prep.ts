import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  buildCompanyAgentMessages,
  buildProfileExtractionMessages,
  parseAgentReply,
  parseProfileExtraction,
} from "../agents/company-agent";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type MessageBody = {
  message?: unknown;
};

export function createPrepRouter(
  getPrisma: () => PrismaClient,
  getProvider: () => LlmProvider
): Router {
  const router = Router();

  router.get("/prep/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const session = await prisma.prepSessionHr.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(200).json({ messages: [], isClosed: false, profile: null });
      return;
    }

    const messages = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const profile = session.isClosed
      ? await prisma.companyProfile.findUnique({ where: { interviewId } })
      : null;

    res.status(200).json({
      messages: messages.map((item) => ({
        id: item.id,
        authorType: item.authorType,
        content: item.content,
        createdAt: item.createdAt,
      })),
      isClosed: session.isClosed,
      profile: profile
        ? {
            role: profile.role,
            requirements: profile.requirements,
            culture: profile.culture,
            expectations: profile.expectations,
          }
        : null,
    });
  });

  router.post("/prep/:interviewId/finish", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const session = await prisma.prepSessionHr.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(404).json({ error: "Prep session not found" });
      return;
    }

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    const history = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildProfileExtractionMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[prep:finish:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[prep:finish:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[prep:finish:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let extracted;
    try {
      extracted = parseProfileExtraction(rawReply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] failed to parse profile extraction:", detail);
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    let profile;
    try {
      profile = await prisma.companyProfile.upsert({
        where: { interviewId },
        update: {
          role: extracted.role,
          requirements: extracted.requirements,
          culture: extracted.culture,
          expectations: extracted.expectations,
        },
        create: {
          interviewId,
          role: extracted.role,
          requirements: extracted.requirements,
          culture: extracted.culture,
          expectations: extracted.expectations,
        },
      });
      await prisma.prepSessionHr.update({ where: { id: session.id }, data: { isClosed: true } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] failed to persist profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: {
        role: profile.role,
        requirements: profile.requirements,
        culture: profile.culture,
        expectations: profile.expectations,
      },
    });
  });

  router.post("/prep/:interviewId/message", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const body = (req.body ?? {}) as MessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const session = await prisma.prepSessionHr.upsert({
      where: { interviewId },
      update: {},
      create: { interviewId },
    });

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    if (message) {
      await prisma.prepMessageHr.create({
        data: { sessionId: session.id, authorType: "HUMAN_HR", content: message },
      });
    }

    const history = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCompanyAgentMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[prep:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[prep:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[prep:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    const { message: agentMessage, readyForConfirmation } = parseAgentReply(rawReply);

    try {
      await prisma.prepMessageHr.create({
        data: { sessionId: session.id, authorType: "AGENT_COMPANY", content: agentMessage },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep] failed to persist agent reply:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ message: agentMessage, readyForConfirmation });
  });

  router.delete("/prep/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      const session = await prisma.prepSessionHr.findUnique({ where: { interviewId } });
      if (session) {
        await prisma.prepMessageHr.deleteMany({ where: { sessionId: session.id } });
        await prisma.prepSessionHr.delete({ where: { id: session.id } });
      }
      await prisma.companyProfile.deleteMany({ where: { interviewId } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:delete] failed to reset prep chat:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ ok: true });
  });

  return router;
}

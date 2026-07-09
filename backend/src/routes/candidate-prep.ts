import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  buildCandidateAgentMessages,
  buildCandidateProfileExtractionMessages,
  parseCandidateProfileExtraction,
} from "../agents/candidate-agent";
import { parseAgentReply } from "../agents/agent-reply";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type MessageBody = {
  message?: unknown;
};

export function createCandidatePrepRouter(
  getPrisma: () => PrismaClient,
  getProvider: () => LlmProvider
): Router {
  const router = Router();

  router.get("/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(200).json({ messages: [], isClosed: false, profile: null });
      return;
    }

    const messages = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const profile = session.isClosed
      ? await prisma.candidateProfile.findUnique({ where: { interviewId } })
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
            experience: profile.experience,
            skills: profile.skills,
            goals: profile.goals,
            summary: profile.summary,
            confirmedAt: profile.confirmedAt,
          }
        : null,
    });
  });

  router.post("/:interviewId/message", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const body = (req.body ?? {}) as MessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.upsert({
      where: { interviewId },
      update: {},
      create: { interviewId },
    });

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    if (message) {
      await prisma.prepMessageCandidate.create({
        data: { sessionId: session.id, authorType: "HUMAN_CANDIDATE", content: message },
      });
    }

    const history = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCandidateAgentMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[candidate-prep:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[candidate-prep:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[candidate-prep:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    const { message: agentMessage, readyForConfirmation } = parseAgentReply(rawReply);

    try {
      await prisma.prepMessageCandidate.create({
        data: { sessionId: session.id, authorType: "AGENT_CANDIDATE", content: agentMessage },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep] failed to persist agent reply:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ message: agentMessage, readyForConfirmation });
  });

  router.post("/:interviewId/finish", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(404).json({ error: "Prep session not found" });
      return;
    }

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    const history = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCandidateProfileExtractionMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[candidate-prep:finish:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[candidate-prep:finish:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[candidate-prep:finish:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let extracted;
    try {
      extracted = parseCandidateProfileExtraction(rawReply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] failed to parse profile extraction:", detail);
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    let profile;
    try {
      profile = await prisma.candidateProfile.upsert({
        where: { interviewId },
        update: {
          experience: extracted.experience,
          skills: extracted.skills,
          goals: extracted.goals,
          summary: extracted.summary,
        },
        create: {
          interviewId,
          experience: extracted.experience,
          skills: extracted.skills,
          goals: extracted.goals,
          summary: extracted.summary,
        },
      });
      await prisma.prepSessionCandidate.update({
        where: { id: session.id },
        data: { isClosed: true },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] failed to persist profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: {
        experience: profile.experience,
        skills: profile.skills,
        goals: profile.goals,
        summary: profile.summary,
        confirmedAt: profile.confirmedAt,
      },
    });
  });

  router.delete("/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const existingProfile = await prisma.candidateProfile.findUnique({ where: { interviewId } });
    if (existingProfile?.confirmedAt) {
      res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
      return;
    }

    try {
      const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
      if (session) {
        await prisma.prepMessageCandidate.deleteMany({ where: { sessionId: session.id } });
        await prisma.prepSessionCandidate.delete({ where: { id: session.id } });
      }
      await prisma.candidateProfile.deleteMany({ where: { interviewId } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:delete] failed to reset prep chat:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ ok: true });
  });

  return router;
}

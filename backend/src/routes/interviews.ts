import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Server } from "socket.io";
import {
  buildFinalReportMessages,
  formatLiveTranscript,
  parseFinalReport,
} from "../agents/final-report-agent";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";
import { roomName } from "../socket/maybe-transition-live";
import { generateJoinCode } from "../utils/joinCode";
import { resolveCandidateProfileForInterview } from "../utils/interview-readiness";

const MAX_CREATE_ATTEMPTS = 5;

type CreateBody = { vacancyId?: unknown };

export function createInterviewsRouter(
  getPrisma: () => PrismaClient,
  getIo: () => Server,
  getProvider: () => LlmProvider,
): Router {
  const router = Router();

  router.get("/interviews/mine", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviews = await prisma.interview.findMany({
      where: { hrUserId: req.user?.id },
      orderBy: { createdAt: "desc" },
      include: {
        vacancy: { select: { title: true } },
        finalReport: { select: { id: true, recommendation: true } },
      },
    });

    res.status(200).json({
      interviews: interviews.map((item) => ({
        id: item.id,
        vacancyId: item.vacancyId,
        vacancyTitle: item.vacancy.title,
        displayName: item.displayName,
        joinCode: item.joinCode,
        status: item.status,
        createdAt: item.createdAt,
        reportSummary: item.finalReport?.recommendation ?? null,
        reportId: item.finalReport?.id ?? null,
      })),
    });
  });

  router.get("/interviews/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: {
        vacancy: { select: { title: true } },
        finalReport: { select: { id: true, recommendation: true } },
      },
    });

    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.status(200).json({
      interview: {
        id: interview.id,
        vacancyId: interview.vacancyId,
        vacancyTitle: interview.vacancy.title,
        displayName: interview.displayName,
        joinCode: interview.joinCode,
        status: interview.status,
        createdAt: interview.createdAt,
        reportSummary: interview.finalReport?.recommendation ?? null,
        reportId: interview.finalReport?.id ?? null,
      },
    });
  });

  router.post("/interviews", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const hrUserId = req.user?.id as string;
    const body = (req.body ?? {}) as CreateBody;
    const vacancyId = typeof body.vacancyId === "string" ? body.vacancyId : "";

    if (!vacancyId) {
      res.status(400).json({ error: "vacancyId is required" });
      return;
    }

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (vacancy.status !== "CONFIRMED") {
      res.status(400).json({ error: "Vacancy is not confirmed" });
      return;
    }

    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode();
      try {
        const interview = await prisma.interview.create({
          data: {
            hrUserId,
            vacancyId,
            displayName: vacancy.title,
            joinCode,
            status: "AWAITING_CANDIDATE",
          },
        });
        res.status(201).json({
          interview: {
            id: interview.id,
            vacancyId: interview.vacancyId,
            displayName: interview.displayName,
            joinCode: interview.joinCode,
            status: interview.status,
            createdAt: interview.createdAt,
          },
        });
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        const isLastAttempt = attempt === MAX_CREATE_ATTEMPTS;
        if (code === "P2002" && !isLastAttempt) {
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[interviews:create] failed to create interview:", detail);
        res.status(500).json({ error: "Failed to generate unique join code" });
        return;
      }
    }
  });

  router.delete("/interviews/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
    });

    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const liveSession = await tx.liveSession.findUnique({
        where: { interviewId: interview.id },
      });
      if (liveSession) {
        await tx.liveMessage.deleteMany({ where: { sessionId: liveSession.id } });
        await tx.liveSession.delete({ where: { id: liveSession.id } });
      }

      const prepSession = await tx.prepSessionCandidate.findUnique({
        where: { interviewId: interview.id },
      });
      if (prepSession) {
        await tx.prepMessageCandidate.deleteMany({ where: { sessionId: prepSession.id } });
        await tx.prepSessionCandidate.delete({ where: { id: prepSession.id } });
      }

      await tx.candidateProfile.deleteMany({ where: { interviewId: interview.id } });
      await tx.finalReport.deleteMany({ where: { interviewId: interview.id } });
      await tx.interview.delete({ where: { id: interview.id } });
    });

    res.status(204).end();
  });

  router.post("/interviews/:id/end", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviewId = req.params.id;

    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        finalReport: true,
        liveSession: { include: { messages: { orderBy: { createdAt: "asc" } } } },
        vacancy: { include: { companyProfile: true } },
        candidateProfile: true,
      },
    });

    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (interview.status !== "LIVE") {
      res.status(409).json({ error: "Interview is not live" });
      return;
    }
    if (interview.finalReport) {
      res.status(409).json({ error: "Interview already ended" });
      return;
    }

    const messages = interview.liveSession?.messages ?? [];
    const companyProfile = interview.vacancy.companyProfile;
    const candidateProfile = await resolveCandidateProfileForInterview(prisma, interviewId);

    if (!companyProfile || !candidateProfile) {
      res.status(409).json({ error: "Profiles not ready" });
      return;
    }

    const llmMessages = buildFinalReportMessages({
      transcript: formatLiveTranscript(messages),
      companyProfile,
      candidateProfile,
    });

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[interviews:end] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }
      if (error instanceof LlmError && error.code === "empty_response") {
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[interviews:end:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let extracted;
    try {
      extracted = parseFinalReport(rawReply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[interviews:end] failed to parse final report:", detail);
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    let report;
    try {
      report = await prisma.$transaction(async (tx) => {
        await tx.interview.update({
          where: { id: interviewId },
          data: { status: "ENDED" },
        });
        return tx.finalReport.create({
          data: {
            interviewId,
            reportMarkdown: extracted.reportMarkdown,
            recommendation: extracted.recommendation,
            matchScore: extracted.matchScore,
            strengths: extracted.strengths,
            risks: extracted.risks,
          },
        });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[interviews:end] failed to persist report:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    getIo().to(roomName(interviewId)).emit("room:status", { status: "ENDED" });

    res.status(201).json({
      report: {
        id: report.id,
        recommendation: report.recommendation,
        matchScore: report.matchScore,
      },
    });
  });

  return router;
}

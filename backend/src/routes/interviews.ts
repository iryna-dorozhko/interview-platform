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
import { assertInviteableEmail } from "../utils/invitation";

const MAX_CREATE_ATTEMPTS = 5;

type CreateBody = {
  vacancyId?: unknown;
  candidateEmail?: unknown;
  scheduledAt?: unknown;
};

function parseOptionalScheduledAt(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}

function serializeInvitation(
  inv: { id: string; email: string; status: string } | null | undefined,
) {
  if (!inv) return null;
  return { id: inv.id, email: inv.email, status: inv.status };
}

type InterviewWithRelations = {
  id: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: Date;
  scheduledAt: Date | null;
  vacancy: { title: string };
  finalReport?: { id: string; recommendation: string } | null;
  invitations?: { id: string; email: string; status: string }[];
};

function mapInterviewListItem(item: InterviewWithRelations) {
  const pendingInvitation = item.invitations?.[0] ?? null;
  return {
    id: item.id,
    vacancyId: item.vacancyId,
    vacancyTitle: item.vacancy.title,
    displayName: item.displayName,
    joinCode: item.joinCode,
    status: item.status,
    createdAt: item.createdAt,
    scheduledAt: item.scheduledAt?.toISOString() ?? null,
    invitation: serializeInvitation(pendingInvitation),
    reportSummary: item.finalReport?.recommendation ?? null,
    reportId: item.finalReport?.id ?? null,
  };
}

function mapInterviewDetail(item: InterviewWithRelations) {
  const pendingInvitation = item.invitations?.[0] ?? null;
  return {
    id: item.id,
    vacancyId: item.vacancyId,
    vacancyTitle: item.vacancy.title,
    displayName: item.displayName,
    joinCode: item.joinCode,
    status: item.status,
    createdAt: item.createdAt,
    scheduledAt: item.scheduledAt?.toISOString() ?? null,
    invitation: serializeInvitation(pendingInvitation),
    reportSummary: item.finalReport?.recommendation ?? null,
    reportId: item.finalReport?.id ?? null,
  };
}

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
        invitations: { where: { status: "PENDING" }, take: 1 },
      },
    });

    res.status(200).json({
      interviews: interviews.map((item) => mapInterviewListItem(item)),
    });
  });

  router.get("/interviews/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: {
        vacancy: { select: { title: true } },
        finalReport: { select: { id: true, recommendation: true } },
        invitations: { where: { status: "PENDING" }, take: 1 },
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
      interview: mapInterviewDetail(interview),
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

    let candidateEmailNormalized: string | null = null;
    const rawEmail = body.candidateEmail;
    if (rawEmail !== undefined && rawEmail !== null && rawEmail !== "") {
      if (typeof rawEmail !== "string") {
        res.status(400).json({ error: "Invalid email" });
        return;
      }
      const check = await assertInviteableEmail(prisma, rawEmail);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }
      candidateEmailNormalized = check.email;
    }

    const scheduledAt = parseOptionalScheduledAt(body.scheduledAt);
    if (scheduledAt === "invalid") {
      res.status(400).json({ error: "Invalid scheduledAt" });
      return;
    }

    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode();
      try {
        const result = await prisma.$transaction(async (tx) => {
          const interview = await tx.interview.create({
            data: {
              hrUserId,
              vacancyId,
              displayName: vacancy.title,
              joinCode,
              status: "AWAITING_CANDIDATE",
              scheduledAt,
            },
          });
          let invitation = null;
          if (candidateEmailNormalized) {
            invitation = await tx.invitation.create({
              data: {
                interviewId: interview.id,
                email: candidateEmailNormalized,
                status: "PENDING",
              },
            });
          }
          return { interview, invitation };
        });
        res.status(201).json({
          interview: {
            id: result.interview.id,
            vacancyId: result.interview.vacancyId,
            displayName: result.interview.displayName,
            joinCode: result.interview.joinCode,
            status: result.interview.status,
            createdAt: result.interview.createdAt,
            scheduledAt: result.interview.scheduledAt?.toISOString() ?? null,
            invitation: serializeInvitation(result.invitation),
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

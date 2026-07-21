import { Router, type Request, type Response } from "express";
import type { Interview, Invitation, Prisma, PrismaClient } from "@prisma/client";
import type { Server } from "socket.io";
import {
  buildFinalReportMessages,
  formatLiveTranscript,
  parseFinalReport,
} from "../agents/final-report-agent";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";
import { roomName } from "../socket/maybe-transition-live";
import { SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME, isSelfServiceQuestionnaire } from "../utils/candidate-interview-kind";
import { generateJoinCode } from "../utils/joinCode";
import { resolveCandidateProfileForInterview } from "../utils/interview-readiness";
import { assertInviteableEmail, cancelPendingInvitations } from "../utils/invitation";

const MAX_CREATE_ATTEMPTS = 5;
const EDITABLE_STATUSES = new Set(["AWAITING_CANDIDATE", "READY"]);

function isHrVisibleInterview(interview: { displayName: string }): boolean {
  return !isSelfServiceQuestionnaire(interview.displayName);
}

const interviewDetailInclude = {
  vacancy: { select: { title: true } },
  finalReport: { select: { id: true, recommendation: true } },
  invitations: { where: { status: "PENDING" as const }, take: 1 },
};

type CreateBody = {
  vacancyId?: unknown;
  candidateEmail?: unknown;
  scheduledAt?: unknown;
};

export function parseOptionalScheduledAt(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}

export function serializeInvitation(
  inv: { id: string; email: string; status: string } | null | undefined,
) {
  if (!inv) return null;
  return { id: inv.id, email: inv.email, status: inv.status };
}

export const APPLICATION_ALREADY_CONVERTED = "APPLICATION_ALREADY_CONVERTED";

export async function createInterviewWithJoinCode(
  prisma: PrismaClient,
  params: {
    hrUserId: string;
    vacancyId: string;
    displayName: string;
    scheduledAt: Date | null;
    candidateUserId?: string | null;
    candidateEmail?: string | null;
    /** Runs in the same transaction as interview create (before commit). */
    afterCreate?: (
      tx: Prisma.TransactionClient,
      created: { interview: Interview; invitation: Invitation | null },
    ) => Promise<void>;
  },
): Promise<{ interview: Interview; invitation: Invitation | null }> {
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    const joinCode = generateJoinCode();
    try {
      return await prisma.$transaction(async (tx) => {
        const interview = await tx.interview.create({
          data: {
            hrUserId: params.hrUserId,
            vacancyId: params.vacancyId,
            displayName: params.displayName,
            joinCode,
            status: "AWAITING_CANDIDATE",
            scheduledAt: params.scheduledAt,
            ...(params.candidateUserId
              ? { candidateUserId: params.candidateUserId }
              : {}),
          },
        });
        let invitation: Invitation | null = null;
        if (params.candidateEmail) {
          invitation = await tx.invitation.create({
            data: {
              interviewId: interview.id,
              email: params.candidateEmail,
              status: params.candidateUserId ? "ACCEPTED" : "PENDING",
            },
          });
        }
        const created = { interview, invitation };
        if (params.afterCreate) {
          await params.afterCreate(tx, created);
        }
        return created;
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === APPLICATION_ALREADY_CONVERTED) {
        throw error;
      }
      const isLastAttempt = attempt === MAX_CREATE_ATTEMPTS;
      const detail = error instanceof Error ? error.message : String(error);
      const isCandidateUserIdConflict =
        code === "P2002" && detail.includes("candidateUserId");
      const willRetry = code === "P2002" && !isCandidateUserIdConflict && !isLastAttempt;
      // #region agent log
      if (code === "P2002") {
        const target = (error as { meta?: { target?: string[] } }).meta?.target ?? null;
        fetch("http://127.0.0.1:7331/ingest/5a344c29-d415-4068-bc43-0bba69a8eb6b", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "66c73a" },
          body: JSON.stringify({
            sessionId: "66c73a",
            runId: "post-fix",
            hypothesisId: "C",
            location: "interviews.ts:createInterviewWithJoinCode:P2002",
            message: "unique constraint during interview create",
            data: {
              attempt,
              isLastAttempt,
              willRetry,
              isCandidateUserIdConflict,
              target,
              hasCandidateUserId: Boolean(params.candidateUserId),
              candidateUserIdSuffix: params.candidateUserId
                ? params.candidateUserId.slice(-6)
                : null,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion
      if (isCandidateUserIdConflict) {
        throw error;
      }
      if (willRetry) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to generate unique join code");
}

type InterviewWithRelations = {
  id: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: Date;
  scheduledAt: Date | null;
  candidateUserId?: string | null;
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
    candidateLinked: item.candidateUserId != null,
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
    candidateLinked: item.candidateUserId != null,
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
      where: {
        hrUserId: req.user?.id,
        displayName: { not: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME },
      },
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
    if (!isHrVisibleInterview(interview)) {
      res.status(404).json({ error: "Interview not found" });
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

    try {
      const result = await createInterviewWithJoinCode(prisma, {
        hrUserId,
        vacancyId,
        displayName: vacancy.title,
        scheduledAt,
        candidateEmail: candidateEmailNormalized,
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
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[interviews:create] failed to create interview:", detail);
      res.status(500).json({ error: "Failed to generate unique join code" });
    }
  });

  router.patch("/interviews/:id/invitation", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviewId = req.params.id;
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });

    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!isHrVisibleInterview(interview)) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (!EDITABLE_STATUSES.has(interview.status) || interview.candidateUserId != null) {
      res.status(409).json({ error: "Cannot update invitation" });
      return;
    }

    const body = req.body ?? {};
    if (!("candidateEmail" in body)) {
      res.status(400).json({ error: "candidateEmail is required" });
      return;
    }
    const rawEmail = body.candidateEmail;
    if (rawEmail !== null && typeof rawEmail !== "string") {
      res.status(400).json({ error: "Invalid email" });
      return;
    }

    if (rawEmail === null) {
      await cancelPendingInvitations(prisma, interviewId);
      res.status(200).json({ invitation: null });
      return;
    }

    const check = await assertInviteableEmail(prisma, rawEmail);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    const invitation = await prisma.$transaction(async (tx) => {
      await cancelPendingInvitations(tx, interviewId);
      return tx.invitation.create({
        data: {
          interviewId,
          email: check.email,
          status: "PENDING",
        },
      });
    });

    res.status(200).json({ invitation: serializeInvitation(invitation) });
  });

  router.patch("/interviews/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviewId = req.params.id;
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });

    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!isHrVisibleInterview(interview)) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (!EDITABLE_STATUSES.has(interview.status)) {
      res.status(409).json({ error: "Cannot update schedule" });
      return;
    }

    const body = req.body ?? {};
    if (!("scheduledAt" in body)) {
      res.status(400).json({ error: "scheduledAt is required" });
      return;
    }

    const scheduledAt = parseOptionalScheduledAt(body.scheduledAt);
    if (scheduledAt === "invalid") {
      res.status(400).json({ error: "Invalid scheduledAt" });
      return;
    }

    await prisma.interview.update({
      where: { id: interviewId },
      data: { scheduledAt },
    });

    const updated = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: interviewDetailInclude,
    });

    res.status(200).json({ interview: mapInterviewDetail(updated!) });
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

    if (!isHrVisibleInterview(interview)) {
      res.status(409).json({ error: "Self-service questionnaire cannot be deleted" });
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
      transcript: formatLiveTranscript(
        messages.map((m) => ({
          authorType: m.authorType,
          content: m.content,
          candidateConfidence: m.candidateConfidence,
        })),
      ),
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

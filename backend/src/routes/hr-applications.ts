import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  ACTIVE_CANDIDATE_INTERVIEW_STATUSES,
  getConfirmedQuestionnaireProfile,
  maybeTransitionToReady,
} from "../utils/interview-readiness";
import { SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME } from "../utils/candidate-interview-kind";
import {
  APPLICATION_ALREADY_CONVERTED,
  createInterviewWithJoinCode,
  parseOptionalScheduledAt,
  serializeInvitation,
} from "./interviews";

function mapApplicationListItem(app: {
  id: string;
  vacancyId: string;
  matchScore: number;
  candidateSummary: string;
  status: string;
  interviewId: string | null;
  createdAt: Date;
  vacancy: { id: string; title: string };
}) {
  return {
    id: app.id,
    vacancyId: app.vacancyId,
    vacancyTitle: app.vacancy.title,
    matchScore: app.matchScore,
    candidateSummary: app.candidateSummary,
    status: app.status,
    interviewId: app.interviewId,
    createdAt: app.createdAt.toISOString(),
  };
}

export function createHrApplicationsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/hr/notifications", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const notifications = await prisma.hrNotification.findMany({
      where: { hrUserId: req.user!.id },
      orderBy: { createdAt: "desc" },
    });

    notifications.sort((a, b) => {
      const aUnread = a.readAt == null ? 0 : 1;
      const bUnread = b.readAt == null ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    res.status(200).json({
      notifications: notifications.map((item) => ({
        id: item.id,
        type: item.type,
        payload: item.payload,
        readAt: item.readAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  });

  router.post("/hr/notifications/:id/read", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const notification = await prisma.hrNotification.findUnique({
      where: { id: req.params.id },
    });

    if (!notification || notification.hrUserId !== req.user!.id) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    const updated =
      notification.readAt != null
        ? notification
        : await prisma.hrNotification.update({
            where: { id: notification.id },
            data: { readAt: new Date() },
          });

    res.status(200).json({
      notification: {
        id: updated.id,
        type: updated.type,
        payload: updated.payload,
        readAt: updated.readAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  });

  router.get("/hr/applications", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const applications = await prisma.vacancyApplication.findMany({
      where: { vacancy: { hrUserId: req.user!.id } },
      orderBy: { createdAt: "desc" },
      include: { vacancy: { select: { id: true, title: true } } },
    });

    res.status(200).json({
      applications: applications.map(mapApplicationListItem),
    });
  });

  router.get("/hr/applications/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const application = await prisma.vacancyApplication.findUnique({
      where: { id: req.params.id },
      include: {
        vacancy: { select: { id: true, title: true, hrUserId: true } },
        candidateUser: { select: { id: true, email: true } },
      },
    });

    if (!application || application.vacancy.hrUserId !== req.user!.id) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const profile = await getConfirmedQuestionnaireProfile(
      prisma,
      application.candidateUserId,
    );

    res.status(200).json({
      application: {
        id: application.id,
        vacancyId: application.vacancyId,
        vacancyTitle: application.vacancy.title,
        matchScore: application.matchScore,
        matchBreakdown: application.matchBreakdown,
        candidateSummary: application.candidateSummary,
        status: application.status,
        interviewId: application.interviewId,
        createdAt: application.createdAt.toISOString(),
        candidate: {
          id: application.candidateUserId,
          fullName: profile?.fullName ?? null,
          email: profile?.email ?? application.candidateUser.email,
        },
      },
    });
  });

  router.post("/hr/applications/:id/create-interview", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const hrUserId = req.user!.id;
    const application = await prisma.vacancyApplication.findUnique({
      where: { id: req.params.id },
      include: {
        vacancy: true,
      },
    });

    if (!application || application.vacancy.hrUserId !== hrUserId) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (application.status !== "PENDING") {
      res.status(409).json({ error: "Application is not pending" });
      return;
    }
    if (application.vacancy.status !== "CONFIRMED") {
      res.status(400).json({ error: "Vacancy is not confirmed" });
      return;
    }
    if (application.vacancy.hiddenAt != null) {
      res.status(409).json({ error: "VACANCY_HIDDEN" });
      return;
    }

    const body = (req.body ?? {}) as { scheduledAt?: unknown };
    const scheduledAt = parseOptionalScheduledAt(body.scheduledAt);
    if (scheduledAt === "invalid") {
      res.status(400).json({ error: "Invalid scheduledAt" });
      return;
    }

    const blockingActive = await prisma.interview.findFirst({
      where: {
        candidateUserId: application.candidateUserId,
        status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
        displayName: { not: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME },
      },
      select: { id: true, status: true, displayName: true },
    });
    // #region agent log
    fetch("http://127.0.0.1:7331/ingest/5a344c29-d415-4068-bc43-0bba69a8eb6b", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "66c73a" },
      body: JSON.stringify({
        sessionId: "66c73a",
        runId: "post-fix",
        hypothesisId: "A",
        location: "hr-applications.ts:create-interview:precheck",
        message: "create-interview precheck existing candidate interviews",
        data: {
          applicationIdSuffix: application.id.slice(-6),
          candidateUserIdSuffix: application.candidateUserId.slice(-6),
          vacancyStatus: application.vacancy.status,
          applicationStatus: application.status,
          blockingActive: blockingActive
            ? {
                idSuffix: blockingActive.id.slice(-6),
                status: blockingActive.status,
                displayName: blockingActive.displayName,
              }
            : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (blockingActive) {
      // #region agent log
      fetch("http://127.0.0.1:7331/ingest/5a344c29-d415-4068-bc43-0bba69a8eb6b", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "66c73a" },
        body: JSON.stringify({
          sessionId: "66c73a",
          runId: "post-fix",
          hypothesisId: "B",
          location: "hr-applications.ts:create-interview:blocked",
          message: "create-interview rejected: candidate has active interview",
          data: {
            mappedResponse: "Candidate already has active interview",
            status: 409,
            blockingIdSuffix: blockingActive.id.slice(-6),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      res.status(409).json({ error: "Candidate already has active interview" });
      return;
    }

    let result: Awaited<ReturnType<typeof createInterviewWithJoinCode>>;
    try {
      result = await createInterviewWithJoinCode(prisma, {
        hrUserId,
        vacancyId: application.vacancyId,
        displayName: application.vacancy.title,
        scheduledAt,
        candidateUserId: application.candidateUserId,
        afterCreate: async (tx, { interview }) => {
          const updated = await tx.vacancyApplication.updateMany({
            where: { id: application.id, status: "PENDING" },
            data: {
              status: "CONVERTED",
              interviewId: interview.id,
            },
          });
          if (updated.count === 0) {
            const err = new Error("Application already converted");
            (err as { code?: string }).code = APPLICATION_ALREADY_CONVERTED;
            throw err;
          }
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === APPLICATION_ALREADY_CONVERTED) {
        res.status(409).json({ error: "Application is not pending" });
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      const prismaCode = (error as { code?: string }).code ?? null;
      const isCandidateConflict =
        prismaCode === "P2002" && detail.includes("candidateUserId");
      const mappedResponse = isCandidateConflict
        ? "Candidate already has active interview"
        : "Failed to generate unique join code";
      const mappedStatus = isCandidateConflict ? 409 : 500;
      // #region agent log
      const prismaMeta = (error as { code?: string; meta?: { target?: string[] } }).meta;
      fetch("http://127.0.0.1:7331/ingest/5a344c29-d415-4068-bc43-0bba69a8eb6b", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "66c73a" },
        body: JSON.stringify({
          sessionId: "66c73a",
          runId: "post-fix",
          hypothesisId: "B",
          location: "hr-applications.ts:create-interview:catch",
          message: "create-interview failed",
          data: {
            prismaCode,
            prismaTarget: prismaMeta?.target ?? null,
            detailSnippet: detail.slice(0, 280),
            mappedResponse,
            mappedStatus,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      console.error("[hr-applications:create-interview] failed:", detail);
      res.status(mappedStatus).json({ error: mappedResponse });
      return;
    }

    const interview =
      (await maybeTransitionToReady(prisma, result.interview.id)) ?? result.interview;

    res.status(201).json({
      interview: {
        id: interview.id,
        vacancyId: interview.vacancyId,
        displayName: interview.displayName,
        joinCode: interview.joinCode,
        status: interview.status,
        createdAt: interview.createdAt.toISOString(),
        scheduledAt: interview.scheduledAt?.toISOString() ?? null,
        invitation: serializeInvitation(result.invitation),
      },
      application: {
        id: application.id,
        status: "CONVERTED",
        interviewId: result.interview.id,
      },
    });
  });

  return router;
}

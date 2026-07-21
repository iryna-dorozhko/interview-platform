import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  getConfirmedQuestionnaireProfile,
  maybeTransitionToReady,
} from "../utils/interview-readiness";
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

    const body = (req.body ?? {}) as { scheduledAt?: unknown };
    const scheduledAt = parseOptionalScheduledAt(body.scheduledAt);
    if (scheduledAt === "invalid") {
      res.status(400).json({ error: "Invalid scheduledAt" });
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
      console.error("[hr-applications:create-interview] failed:", detail);
      res.status(500).json({ error: "Failed to generate unique join code" });
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

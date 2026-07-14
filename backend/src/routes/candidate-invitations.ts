import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, requireCandidate } from "../auth/middleware";
import {
  canCandidateJoinInterview,
  maybeTransitionToReady,
} from "../utils/interview-readiness";
import { cancelPendingInvitations, normalizeEmail } from "../utils/invitation";

function interviewPayload(interview: {
  id: string;
  displayName: string;
  status: string;
}) {
  return {
    id: interview.id,
    displayName: interview.displayName,
    status: interview.status,
  };
}

export function createCandidateInvitationsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();
  router.use(requireAuth, requireCandidate);

  router.get("/invitations", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const email = normalizeEmail(req.user!.email);

    const list = await prisma.invitation.findMany({
      where: { email, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { interview: { select: { id: true, displayName: true, scheduledAt: true } } },
    });

    res.status(200).json({
      invitations: list.map((item) => ({
        id: item.id,
        interviewId: item.interview.id,
        displayName: item.interview.displayName,
        scheduledAt: item.interview.scheduledAt?.toISOString() ?? null,
        status: item.status,
      })),
    });
  });

  router.post("/invitations/:id/accept", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user!.id;
    const email = normalizeEmail(req.user!.email);

    const invitation = await prisma.invitation.findUnique({
      where: { id: req.params.id },
      include: { interview: true },
    });

    if (!invitation || invitation.status !== "PENDING" || invitation.email !== email) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const interview = invitation.interview;
    const joinCheck = await canCandidateJoinInterview(prisma, candidateUserId, interview);
    if (!joinCheck.ok) {
      res.status(409).json({ error: joinCheck.error });
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (interview.candidateUserId !== candidateUserId) {
          await tx.interview.update({
            where: { id: interview.id },
            data: { candidateUserId },
          });
        }
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED" },
        });
        await cancelPendingInvitations(tx, interview.id);
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "P2002") {
        res.status(409).json({ error: "Candidate already has active interview" });
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-invitations:accept] failed:", detail);
      res.status(500).json({ error: "Failed to accept invitation" });
      return;
    }

    const finalInterview =
      (await maybeTransitionToReady(prisma, interview.id)) ??
      (await prisma.interview.findUnique({ where: { id: interview.id } }));

    res.status(200).json({
      interview: interviewPayload(finalInterview!),
    });
  });

  router.post("/invitations/:id/decline", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const email = normalizeEmail(req.user!.email);

    const invitation = await prisma.invitation.findUnique({
      where: { id: req.params.id },
    });

    if (!invitation || invitation.status !== "PENDING" || invitation.email !== email) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const updated = await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "DECLINED" },
    });

    res.status(200).json({
      invitation: { id: updated.id, status: updated.status },
    });
  });

  return router;
}

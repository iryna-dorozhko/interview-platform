import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, requireCandidate } from "../auth/middleware";
import {
  ACTIVE_CANDIDATE_INTERVIEW_STATUSES,
  canCandidateJoinInterview,
  maybeTransitionToReady,
} from "../utils/interview-readiness";

type JoinBody = { joinCode?: unknown };

export function createCandidateInterviewRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();
  router.use(requireAuth, requireCandidate);

  router.get("/interview", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user?.id as string;

    const interview = await prisma.interview.findFirst({
      where: {
        candidateUserId,
        status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!interview) {
      res.status(200).json({ interview: null });
      return;
    }

    res.status(200).json({
      interview: {
        id: interview.id,
        displayName: interview.displayName,
        status: interview.status,
      },
    });
  });

  router.post("/interview/join", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user?.id as string;
    const body = (req.body ?? {}) as JoinBody;
    const joinCode = typeof body.joinCode === "string" ? body.joinCode.trim().toUpperCase() : "";

    if (!joinCode) {
      res.status(400).json({ error: "joinCode is required" });
      return;
    }

    const interview = await prisma.interview.findUnique({ where: { joinCode } });
    if (!interview) {
      res.status(404).json({ error: "Invalid join code" });
      return;
    }

    const joinCheck = await canCandidateJoinInterview(prisma, candidateUserId, interview);
    if (!joinCheck.ok) {
      res.status(409).json({ error: joinCheck.error });
      return;
    }

    const linked =
      interview.candidateUserId === candidateUserId
        ? interview
        : await prisma.interview.update({
            where: { id: interview.id },
            data: { candidateUserId },
          });

    const finalInterview = (await maybeTransitionToReady(prisma, linked.id)) ?? linked;

    res.status(200).json({
      interview: {
        id: finalInterview.id,
        displayName: finalInterview.displayName,
        status: finalInterview.status,
      },
    });
  });

  return router;
}

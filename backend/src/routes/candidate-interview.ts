import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, requireCandidate } from "../auth/middleware";
import { SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME } from "../utils/candidate-interview-kind";
import { generateJoinCode } from "../utils/joinCode";
import {
  ACTIVE_CANDIDATE_INTERVIEW_STATUSES,
  canCandidateJoinInterview,
  maybeTransitionToReady,
} from "../utils/interview-readiness";
import { cancelPendingInvitations } from "../utils/invitation";

const MAX_CREATE_ATTEMPTS = 5;

type JoinBody = { joinCode?: unknown };

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

async function findSelfServiceVacancy(prisma: PrismaClient) {
  const hrUser = await prisma.user.findFirst({
    where: { role: "HR" },
    orderBy: { createdAt: "asc" },
  });
  if (!hrUser) return null;

  const vacancy = await prisma.vacancy.findFirst({
    where: { hrUserId: hrUser.id },
    orderBy: { createdAt: "asc" },
  });
  if (!vacancy) return null;

  return { hrUserId: hrUser.id, vacancyId: vacancy.id };
}

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
        displayName: { not: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!interview) {
      res.status(200).json({ interview: null });
      return;
    }

    res.status(200).json({
      interview: interviewPayload(interview),
    });
  });

  router.get("/questionnaire", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user?.id as string;

    const interview = await prisma.interview.findFirst({
      where: {
        candidateUserId,
        displayName: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME,
        status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!interview) {
      res.status(200).json({ interview: null });
      return;
    }

    res.status(200).json({
      interview: interviewPayload(interview),
    });
  });

  router.post("/interview/start", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user?.id as string;

    const existing = await prisma.interview.findFirst({
      where: {
        candidateUserId,
        displayName: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME,
        status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      res.status(200).json({ interview: interviewPayload(existing) });
      return;
    }

    const selfService = await findSelfServiceVacancy(prisma);
    if (!selfService) {
      res.status(503).json({ error: "Self-service questionnaire is not configured" });
      return;
    }

    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode();
      try {
        const interview = await prisma.interview.create({
          data: {
            hrUserId: selfService.hrUserId,
            vacancyId: selfService.vacancyId,
            displayName: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME,
            candidateUserId,
            joinCode,
            status: "AWAITING_CANDIDATE",
          },
        });
        res.status(201).json({ interview: interviewPayload(interview) });
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        const isLastAttempt = attempt === MAX_CREATE_ATTEMPTS;
        if (code === "P2002" && !isLastAttempt) {
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[candidate-interview:start] failed to create interview:", detail);
        res.status(500).json({ error: "Failed to create questionnaire" });
        return;
      }
    }
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

    if (interview.displayName === SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME) {
      res.status(404).json({ error: "Invalid join code" });
      return;
    }

    const joinCheck = await canCandidateJoinInterview(prisma, candidateUserId, interview);
    if (!joinCheck.ok) {
      res.status(409).json({ error: joinCheck.error });
      return;
    }

    let linked = interview;
    if (interview.candidateUserId !== candidateUserId) {
      try {
        linked = await prisma.interview.update({
          where: { id: interview.id },
          data: { candidateUserId },
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "P2002") {
          res.status(409).json({ error: "Candidate already has active interview" });
          return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[candidate-interview:join] failed to link candidate:", detail);
        res.status(500).json({ error: "Failed to join interview" });
        return;
      }
    }

    await cancelPendingInvitations(prisma, interview.id);

    const finalInterview = (await maybeTransitionToReady(prisma, linked.id)) ?? linked;

    res.status(200).json({
      interview: interviewPayload(finalInterview),
    });
  });

  return router;
}

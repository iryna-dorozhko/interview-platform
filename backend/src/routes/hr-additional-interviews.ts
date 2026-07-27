import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { maybeTransitionToReady } from "../utils/interview-readiness";
import {
  createInterviewWithJoinCode,
  parseOptionalScheduledAt,
  serializeInvitation,
} from "./interviews";

type CandidateRow = {
  candidateUserId: string;
  candidateEmail: string;
  vacancyId: string;
  vacancyTitle: string;
};

export function createHrAdditionalInterviewsRouter(
  getPrisma: () => PrismaClient,
): Router {
  const router = Router();

  router.get("/hr/additional-meeting-candidates", async (req: Request, res: Response) => {
    if (req.user?.role !== "HR") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const prisma = getPrisma();
    const decisions = await prisma.interviewDecision.findMany({
      where: {
        decidedByUserId: req.user.id,
        type: "ADDITIONAL_MEETING",
      },
      orderBy: { createdAt: "desc" },
      include: {
        interview: {
          select: {
            candidateUserId: true,
            vacancyId: true,
            vacancy: { select: { id: true, title: true } },
            candidateUser: { select: { id: true, email: true } },
          },
        },
      },
    });

    const latestByCandidate = new Map<string, CandidateRow>();
    for (const decision of decisions) {
      const candidateUserId = decision.interview.candidateUserId;
      if (!candidateUserId) continue;
      if (latestByCandidate.has(candidateUserId)) continue;

      latestByCandidate.set(candidateUserId, {
        candidateUserId,
        candidateEmail: decision.interview.candidateUser?.email ?? "",
        vacancyId: decision.interview.vacancyId,
        vacancyTitle: decision.interview.vacancy.title,
      });
    }

    res.status(200).json({ candidates: [...latestByCandidate.values()] });
  });

  router.post("/hr/interviews/additional", async (req: Request, res: Response) => {
    if (req.user?.role !== "HR") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const hrUserId = req.user.id;
    const candidateUserId =
      typeof req.body?.candidateUserId === "string"
        ? req.body.candidateUserId.trim()
        : "";
    if (!candidateUserId) {
      res.status(400).json({ error: "candidateUserId обовʼязковий" });
      return;
    }

    const scheduledAt = parseOptionalScheduledAt(req.body?.scheduledAt);
    if (scheduledAt === "invalid") {
      res.status(400).json({ error: "Невірний scheduledAt" });
      return;
    }

    const prisma = getPrisma();
    const decision = await prisma.interviewDecision.findFirst({
      where: {
        decidedByUserId: hrUserId,
        type: "ADDITIONAL_MEETING",
        interview: { candidateUserId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        interview: {
          include: {
            vacancy: { select: { id: true, title: true, status: true, hiddenAt: true } },
            candidateUser: { select: { email: true } },
          },
        },
      },
    });

    if (!decision || !decision.interview.candidateUserId) {
      res.status(404).json({ error: "Рішення про додаткову зустріч не знайдено" });
      return;
    }

    const vacancy = decision.interview.vacancy;
    if (vacancy.status !== "CONFIRMED") {
      res.status(400).json({ error: "Vacancy is not confirmed" });
      return;
    }
    if (vacancy.hiddenAt != null) {
      res.status(409).json({ error: "VACANCY_HIDDEN" });
      return;
    }

    const candidateEmail = decision.interview.candidateUser?.email ?? null;

    let result: Awaited<ReturnType<typeof createInterviewWithJoinCode>>;
    try {
      result = await createInterviewWithJoinCode(prisma, {
        hrUserId,
        vacancyId: decision.interview.vacancyId,
        displayName: decision.interview.vacancy.title,
        scheduledAt,
        candidateUserId,
        candidateEmail,
        kind: "ADDITIONAL_MEETING",
        followUpFromFinalReportId: decision.finalReportId,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const prismaCode = (error as { code?: string }).code ?? null;
      const isCandidateConflict =
        prismaCode === "P2002" && detail.includes("candidateUserId");
      console.error("[hr-additional-interviews:create] failed:", detail);
      res.status(isCandidateConflict ? 409 : 500).json({
        error: isCandidateConflict
          ? "У кандидата вже є активна співбесіда"
          : "Не вдалося створити співбесіду",
      });
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
        kind: interview.kind,
        followUpFromFinalReportId: interview.followUpFromFinalReportId ?? null,
        createdAt: interview.createdAt.toISOString(),
        scheduledAt: interview.scheduledAt?.toISOString() ?? null,
        candidateUserId: interview.candidateUserId ?? null,
        invitation: serializeInvitation(result.invitation),
      },
    });
  });

  return router;
}

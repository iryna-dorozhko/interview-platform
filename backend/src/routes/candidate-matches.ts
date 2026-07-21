import { Router, type Request, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildCandidateSummaryMessages,
  parseCandidateSummary,
} from "../agents/vacancy-match-agent";
import { requireAuth, requireCandidate } from "../auth/middleware";
import type { LlmProvider } from "../llm/types";
import type { MatchBreakdown } from "../services/match-score";
import {
  getConfirmedCandidateProfile,
  getTopMatchOffers,
  ensureMatchScores,
  VacancyMatchServiceError,
  type CandidateMatchOffer,
} from "../services/vacancy-match";

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function offersPayload(offers: CandidateMatchOffer[]) {
  return {
    offers: offers.map((offer) => ({
      vacancyId: offer.vacancyId,
      title: offer.title,
      matchScore: offer.matchScore,
      salaryDisplay: offer.salaryDisplay,
      workFormatDisplay: offer.workFormatDisplay,
    })),
  };
}

function applicationPayload(application: {
  id: string;
  vacancyId: string;
  matchScore: number;
  status: string;
}) {
  return {
    id: application.id,
    vacancyId: application.vacancyId,
    matchScore: application.matchScore,
    status: application.status,
  };
}

function mapMatchServiceError(error: unknown, res: Response): boolean {
  if (!(error instanceof VacancyMatchServiceError)) return false;
  if (error.code === "QUESTIONNAIRE_NOT_CONFIRMED") {
    res.status(403).json({ error: "Questionnaire not confirmed" });
    return true;
  }
  if (error.code === "MATCH_UNAVAILABLE") {
    res.status(503).json({ error: "Підбір тимчасово недоступний" });
    return true;
  }
  return false;
}

async function findPendingApplication(prisma: PrismaClient, candidateUserId: string) {
  return prisma.vacancyApplication.findFirst({
    where: { candidateUserId, status: "PENDING" },
  });
}

export function createCandidateMatchesRouter(
  getPrisma: () => PrismaClient,
  getLlmProvider: () => LlmProvider,
): Router {
  const router = Router();
  router.use(requireAuth, requireCandidate);

  router.get("/matches/next", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user!.id;

    const pending = await findPendingApplication(prisma, candidateUserId);
    if (pending) {
      res.status(409).json({ error: "ACTIVE_APPLICATION_EXISTS" });
      return;
    }

    try {
      const offers = await getTopMatchOffers(prisma, getLlmProvider(), candidateUserId);
      res.status(200).json(offersPayload(offers));
    } catch (error) {
      if (mapMatchServiceError(error, res)) return;
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-matches:next] failed:", detail);
      res.status(500).json({ error: "Failed to get next match" });
    }
  });

  router.post("/matches/:vacancyId/reject", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user!.id;
    const vacancyId = req.params.vacancyId;

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    const existing = await prisma.vacancyOfferDecision.findUnique({
      where: {
        candidateUserId_vacancyId: { candidateUserId, vacancyId },
      },
    });
    if (existing) {
      res.status(409).json({ error: "Vacancy already rejected" });
      return;
    }

    try {
      await prisma.vacancyOfferDecision.create({
        data: {
          candidateUserId,
          vacancyId,
          decision: "REJECTED",
        },
      });

      const offers = await getTopMatchOffers(prisma, getLlmProvider(), candidateUserId);
      res.status(200).json(offersPayload(offers));
    } catch (error) {
      if (mapMatchServiceError(error, res)) return;
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-matches:reject] failed:", detail);
      res.status(500).json({ error: "Failed to reject match" });
    }
  });

  router.post("/matches/:vacancyId/accept", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const llm = getLlmProvider();
    const candidateUserId = req.user!.id;
    const vacancyId = req.params.vacancyId;

    const pending = await findPendingApplication(prisma, candidateUserId);
    if (pending) {
      res.status(409).json({ error: "ACTIVE_APPLICATION_EXISTS" });
      return;
    }

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    const existingDecision = await prisma.vacancyOfferDecision.findUnique({
      where: {
        candidateUserId_vacancyId: { candidateUserId, vacancyId },
      },
    });
    if (existingDecision) {
      res.status(409).json({ error: "Vacancy already rejected" });
      return;
    }

    try {
      const profile = await getConfirmedCandidateProfile(prisma, candidateUserId);
      if (!profile) {
        throw new VacancyMatchServiceError("QUESTIONNAIRE_NOT_CONFIRMED");
      }

      const offers = await ensureMatchScores(prisma, llm, candidateUserId);
      const offer = offers.find((item) => item.vacancyId === vacancyId);
      if (!offer) {
        res.status(404).json({ error: "Vacancy not found" });
        return;
      }

      let matchBreakdown: MatchBreakdown | unknown = offer.breakdown;
      if (matchBreakdown == null) {
        const scoreRow = await prisma.vacancyMatchScore.findUnique({
          where: {
            candidateUserId_vacancyId: { candidateUserId, vacancyId },
          },
        });
        matchBreakdown = scoreRow?.breakdown ?? {};
      }

      let candidateSummary: string;
      try {
        const messages = buildCandidateSummaryMessages(profile, vacancy.title);
        const rawText = await llm.complete(messages);
        candidateSummary = parseCandidateSummary(rawText);
      } catch {
        throw new VacancyMatchServiceError("MATCH_UNAVAILABLE");
      }

      const application = await prisma.$transaction(async (tx) => {
        const created = await tx.vacancyApplication.create({
          data: {
            candidateUserId,
            vacancyId,
            matchScore: offer.matchScore,
            matchBreakdown: asInputJson(matchBreakdown),
            candidateSummary,
            status: "PENDING",
          },
        });

        await tx.hrNotification.create({
          data: {
            hrUserId: vacancy.hrUserId,
            type: "VACANCY_APPLICATION",
            payload: {
              applicationId: created.id,
              candidateName: profile.fullName,
              email: profile.email,
              vacancyTitle: vacancy.title,
              matchScore: offer.matchScore,
            },
          },
        });

        return created;
      });

      res.status(200).json({ application: applicationPayload(application) });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        res.status(409).json({ error: "ACTIVE_APPLICATION_EXISTS" });
        return;
      }
      if (mapMatchServiceError(error, res)) return;
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-matches:accept] failed:", detail);
      res.status(500).json({ error: "Failed to accept match" });
    }
  });

  router.get("/applications/active", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user!.id;

    const application = await findPendingApplication(prisma, candidateUserId);
    res.status(200).json({
      application: application ? applicationPayload(application) : null,
    });
  });

  return router;
}

import { Router, type Request, type Response } from "express";
import type { CompanyProfile, PrismaClient } from "@prisma/client";
import { ACTIVE_CANDIDATE_INTERVIEW_STATUSES } from "../utils/interview-readiness";
import { normalizeVacancyRequirements } from "../utils/vacancy-requirements";

function serializeVacancyProfile(profile: CompanyProfile) {
  const requirements =
    normalizeVacancyRequirements(profile.requirements) ?? { critical: [], desired: [] };
  return {
    role: profile.role,
    requirements,
    culture: profile.culture,
    expectations: profile.expectations,
    confirmedAt: profile.confirmedAt,
  };
}

function serializeVacancySummary(item: {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  hiddenAt: Date | null;
}) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    createdAt: item.createdAt,
    hiddenAt: item.hiddenAt ? item.hiddenAt.toISOString() : null,
  };
}

type CreateBody = { title?: unknown };
type PatchBody = { title?: unknown };

export function createVacanciesRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/vacancies/mine", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const visibility = req.query.visibility === "hidden" ? "hidden" : "active";
    const vacancies = await prisma.vacancy.findMany({
      where: {
        hrUserId: req.user?.id,
        ...(visibility === "hidden" ? { hiddenAt: { not: null } } : { hiddenAt: null }),
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      vacancies: vacancies.map(serializeVacancySummary),
    });
  });

  router.post("/vacancies", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CreateBody;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2) {
      res.status(400).json({ error: "Title must be at least 2 characters" });
      return;
    }

    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.create({
      data: { hrUserId: req.user?.id as string, title, status: "DRAFT" },
    });

    res.status(201).json({
      vacancy: serializeVacancySummary(vacancy),
    });
  });

  router.post("/vacancies/:id/hide", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.findUnique({ where: { id: req.params.id } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (vacancy.hiddenAt != null) {
      res.status(200).json({ vacancy: serializeVacancySummary(vacancy) });
      return;
    }
    const blocking = await prisma.interview.findFirst({
      where: {
        vacancyId: vacancy.id,
        status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
      },
      select: { id: true },
    });
    if (blocking) {
      res.status(409).json({
        error: "ACTIVE_INTERVIEWS_EXIST",
        message: "Неможливо сховати: є активні співбесіди",
      });
      return;
    }
    const updated = await prisma.vacancy.update({
      where: { id: vacancy.id },
      data: { hiddenAt: new Date() },
    });
    res.status(200).json({ vacancy: serializeVacancySummary(updated) });
  });

  router.post("/vacancies/:id/unhide", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.findUnique({ where: { id: req.params.id } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (vacancy.hiddenAt == null) {
      res.status(200).json({ vacancy: serializeVacancySummary(vacancy) });
      return;
    }
    const updated = await prisma.vacancy.update({
      where: { id: vacancy.id },
      data: { hiddenAt: null },
    });
    res.status(200).json({ vacancy: serializeVacancySummary(updated) });
  });

  router.get("/vacancies/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.findUnique({
      where: { id: req.params.id },
      include: { companyProfile: true },
    });

    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.status(200).json({
      vacancy: {
        ...serializeVacancySummary(vacancy),
        profile: vacancy.companyProfile
          ? serializeVacancyProfile(vacancy.companyProfile)
          : null,
      },
    });
  });

  router.patch("/vacancies/:id", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as PatchBody;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2) {
      res.status(400).json({ error: "Title must be at least 2 characters" });
      return;
    }

    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.findUnique({ where: { id: req.params.id } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const updated = await prisma.vacancy.update({
      where: { id: vacancy.id },
      data: { title },
    });

    res.status(200).json({
      vacancy: serializeVacancySummary(updated),
    });
  });

  router.delete("/vacancies/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.findUnique({ where: { id: req.params.id } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const interviewCount = await prisma.interview.count({ where: { vacancyId: vacancy.id } });
    if (interviewCount > 0) {
      res.status(409).json({
        error: "Cannot delete vacancy with linked interviews",
        interviewCount,
      });
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const session = await tx.prepSessionHr.findUnique({ where: { vacancyId: vacancy.id } });
        if (session) {
          await tx.prepMessageHr.deleteMany({ where: { sessionId: session.id } });
          await tx.prepSessionHr.delete({ where: { id: session.id } });
        }
        await tx.companyProfile.deleteMany({ where: { vacancyId: vacancy.id } });
        await tx.vacancyApplication.deleteMany({ where: { vacancyId: vacancy.id } });
        await tx.vacancyOfferDecision.deleteMany({ where: { vacancyId: vacancy.id } });
        await tx.vacancyMatchScore.deleteMany({ where: { vacancyId: vacancy.id } });
        await tx.vacancy.delete({ where: { id: vacancy.id } });
      });
      res.status(200).json({ ok: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[vacancies:delete] failed:", detail);
      res.status(500).json({ error: "Internal error", detail });
    }
  });

  return router;
}

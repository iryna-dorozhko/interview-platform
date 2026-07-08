import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

type CreateBody = { title?: unknown };
type PatchBody = { title?: unknown };

export function createVacanciesRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/vacancies/mine", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const vacancies = await prisma.vacancy.findMany({
      where: { hrUserId: req.user?.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      vacancies: vacancies.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        createdAt: item.createdAt,
      })),
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
      vacancy: {
        id: vacancy.id,
        title: vacancy.title,
        status: vacancy.status,
        createdAt: vacancy.createdAt,
      },
    });
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
        id: vacancy.id,
        title: vacancy.title,
        status: vacancy.status,
        createdAt: vacancy.createdAt,
        profile: vacancy.companyProfile
          ? {
              role: vacancy.companyProfile.role,
              requirements: vacancy.companyProfile.requirements,
              culture: vacancy.companyProfile.culture,
              expectations: vacancy.companyProfile.expectations,
              confirmedAt: vacancy.companyProfile.confirmedAt,
            }
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

    const resetConfirmed = vacancy.status === "CONFIRMED";
    const updated = await prisma.vacancy.update({
      where: { id: vacancy.id },
      data: { title, ...(resetConfirmed ? { status: "DRAFT" } : {}) },
    });

    if (resetConfirmed) {
      await prisma.companyProfile.updateMany({
        where: { vacancyId: vacancy.id },
        data: { confirmedAt: null },
      });
    }

    res.status(200).json({
      vacancy: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        createdAt: updated.createdAt,
      },
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

    await prisma.vacancy.delete({ where: { id: vacancy.id } });
    res.status(200).json({ ok: true });
  });

  return router;
}

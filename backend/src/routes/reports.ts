import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

export function createReportsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/reports", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const hrUserId = req.user!.id;

    const recommendationRaw = typeof req.query.recommendation === "string"
      ? req.query.recommendation
      : undefined;
    const vacancyId =
      typeof req.query.vacancyId === "string" && req.query.vacancyId.length > 0
        ? req.query.vacancyId
        : undefined;
    const email =
      typeof req.query.email === "string" && req.query.email.trim().length > 0
        ? req.query.email.trim()
        : undefined;
    const dateFromRaw =
      typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateToRaw =
      typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

    const ALLOWED = new Set(["HIRE", "MAYBE", "REJECT"]);
    if (recommendationRaw !== undefined && !ALLOWED.has(recommendationRaw)) {
      res.status(400).json({ error: "Invalid recommendation" });
      return;
    }

    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    let createdAt: { gte?: Date; lte?: Date } | undefined;
    if (dateFromRaw !== undefined) {
      if (!DATE_RE.test(dateFromRaw)) {
        res.status(400).json({ error: "Invalid dateFrom" });
        return;
      }
      createdAt = {
        ...(createdAt ?? {}),
        gte: new Date(`${dateFromRaw}T00:00:00.000Z`),
      };
    }
    if (dateToRaw !== undefined) {
      if (!DATE_RE.test(dateToRaw)) {
        res.status(400).json({ error: "Invalid dateTo" });
        return;
      }
      createdAt = {
        ...(createdAt ?? {}),
        lte: new Date(`${dateToRaw}T23:59:59.999Z`),
      };
    }

    const reports = await prisma.finalReport.findMany({
      where: {
        interview: {
          hrUserId,
          ...(vacancyId ? { vacancyId } : {}),
          ...(email
            ? { candidateUser: { email: { contains: email, mode: "insensitive" } } }
            : {}),
        },
        ...(recommendationRaw
          ? { recommendation: recommendationRaw as "HIRE" | "MAYBE" | "REJECT" }
          : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      include: {
        interview: {
          select: {
            vacancyId: true,
            candidateUser: { select: { email: true } },
            vacancy: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      reports: reports.map((report) => ({
        id: report.id,
        interviewId: report.interviewId,
        candidateEmail: report.interview.candidateUser?.email ?? null,
        vacancyId: report.interview.vacancy.id,
        vacancyTitle: report.interview.vacancy.title,
        matchScore: report.matchScore,
        recommendation: report.recommendation,
        createdAt: report.createdAt,
      })),
    });
  });

  router.get("/reports/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const report = await prisma.finalReport.findUnique({
      where: { id: req.params.id },
      include: {
        interview: { select: { hrUserId: true } },
      },
    });

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    if (report.interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.status(200).json({
      report: {
        id: report.id,
        interviewId: report.interviewId,
        reportMarkdown: report.reportMarkdown,
        recommendation: report.recommendation,
        matchScore: report.matchScore,
        strengths: report.strengths as string[],
        risks: report.risks as string[],
        createdAt: report.createdAt,
      },
    });
  });

  return router;
}

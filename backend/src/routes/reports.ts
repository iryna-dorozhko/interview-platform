import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

export function createReportsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/reports", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const hrUserId = req.user!.id;

    const reports = await prisma.finalReport.findMany({
      where: {
        interview: { hrUserId },
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

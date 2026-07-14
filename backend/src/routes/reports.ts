import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

export function createReportsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

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

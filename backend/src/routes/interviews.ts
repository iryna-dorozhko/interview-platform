import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

export function createInterviewsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/interviews/mine", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviews = await prisma.interview.findMany({
      where: { hrUserId: req.user?.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      interviews: interviews.map((item) => ({
        id: item.id,
        joinCode: item.joinCode,
        status: item.status,
      })),
    });
  });

  return router;
}

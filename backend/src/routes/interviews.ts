import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { generateJoinCode } from "../utils/joinCode";

const MAX_CREATE_ATTEMPTS = 5;

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
        createdAt: item.createdAt,
      })),
    });
  });

  router.post("/interviews", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const hrUserId = req.user?.id as string;

    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode();
      try {
        const interview = await prisma.interview.create({
          data: { hrUserId, joinCode, status: "DRAFT" },
        });
        res.status(201).json({
          interview: {
            id: interview.id,
            joinCode: interview.joinCode,
            status: interview.status,
            createdAt: interview.createdAt,
          },
        });
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        const isLastAttempt = attempt === MAX_CREATE_ATTEMPTS;
        if (code === "P2002" && !isLastAttempt) {
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[interviews:create] failed to create interview:", detail);
        res.status(500).json({ error: "Failed to generate unique join code" });
        return;
      }
    }
  });

  return router;
}

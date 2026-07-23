import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  listEvalSnapshots,
  summarizeEvalSnapshots,
} from "../services/interview-eval";

function requireEvalToken(req: Request, res: Response): boolean {
  const expected = process.env.EVAL_API_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "Eval API disabled" });
    return false;
  }
  const header = req.headers.authorization;
  if (header !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function parseRange(req: Request): { from: Date; to: Date } | { error: string } {
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
    return { error: "from and to required as ISO strings" };
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "invalid from or to date" };
  }
  return { from, to };
}

export function createEvalRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/eval/snapshots", async (req: Request, res: Response) => {
    if (!requireEvalToken(req, res)) return;
    const range = parseRange(req);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const snapshots = await listEvalSnapshots(getPrisma(), range.from, range.to);
    res.status(200).json({ snapshots });
  });

  router.get("/eval/summary", async (req: Request, res: Response) => {
    if (!requireEvalToken(req, res)) return;
    const range = parseRange(req);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const snapshots = await listEvalSnapshots(getPrisma(), range.from, range.to);
    res.status(200).json({ summary: summarizeEvalSnapshots(snapshots) });
  });

  return router;
}

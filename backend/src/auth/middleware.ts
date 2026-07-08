import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt";

export type AuthUser = {
  id: string;
  email: string;
  role: "HR" | "CANDIDATE";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireHr(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "HR") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function requireCandidate(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "CANDIDATE") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

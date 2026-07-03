import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../auth/password";
import { signToken } from "../auth/jwt";
import { requireAuth } from "../auth/middleware";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

export function createAuthRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.post("/auth/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LoginBody;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.passwordHash !== hashPassword(password)) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (user.role !== "HR") {
      res.status(403).json({ error: "HR access only" });
      return;
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  router.get("/auth/me", requireAuth, (req: Request, res: Response) => {
    res.status(200).json({ user: req.user });
  });

  return router;
}

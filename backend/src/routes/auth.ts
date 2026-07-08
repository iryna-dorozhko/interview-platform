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

  const respondWithToken = (
    res: Response,
    user: { id: string; email: string; role: "HR" | "CANDIDATE" }
  ) => {
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  };

  const loginWithExpectedRole = async (
    req: Request,
    res: Response,
    expectedRole: "HR" | "CANDIDATE"
  ) => {
    const body = (req.body ?? {}) as LoginBody;
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
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

    if (user.role !== expectedRole) {
      res
        .status(403)
        .json({ error: expectedRole === "HR" ? "HR access only" : "Candidate access only" });
      return;
    }

    respondWithToken(res, { id: user.id, email: user.email, role: user.role });
  };

  router.post("/auth/hr/login", async (req: Request, res: Response) => {
    await loginWithExpectedRole(req, res, "HR");
  });

  // Backward-compatibility alias while clients migrate to /auth/hr/login.
  router.post("/auth/login", async (req: Request, res: Response) => {
    await loginWithExpectedRole(req, res, "HR");
  });

  router.post("/auth/candidate/register", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LoginBody;
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    const prisma = getPrisma();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "Email already exists" });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        role: "CANDIDATE",
      },
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  router.post("/auth/candidate/login", async (req: Request, res: Response) => {
    await loginWithExpectedRole(req, res, "CANDIDATE");
  });

  router.get("/auth/me", requireAuth, (req: Request, res: Response) => {
    res.status(200).json({ user: req.user });
  });

  return router;
}

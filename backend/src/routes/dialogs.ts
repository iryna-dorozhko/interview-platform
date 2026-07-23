import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

const PREVIEW_MAX = 120;

function isParticipant(
  dialog: { hrUserId: string; candidateUserId: string },
  userId: string,
): boolean {
  return dialog.hrUserId === userId || dialog.candidateUserId === userId;
}

function truncatePreview(body: string): string {
  if (body.length <= PREVIEW_MAX) return body;
  return `${body.slice(0, PREVIEW_MAX)}…`;
}

function lastReadAtForUser(
  dialog: {
    hrUserId: string;
    hrLastReadAt: Date | null;
    candidateLastReadAt: Date | null;
  },
  userId: string,
): Date | null {
  return dialog.hrUserId === userId ? dialog.hrLastReadAt : dialog.candidateLastReadAt;
}

function hiddenAtFieldForUser(
  dialog: { hrUserId: string },
  userId: string,
): "hrHiddenAt" | "candidateHiddenAt" {
  return dialog.hrUserId === userId ? "hrHiddenAt" : "candidateHiddenAt";
}

async function countUnreadMessages(
  prisma: PrismaClient,
  dialogId: string,
  currentUserId: string,
  lastReadAt: Date | null,
): Promise<number> {
  return prisma.dialogMessage.count({
    where: {
      dialogId,
      senderUserId: { not: currentUserId },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  });
}

async function isCandidateEligible(
  prisma: PrismaClient,
  hrUserId: string,
  candidateUserId: string,
): Promise<boolean> {
  const interview = await prisma.interview.findFirst({
    where: { hrUserId, candidateUserId },
    select: { id: true },
  });
  if (interview) return true;

  const application = await prisma.vacancyApplication.findFirst({
    where: {
      candidateUserId,
      vacancy: { hrUserId },
    },
    select: { id: true },
  });
  return application != null;
}

export function createDialogsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/dialogs", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const where =
      req.user!.role === "HR"
        ? { hrUserId: req.user!.id, hrHiddenAt: null }
        : { candidateUserId: req.user!.id, candidateHiddenAt: null };

    const dialogs = await prisma.dialog.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        hrUser: { select: { id: true, email: true } },
        candidateUser: { select: { id: true, email: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, createdAt: true, kind: true },
        },
      },
    });

    res.status(200).json({
      dialogs: await Promise.all(
        dialogs.map(async (dialog) => {
          const peer =
            req.user!.role === "HR"
              ? { id: dialog.candidateUser.id, email: dialog.candidateUser.email }
              : { id: dialog.hrUser.id, email: dialog.hrUser.email };
          const last = dialog.messages[0] ?? null;
          const unreadCount = await countUnreadMessages(
            prisma,
            dialog.id,
            req.user!.id,
            lastReadAtForUser(dialog, req.user!.id),
          );
          return {
            id: dialog.id,
            peer,
            lastMessage: last
              ? {
                  body: truncatePreview(last.body),
                  createdAt: last.createdAt.toISOString(),
                  kind: last.kind,
                }
              : null,
            updatedAt: dialog.updatedAt.toISOString(),
            unreadCount,
          };
        }),
      ),
    });
  });

  router.post("/dialogs", async (req: Request, res: Response) => {
    if (req.user!.role !== "HR") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const candidateUserId =
      typeof req.body?.candidateUserId === "string"
        ? req.body.candidateUserId.trim()
        : "";
    if (!candidateUserId) {
      res.status(400).json({ error: "candidateUserId required" });
      return;
    }

    const prisma = getPrisma();
    const eligible = await isCandidateEligible(
      prisma,
      req.user!.id,
      candidateUserId,
    );
    if (!eligible) {
      res.status(400).json({ error: "Candidate not eligible" });
      return;
    }

    const existing = await prisma.dialog.findUnique({
      where: {
        hrUserId_candidateUserId: {
          hrUserId: req.user!.id,
          candidateUserId,
        },
      },
    });
    if (existing) {
      res.status(200).json({
        dialog: {
          id: existing.id,
          hrUserId: existing.hrUserId,
          candidateUserId: existing.candidateUserId,
        },
      });
      return;
    }

    const created = await prisma.dialog.create({
      data: {
        hrUserId: req.user!.id,
        candidateUserId,
      },
    });

    res.status(201).json({
      dialog: {
        id: created.id,
        hrUserId: created.hrUserId,
        candidateUserId: created.candidateUserId,
      },
    });
  });

  router.get("/dialogs/unread-count", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const where =
      req.user!.role === "HR"
        ? { hrUserId: req.user!.id, hrHiddenAt: null }
        : { candidateUserId: req.user!.id, candidateHiddenAt: null };

    const dialogs = await prisma.dialog.findMany({
      where,
      select: {
        id: true,
        hrUserId: true,
        hrLastReadAt: true,
        candidateLastReadAt: true,
      },
    });

    let unreadCount = 0;
    for (const dialog of dialogs) {
      unreadCount += await countUnreadMessages(
        prisma,
        dialog.id,
        req.user!.id,
        lastReadAtForUser(dialog, req.user!.id),
      );
    }

    res.status(200).json({ unreadCount });
  });

  router.post("/dialogs/:id/read", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const dialog = await prisma.dialog.findUnique({ where: { id: req.params.id } });
    if (!dialog || !isParticipant(dialog, req.user!.id)) {
      res.status(404).json({ error: "Dialog not found" });
      return;
    }

    const now = new Date();
    const data =
      dialog.hrUserId === req.user!.id
        ? { hrLastReadAt: now }
        : { candidateLastReadAt: now };

    await prisma.dialog.update({ where: { id: dialog.id }, data });
    res.status(200).json({ ok: true });
  });

  router.delete("/dialogs/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const dialog = await prisma.dialog.findUnique({ where: { id: req.params.id } });
    if (!dialog || !isParticipant(dialog, req.user!.id)) {
      res.status(404).json({ error: "Dialog not found" });
      return;
    }

    const field = hiddenAtFieldForUser(dialog, req.user!.id);
    await prisma.dialog.update({
      where: { id: dialog.id },
      data: { [field]: new Date() },
    });
    res.status(204).send();
  });

  router.get("/dialogs/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const dialog = await prisma.dialog.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            decision: { select: { type: true } },
          },
        },
      },
    });

    if (!dialog || !isParticipant(dialog, req.user!.id)) {
      res.status(404).json({ error: "Dialog not found" });
      return;
    }

    res.status(200).json({
      dialog: {
        id: dialog.id,
        hrUserId: dialog.hrUserId,
        candidateUserId: dialog.candidateUserId,
        createdAt: dialog.createdAt.toISOString(),
        updatedAt: dialog.updatedAt.toISOString(),
      },
      messages: dialog.messages.map((message) => ({
        id: message.id,
        senderUserId: message.senderUserId,
        body: message.body,
        kind: message.kind,
        createdAt: message.createdAt.toISOString(),
        decision: message.decision ? { type: message.decision.type } : null,
      })),
    });
  });

  router.post("/dialogs/:id/messages", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const dialog = await prisma.dialog.findUnique({
      where: { id: req.params.id },
    });

    if (!dialog || !isParticipant(dialog, req.user!.id)) {
      res.status(404).json({ error: "Dialog not found" });
      return;
    }

    const body =
      typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "body required" });
      return;
    }

    const message = await prisma.dialogMessage.create({
      data: {
        dialogId: dialog.id,
        senderUserId: req.user!.id,
        body,
        kind: "USER",
      },
    });

    await prisma.dialog.update({
      where: { id: dialog.id },
      data: {
        updatedAt: new Date(),
        ...(dialog.hrUserId === req.user!.id
          ? { candidateHiddenAt: null }
          : { hrHiddenAt: null }),
      },
    });

    res.status(201).json({
      message: {
        id: message.id,
        dialogId: message.dialogId,
        senderUserId: message.senderUserId,
        body: message.body,
        kind: message.kind,
        createdAt: message.createdAt.toISOString(),
      },
    });
  });

  return router;
}

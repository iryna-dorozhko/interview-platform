import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Server } from "socket.io";
import { generateDecisionLetter } from "../agents/decision-letter-agent";
import type { LlmProvider } from "../llm/types";
import { emitDialogMessage } from "../socket/dialogs";

const DECISION_TYPES = new Set(["ACCEPT", "REJECT", "ADDITIONAL_MEETING"]);

type DecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

function parseDecisionType(raw: unknown): DecisionType | null {
  return typeof raw === "string" && DECISION_TYPES.has(raw)
    ? (raw as DecisionType)
    : null;
}

export function createReportsRouter(
  getPrisma: () => PrismaClient,
  getLlmProvider: () => LlmProvider,
  getIo: () => Server,
): Router {
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

    const latestDecision = await prisma.interviewDecision.findFirst({
      where: { interviewId: report.interviewId },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, createdAt: true },
    });

    res.status(200).json({
      report: {
        id: report.id,
        interviewId: report.interviewId,
        reportMarkdown: report.reportMarkdown,
        recommendation: report.recommendation,
        matchScore: report.matchScore,
        strengths: report.strengths as string[],
        risks: report.risks as string[],
        overrideKind: report.overrideKind,
        overrideReason: report.overrideReason,
        createdAt: report.createdAt,
        latestDecision,
      },
    });
  });

  async function loadReportForDecision(prisma: PrismaClient, reportId: string) {
    return prisma.finalReport.findUnique({
      where: { id: reportId },
      include: {
        interview: {
          select: {
            hrUserId: true,
            candidateUserId: true,
            vacancy: {
              select: {
                title: true,
                companyProfile: true,
              },
            },
            candidateProfile: true,
          },
        },
      },
    });
  }

  router.post("/reports/:id/decisions/draft", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const report = await loadReportForDecision(prisma, req.params.id);

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    if (report.interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!report.interview.candidateUserId) {
      res.status(400).json({ error: "Candidate user required" });
      return;
    }

    const type = parseDecisionType(req.body?.type);
    if (!type) {
      res.status(400).json({ error: "Invalid decision type" });
      return;
    }

    try {
      const body = await generateDecisionLetter(getLlmProvider(), {
        type,
        vacancyTitle: report.interview.vacancy.title,
        reportMarkdown: report.reportMarkdown,
        recommendation: report.recommendation,
        matchScore: report.matchScore,
        strengths: report.strengths as string[],
        risks: report.risks as string[],
        companyProfileJson: JSON.stringify(report.interview.vacancy.companyProfile ?? {}),
        candidateProfileJson: JSON.stringify(report.interview.candidateProfile ?? {}),
      });
      res.status(200).json({ type, body });
    } catch {
      res.status(502).json({ error: "Failed to generate letter" });
    }
  });

  router.post("/reports/:id/decisions", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const hrUserId = req.user!.id;
    const report = await loadReportForDecision(prisma, req.params.id);

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    if (report.interview.hrUserId !== hrUserId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!report.interview.candidateUserId) {
      res.status(400).json({ error: "Candidate user required" });
      return;
    }

    const type = parseDecisionType(req.body?.type);
    if (!type) {
      res.status(400).json({ error: "Invalid decision type" });
      return;
    }

    const letterBodyRaw = req.body?.letterBody;
    if (typeof letterBodyRaw !== "string" || letterBodyRaw.trim().length === 0) {
      res.status(400).json({ error: "letterBody required" });
      return;
    }
    const letterBody = letterBodyRaw.trim();
    const candidateUserId = report.interview.candidateUserId;

    const result = await prisma.$transaction(async (tx) => {
      const decision = await tx.interviewDecision.create({
        data: {
          interviewId: report.interviewId,
          finalReportId: report.id,
          decidedByUserId: hrUserId,
          type,
          letterBody,
        },
      });

      const existing = await tx.dialog.findUnique({
        where: {
          hrUserId_candidateUserId: {
            hrUserId,
            candidateUserId,
          },
        },
      });

      const dialog =
        existing ??
        (await tx.dialog.create({
          data: {
            hrUserId,
            candidateUserId,
          },
        }));

      const message = await tx.dialogMessage.create({
        data: {
          dialogId: dialog.id,
          senderUserId: hrUserId,
          body: letterBody,
          kind: "DECISION_LETTER",
          decisionId: decision.id,
        },
      });

      await tx.interviewDecision.update({
        where: { id: decision.id },
        data: { dialogMessageId: message.id },
      });

      await tx.dialog.update({
        where: { id: dialog.id },
        data: { updatedAt: new Date(), candidateHiddenAt: null },
      });

      return { decision, dialogId: dialog.id, message };
    });

    emitDialogMessage(getIo(), result.dialogId, {
      id: result.message.id,
      dialogId: result.dialogId,
      senderUserId: result.message.senderUserId,
      body: result.message.body,
      kind: "DECISION_LETTER",
      createdAt: result.message.createdAt.toISOString(),
      decision: { type: result.decision.type as DecisionType },
    });

    res.status(201).json({
      decision: {
        id: result.decision.id,
        type: result.decision.type,
        createdAt: result.decision.createdAt,
      },
      dialogId: result.dialogId,
    });
  });

  return router;
}

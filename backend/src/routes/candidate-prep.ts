import { Router, type Request, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildCandidateAgentMessages,
  buildCandidateProfileExtractionMessages,
  extractContactPreviewFromHistory,
  parseCandidateProfileExtraction,
  type CandidatePrepHistoryItem,
  type ContactPreview,
} from "../agents/candidate-agent";
import { parseAgentReply } from "../agents/agent-reply";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";
import { maybeTransitionToReady } from "../utils/interview-readiness";

type MessageBody = {
  message?: unknown;
};

type ProfilePatchBody = {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  experience?: unknown;
  skills?: unknown;
  goals?: unknown;
  summary?: unknown;
};

function serializeCandidateProfile(profile: {
  fullName: string;
  email: string;
  phone: string | null;
  experience: unknown;
  skills: unknown;
  goals: unknown;
  summary: string;
  confirmedAt: Date | null;
}) {
  return {
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    experience: profile.experience,
    skills: profile.skills,
    goals: profile.goals,
    summary: profile.summary,
    confirmedAt: profile.confirmedAt,
  };
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  if (items.length === 0 || items.length !== value.length) {
    return null;
  }
  return items;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parseCandidateProfilePatch(
  body: ProfilePatchBody
): { ok: true; data: Prisma.CandidateProfileUpdateInput } | { ok: false; error: string } {
  const data: Prisma.CandidateProfileUpdateInput = {};
  const hasField = (field: keyof ProfilePatchBody) => Object.prototype.hasOwnProperty.call(body, field);

  if (!Object.keys(body).some((key) => hasField(key as keyof ProfilePatchBody))) {
    return { ok: false, error: "No fields to update" };
  }

  if (hasField("fullName")) {
    if (typeof body.fullName !== "string" || body.fullName.trim() === "") {
      return { ok: false, error: "Invalid fullName" };
    }
    data.fullName = body.fullName.trim();
  }

  if (hasField("email")) {
    if (typeof body.email !== "string" || body.email.trim() === "" || !body.email.includes("@")) {
      return { ok: false, error: "Invalid email" };
    }
    data.email = body.email.trim();
  }

  if (hasField("phone")) {
    if (body.phone === null) {
      data.phone = null;
    } else if (typeof body.phone === "string") {
      const trimmed = body.phone.trim();
      data.phone = trimmed === "" ? null : trimmed;
    } else {
      return { ok: false, error: "Invalid phone" };
    }
  }

  if (hasField("summary")) {
    if (typeof body.summary !== "string" || body.summary.trim() === "") {
      return { ok: false, error: "Invalid summary" };
    }
    data.summary = body.summary.trim();
  }

  if (hasField("experience")) {
    const parsed = parseStringArray(body.experience);
    if (!parsed) {
      return { ok: false, error: "Invalid experience" };
    }
    data.experience = asInputJson(parsed);
  }

  if (hasField("goals")) {
    const parsed = parseStringArray(body.goals);
    if (!parsed) {
      return { ok: false, error: "Invalid goals" };
    }
    data.goals = asInputJson(parsed);
  }

  if (hasField("skills")) {
    if (typeof body.skills !== "object" || body.skills === null || Array.isArray(body.skills)) {
      return { ok: false, error: "Invalid skills" };
    }
    const skills = body.skills as { strong?: unknown; growth?: unknown };
    const strong = parseStringArray(skills.strong);
    const growth = parseStringArray(skills.growth);
    if (!strong || !growth) {
      return { ok: false, error: "Invalid skills" };
    }
    data.skills = asInputJson({ strong, growth });
  }

  return { ok: true, data };
}

function serializeContactPreview(preview: ContactPreview) {
  return {
    fullName: preview.fullName,
    email: preview.email,
    phone: preview.phone,
  };
}

function resolveContactPreview(
  history: CandidatePrepHistoryItem[],
  profile: {
    fullName: string;
    email: string;
    phone: string | null;
  } | null,
  fallbackEmail?: string | null,
): ContactPreview {
  if (profile) {
    return {
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
    };
  }
  return extractContactPreviewFromHistory(history, fallbackEmail);
}

export function createCandidatePrepRouter(
  getPrisma: () => PrismaClient,
  getProvider: () => LlmProvider
): Router {
  const router = Router();

  router.get("/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(200).json({
        messages: [],
        isClosed: false,
        profile: null,
        contactPreview: serializeContactPreview(
          extractContactPreviewFromHistory([], req.user?.email ?? null),
        ),
      });
      return;
    }

    const messages = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const profile = session.isClosed
      ? await prisma.candidateProfile.findUnique({ where: { interviewId } })
      : null;


    const history = messages.map((item) => ({
      authorType: item.authorType,
      content: item.content,
    }));
    const contactPreview = resolveContactPreview(
      history,
      profile,
      req.user?.email ?? null,
    );

    res.status(200).json({
      messages: messages.map((item) => ({
        id: item.id,
        authorType: item.authorType,
        content: item.content,
        createdAt: item.createdAt,
      })),
      isClosed: session.isClosed,
      profile: profile ? serializeCandidateProfile(profile) : null,
      contactPreview: serializeContactPreview(contactPreview),
    });
  });

  router.post("/:interviewId/message", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const body = (req.body ?? {}) as MessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.upsert({
      where: { interviewId },
      update: {},
      create: { interviewId },
    });

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    if (message) {
      await prisma.prepMessageCandidate.create({
        data: { sessionId: session.id, authorType: "HUMAN_CANDIDATE", content: message },
      });
    }

    const history = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const historyItems = history.map((item) => ({ authorType: item.authorType, content: item.content }));
    const knownContact = extractContactPreviewFromHistory(historyItems, req.user?.email ?? null);

    const llmMessages = buildCandidateAgentMessages(historyItems, {
      candidateFirstName: knownContact.fullName,
    });

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[candidate-prep:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[candidate-prep:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[candidate-prep:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    const { message: agentMessage, readyForConfirmation } = parseAgentReply(rawReply);

    try {
      await prisma.prepMessageCandidate.create({
        data: { sessionId: session.id, authorType: "AGENT_CANDIDATE", content: agentMessage },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep] failed to persist agent reply:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    const updatedHistory = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    const contactPreview = resolveContactPreview(
      updatedHistory.map((item) => ({ authorType: item.authorType, content: item.content })),
      null,
      req.user?.email ?? null,
    );

    res.status(200).json({
      message: agentMessage,
      readyForConfirmation,
      contactPreview: serializeContactPreview(contactPreview),
    });
  });

  router.post("/:interviewId/finish", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(404).json({ error: "Prep session not found" });
      return;
    }

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    const history = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCandidateProfileExtractionMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[candidate-prep:finish:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[candidate-prep:finish:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[candidate-prep:finish:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    const fallbackEmail = req.user?.email?.trim().toLowerCase() ?? "";

    let parseInput = rawReply;
    const trimmedRaw = rawReply.trim();
    const withoutFences = trimmedRaw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)?.[1] ?? trimmedRaw;
    try {
      const rawData = JSON.parse(withoutFences);
      if (typeof rawData === "object" && rawData !== null) {
        const rawEmail = String((rawData as Record<string, unknown>).email ?? "")
          .trim()
          .toLowerCase();
        if (!rawEmail && fallbackEmail) {
          (rawData as Record<string, unknown>).email = fallbackEmail;
          parseInput = JSON.stringify(rawData);
        }
      }
    } catch {
      // keep original rawReply; parseCandidateProfileExtraction handles invalid JSON
    }

    let extracted;
    try {
      extracted = parseCandidateProfileExtraction(parseInput);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] failed to parse profile extraction:", detail);
      if (detail.includes("email") && !fallbackEmail) {
        res.status(502).json({ error: "LLM unavailable", detail: "missing email for candidate profile" });
        return;
      }
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    const normalizedExtractedEmail = extracted.email.trim().toLowerCase();
    const persistedEmail = normalizedExtractedEmail || fallbackEmail;

    if (!persistedEmail) {
      res.status(502).json({ error: "LLM unavailable", detail: "missing email for candidate profile" });
      return;
    }

    let profile;
    try {
      profile = await prisma.candidateProfile.upsert({
        where: { interviewId },
        update: {
          fullName: extracted.fullName,
          email: persistedEmail,
          phone: extracted.phone,
          experience: extracted.experience,
          skills: extracted.skills,
          goals: extracted.goals,
          summary: extracted.summary,
        },
        create: {
          interviewId,
          fullName: extracted.fullName,
          email: persistedEmail,
          phone: extracted.phone,
          experience: extracted.experience,
          skills: extracted.skills,
          goals: extracted.goals,
          summary: extracted.summary,
        },
      });
      await prisma.prepSessionCandidate.update({
        where: { id: session.id },
        data: { isClosed: true },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] failed to persist profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: serializeCandidateProfile(profile),
    });
  });

  router.post("/:interviewId/confirm", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const profile = await prisma.candidateProfile.findUnique({ where: { interviewId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (profile.confirmedAt) {
      res.status(409).json({ error: "Profile already confirmed" });
      return;
    }

    let updatedProfile;
    try {
      updatedProfile = await prisma.candidateProfile.update({
        where: { interviewId },
        data: { confirmedAt: new Date() },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:confirm] failed to confirm profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }


    const finalInterview = (await maybeTransitionToReady(prisma, interviewId)) ?? interview;

    res.status(200).json({
      profile: serializeCandidateProfile(updatedProfile),
      interviewStatus: finalInterview.status,
    });
  });

  router.patch("/:interviewId/profile", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const profile = await prisma.candidateProfile.findUnique({ where: { interviewId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (profile.confirmedAt) {
      res.status(409).json({ error: "Profile already confirmed" });
      return;
    }

    const parsed = parseCandidateProfilePatch((req.body ?? {}) as ProfilePatchBody);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    let updatedProfile;
    try {
      updatedProfile = await prisma.candidateProfile.update({
        where: { interviewId },
        data: parsed.data,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:patch-profile] failed to update profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ profile: serializeCandidateProfile(updatedProfile) });
  });

  router.delete("/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    try {
      const existingProfile = await prisma.candidateProfile.findUnique({ where: { interviewId } });
      const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
      if (session) {
        await prisma.prepMessageCandidate.deleteMany({ where: { sessionId: session.id } });
        await prisma.prepSessionCandidate.delete({ where: { id: session.id } });
      }
      await prisma.candidateProfile.deleteMany({ where: { interviewId } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:delete] failed to reset prep chat:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ ok: true });
  });

  return router;
}

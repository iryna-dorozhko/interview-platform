import { Router, type Request, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildCompanyProfileAgentMessages,
  buildHrCompanyProfileExtractionMessages,
  parseAgentReply,
  parseHrCompanyProfileExtraction,
} from "../agents/company-profile-agent";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type MessageBody = {
  message?: unknown;
};

type ProfilePatchBody = {
  culture?: unknown;
  companyDirection?: unknown;
  policies?: unknown;
  workFormat?: unknown;
  onboardingApproach?: unknown;
};

type HrCompanyProfileDto = {
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
  confirmedAt: string | null;
};

function toProfileDto(profile: {
  culture: unknown;
  companyDirection: unknown;
  policies: unknown;
  workFormat: unknown;
  onboardingApproach: unknown;
  confirmedAt: Date | null;
}): HrCompanyProfileDto {
  return {
    culture: profile.culture as string[],
    companyDirection: profile.companyDirection as string[],
    policies: profile.policies as string[],
    workFormat: profile.workFormat as string[],
    onboardingApproach: profile.onboardingApproach as string[],
    confirmedAt: profile.confirmedAt ? profile.confirmedAt.toISOString() : null,
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

function parseProfilePatch(
  body: ProfilePatchBody
): { ok: true; data: Prisma.HrCompanyProfileUpdateInput } | { ok: false; error: string } {
  const data: Prisma.HrCompanyProfileUpdateInput = {};
  const hasField = (field: keyof ProfilePatchBody) => Object.prototype.hasOwnProperty.call(body, field);

  if (!Object.keys(body).some((key) => hasField(key as keyof ProfilePatchBody))) {
    return { ok: false, error: "No fields to update" };
  }

  const arrayFields = [
    "culture",
    "companyDirection",
    "policies",
    "workFormat",
    "onboardingApproach",
  ] as const;

  for (const field of arrayFields) {
    if (!hasField(field)) {
      continue;
    }
    const parsed = parseStringArray(body[field]);
    if (!parsed) {
      return { ok: false, error: `Invalid ${field}` };
    }
    data[field] = asInputJson(parsed);
  }

  return { ok: true, data };
}

export function createCompanyPrepRouter(
  getPrisma: () => PrismaClient,
  getProvider: () => LlmProvider
): Router {
  const router = Router();

  router.get("/company-prep", async (req: Request, res: Response) => {
    const hrUserId = req.user?.id;
    if (!hrUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const prisma = getPrisma();
    const session = await prisma.prepSessionCompany.findUnique({ where: { hrUserId } });
    if (!session) {
      res.status(200).json({ messages: [], isClosed: false, profile: null });
      return;
    }

    const messages = await prisma.prepMessageCompany.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const profile = session.isClosed
      ? await prisma.hrCompanyProfile.findUnique({ where: { hrUserId } })
      : null;

    res.status(200).json({
      messages: messages.map((item) => ({
        id: item.id,
        authorType: item.authorType,
        content: item.content,
        createdAt: item.createdAt,
      })),
      isClosed: session.isClosed,
      profile: profile ? toProfileDto(profile) : null,
    });
  });

  router.post("/company-prep/finish", async (req: Request, res: Response) => {
    const hrUserId = req.user?.id;
    if (!hrUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const prisma = getPrisma();
    const session = await prisma.prepSessionCompany.findUnique({ where: { hrUserId } });
    if (!session) {
      res.status(404).json({ error: "Prep session not found" });
      return;
    }

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    const history = await prisma.prepMessageCompany.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildHrCompanyProfileExtractionMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep:finish] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[company-prep:finish:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[company-prep:finish:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[company-prep:finish:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let extracted;
    try {
      extracted = parseHrCompanyProfileExtraction(rawReply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep:finish] failed to parse profile extraction:", detail);
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    let profile;
    try {
      profile = await prisma.hrCompanyProfile.upsert({
        where: { hrUserId },
        update: {
          culture: extracted.culture,
          companyDirection: extracted.companyDirection,
          policies: extracted.policies,
          workFormat: extracted.workFormat,
          onboardingApproach: extracted.onboardingApproach,
        },
        create: {
          hrUserId,
          culture: extracted.culture,
          companyDirection: extracted.companyDirection,
          policies: extracted.policies,
          workFormat: extracted.workFormat,
          onboardingApproach: extracted.onboardingApproach,
        },
      });
      await prisma.prepSessionCompany.update({ where: { id: session.id }, data: { isClosed: true } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep:finish] failed to persist profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ profile: toProfileDto(profile) });
  });

  router.post("/company-prep/confirm", async (req: Request, res: Response) => {
    const hrUserId = req.user?.id;
    if (!hrUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const prisma = getPrisma();
    const profile = await prisma.hrCompanyProfile.findUnique({ where: { hrUserId } });
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
      updatedProfile = await prisma.hrCompanyProfile.update({
        where: { hrUserId },
        data: { confirmedAt: new Date() },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep:confirm] failed to confirm profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ profile: toProfileDto(updatedProfile) });
  });

  router.patch("/company-prep/profile", async (req: Request, res: Response) => {
    const hrUserId = req.user?.id;
    if (!hrUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const prisma = getPrisma();
    const profile = await prisma.hrCompanyProfile.findUnique({ where: { hrUserId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (profile.confirmedAt) {
      res.status(409).json({ error: "Profile already confirmed" });
      return;
    }

    const parsed = parseProfilePatch((req.body ?? {}) as ProfilePatchBody);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    let updatedProfile;
    try {
      updatedProfile = await prisma.hrCompanyProfile.update({
        where: { hrUserId },
        data: parsed.data,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep:patch-profile] failed to update profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ profile: toProfileDto(updatedProfile) });
  });

  router.post("/company-prep/message", async (req: Request, res: Response) => {
    const hrUserId = req.user?.id;
    if (!hrUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req.body ?? {}) as MessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const prisma = getPrisma();

    const session = await prisma.prepSessionCompany.upsert({
      where: { hrUserId },
      update: {},
      create: { hrUserId },
    });

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    if (message) {
      await prisma.prepMessageCompany.create({
        data: { sessionId: session.id, authorType: "HUMAN_HR", content: message },
      });
    }

    const history = await prisma.prepMessageCompany.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCompanyProfileAgentMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[company-prep:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[company-prep:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[company-prep:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    const { message: agentMessage, readyForConfirmation } = parseAgentReply(rawReply);

    try {
      await prisma.prepMessageCompany.create({
        data: { sessionId: session.id, authorType: "AGENT_COMPANY", content: agentMessage },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep] failed to persist agent reply:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ message: agentMessage, readyForConfirmation });
  });

  router.delete("/company-prep", async (req: Request, res: Response) => {
    const hrUserId = req.user?.id;
    if (!hrUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const prisma = getPrisma();
    const existingProfile = await prisma.hrCompanyProfile.findUnique({ where: { hrUserId } });
    if (existingProfile?.confirmedAt) {
      res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
      return;
    }

    try {
      const session = await prisma.prepSessionCompany.findUnique({ where: { hrUserId } });
      if (session) {
        await prisma.prepMessageCompany.deleteMany({ where: { sessionId: session.id } });
        await prisma.prepSessionCompany.delete({ where: { id: session.id } });
      }
      await prisma.hrCompanyProfile.deleteMany({ where: { hrUserId } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[company-prep:delete] failed to reset prep chat:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ ok: true });
  });

  return router;
}

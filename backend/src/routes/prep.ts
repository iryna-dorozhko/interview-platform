import { Router, type Request, type Response } from "express";
import type { CompanyProfile, HrCompanyProfile, Prisma, PrismaClient } from "@prisma/client";
import {
  buildCompanyAgentMessages,
  buildProfileExtractionMessages,
  parseAgentReply,
  parseVacancyProfileExtraction,
} from "../agents/company-agent";
import { LlmError } from "../llm/errors";
import { toSafeLlmErrorMessage, withLlmRetry } from "../llm/retry";
import type { LlmProvider } from "../llm/types";
import { parseVacancyCompensation, parseWorkConditionsArray } from "../utils/vacancy-work-conditions";
import {
  assertNonEmptyRequirements,
  normalizeVacancyRequirements,
} from "../utils/vacancy-requirements";

const BLOCKING_INTERVIEW_STATUSES = ["READY", "LIVE"] as const;

export async function vacancyHasBlockingInterviews(
  prisma: PrismaClient,
  vacancyId: string
): Promise<boolean> {
  const found = await prisma.interview.findFirst({
    where: {
      vacancyId,
      status: { in: [...BLOCKING_INTERVIEW_STATUSES] },
    },
    select: { id: true },
  });
  return found != null;
}

function llmHttpStatus(error: unknown): number {
  if (error instanceof LlmError && error.code === "empty_response") return 502;
  if (error instanceof Error && error.name.endsWith("ExtractionError")) return 502;
  return 503;
}

type MessageBody = {
  message?: unknown;
};

type ProfilePatchBody = {
  role?: unknown;
  requirements?: unknown;
  expectations?: unknown;
  culture?: unknown;
  companyDirection?: unknown;
  policies?: unknown;
  workFormat?: unknown;
  onboardingApproach?: unknown;
  workConditions?: unknown;
  compensation?: unknown;
};

function serializeVacancyProfile(profile: CompanyProfile) {
  const requirements =
    normalizeVacancyRequirements(profile.requirements) ?? { critical: [], desired: [] };
  return {
    role: profile.role,
    requirements,
    expectations: profile.expectations as string[],
    culture: profile.culture as string[],
    companyDirection: (profile.companyDirection as string[] | null) ?? [],
    policies: (profile.policies as string[] | null) ?? [],
    workFormat: (profile.workFormat as string[] | null) ?? [],
    onboardingApproach: (profile.onboardingApproach as string[] | null) ?? [],
    workConditions: parseWorkConditionsArray(profile.workConditions),
    compensation: parseVacancyCompensation(profile.compensation),
    confirmedAt: profile.confirmedAt,
  };
}

export async function assertConfirmedHrCompanyProfile(
  req: Request,
  res: Response,
  prisma: PrismaClient
): Promise<HrCompanyProfile | null> {
  const hrUserId = req.user?.id;
  if (!hrUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const hrProfile = await prisma.hrCompanyProfile.findUnique({ where: { hrUserId } });
  if (!hrProfile?.confirmedAt) {
    res.status(409).json({ error: "Company profile is not confirmed" });
    return null;
  }

  return hrProfile;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const items = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (items.some((item) => item === "")) {
    return null;
  }

  return items;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parseProfilePatch(
  body: ProfilePatchBody
): { ok: true; data: Prisma.CompanyProfileUpdateInput } | { ok: false; error: string } {
  const data: Prisma.CompanyProfileUpdateInput = {};
  const hasField = (field: keyof ProfilePatchBody) => Object.prototype.hasOwnProperty.call(body, field);

  if (!Object.keys(body).some((key) => hasField(key as keyof ProfilePatchBody))) {
    return { ok: false, error: "No fields to update" };
  }

  if (hasField("role")) {
    if (typeof body.role !== "string" || body.role.trim() === "") {
      return { ok: false, error: "Invalid role" };
    }
    data.role = body.role.trim();
  }

  const arrayFields = [
    "expectations",
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
    data[field] = parsed;
  }

  if (hasField("requirements")) {
    const parsed = normalizeVacancyRequirements(body.requirements);
    if (!parsed || !assertNonEmptyRequirements(parsed)) {
      return { ok: false, error: "Invalid requirements" };
    }
    data.requirements = asInputJson(parsed);
  }

  if (hasField("workConditions")) {
    const parsed = parseStringArray(body.workConditions);
    if (!parsed) return { ok: false, error: "Invalid workConditions" };
    data.workConditions = parsed;
  }

  if (hasField("compensation")) {
    const parsed = parseVacancyCompensation(body.compensation);
    if (!parsed) return { ok: false, error: "Invalid compensation" };
    data.compensation = asInputJson(parsed);
  }

  return { ok: true, data };
}

export function createPrepRouter(
  getPrisma: () => PrismaClient,
  getProvider: () => LlmProvider
): Router {
  const router = Router();

  router.get("/prep/:vacancyId", async (req: Request, res: Response) => {
    const { vacancyId } = req.params;
    const prisma = getPrisma();

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const canEditProfile = !(await vacancyHasBlockingInterviews(prisma, vacancyId));

    const hrCompanyProfile = await prisma.hrCompanyProfile.findUnique({
      where: { hrUserId: req.user!.id },
    });
    const missingCompanyProfile = !hrCompanyProfile?.confirmedAt;

    const session = await prisma.prepSessionHr.findUnique({ where: { vacancyId } });
    if (!session) {
      res.status(200).json({
        messages: [],
        isClosed: false,
        profile: null,
        missingCompanyProfile,
        canEditProfile,
      });
      return;
    }

    const messages = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const profile = session.isClosed
      ? await prisma.companyProfile.findUnique({ where: { vacancyId } })
      : null;

    res.status(200).json({
      messages: messages.map((item) => ({
        id: item.id,
        authorType: item.authorType,
        content: item.content,
        createdAt: item.createdAt,
      })),
      isClosed: session.isClosed,
      profile: profile ? serializeVacancyProfile(profile) : null,
      missingCompanyProfile,
      canEditProfile,
    });
  });

  router.post("/prep/:vacancyId/finish", async (req: Request, res: Response) => {
    const { vacancyId } = req.params;
    const prisma = getPrisma();

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const hrProfile = await assertConfirmedHrCompanyProfile(req, res, prisma);
    if (!hrProfile) {
      return;
    }

    const session = await prisma.prepSessionHr.findUnique({ where: { vacancyId } });
    if (!session) {
      res.status(404).json({ error: "Prep session not found" });
      return;
    }

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    const history = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildProfileExtractionMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] provider init failed:", detail);
      res.status(503).json({ error: toSafeLlmErrorMessage(error) });
      return;
    }

    let extracted;
    try {
      extracted = await withLlmRetry(async () => {
        const rawReply = await provider.complete(llmMessages);
        return parseVacancyProfileExtraction(rawReply);
      }, { label: "prep:finish" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[prep:finish:${provider.name}] llm failed:`, detail);
      res.status(llmHttpStatus(error)).json({ error: toSafeLlmErrorMessage(error) });
      return;
    }

    const snapshotFields = {
      culture: asInputJson(hrProfile.culture),
      companyDirection: asInputJson(hrProfile.companyDirection),
      policies: asInputJson(hrProfile.policies),
      workFormat: asInputJson(hrProfile.workFormat),
      onboardingApproach: asInputJson(hrProfile.onboardingApproach),
    };

    let profile;
    try {
      profile = await prisma.companyProfile.upsert({
        where: { vacancyId },
        update: {
          role: extracted.role,
          requirements: asInputJson(extracted.requirements),
          expectations: extracted.expectations,
          workConditions: extracted.workConditions,
          compensation: asInputJson(extracted.compensation),
          ...snapshotFields,
        },
        create: {
          vacancyId,
          role: extracted.role,
          requirements: asInputJson(extracted.requirements),
          expectations: extracted.expectations,
          workConditions: extracted.workConditions,
          compensation: asInputJson(extracted.compensation),
          ...snapshotFields,
        },
      });
      await prisma.prepSessionHr.update({ where: { id: session.id }, data: { isClosed: true } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] failed to persist profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ profile: serializeVacancyProfile(profile) });
  });

  router.post("/prep/:vacancyId/confirm", async (req: Request, res: Response) => {
    const { vacancyId } = req.params;
    const prisma = getPrisma();

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const hrProfile = await assertConfirmedHrCompanyProfile(req, res, prisma);
    if (!hrProfile) {
      return;
    }

    const profile = await prisma.companyProfile.findUnique({ where: { vacancyId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (profile.confirmedAt) {
      res.status(409).json({ error: "Profile already confirmed" });
      return;
    }

    const requirements = normalizeVacancyRequirements(profile.requirements);
    if (!requirements || !assertNonEmptyRequirements(requirements)) {
      res.status(400).json({ error: "Invalid requirements" });
      return;
    }

    let updatedProfile;
    let vacancyStatus = vacancy.status;
    try {
      updatedProfile = await prisma.companyProfile.update({
        where: { vacancyId },
        data: { confirmedAt: new Date() },
      });

      if (vacancy.status === "DRAFT") {
        await prisma.vacancy.update({
          where: { id: vacancyId },
          data: { status: "CONFIRMED" },
        });
        vacancyStatus = "CONFIRMED";
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:confirm] failed to confirm profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: serializeVacancyProfile(updatedProfile),
      vacancyStatus,
    });
  });

  router.patch("/prep/:vacancyId/profile", async (req: Request, res: Response) => {
    const { vacancyId } = req.params;
    const prisma = getPrisma();

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const profile = await prisma.companyProfile.findUnique({ where: { vacancyId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (profile.confirmedAt) {
      if (await vacancyHasBlockingInterviews(prisma, vacancyId)) {
        res.status(409).json({ error: "Vacancy has active interviews" });
        return;
      }
    }

    const parsed = parseProfilePatch((req.body ?? {}) as ProfilePatchBody);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const wasConfirmed = profile.confirmedAt != null;
    let updatedProfile;
    try {
      updatedProfile = await prisma.companyProfile.update({
        where: { vacancyId },
        data: {
          ...parsed.data,
          ...(wasConfirmed ? { confirmedAt: new Date() } : {}),
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:patch-profile] failed to update profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ profile: serializeVacancyProfile(updatedProfile) });
  });

  router.post("/prep/:vacancyId/message", async (req: Request, res: Response) => {
    const { vacancyId } = req.params;
    const body = (req.body ?? {}) as MessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    const prisma = getPrisma();

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const hrProfile = await assertConfirmedHrCompanyProfile(req, res, prisma);
    if (!hrProfile) {
      return;
    }

    const session = await prisma.prepSessionHr.upsert({
      where: { vacancyId },
      update: {},
      create: { vacancyId },
    });

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    if (message) {
      await prisma.prepMessageHr.create({
        data: { sessionId: session.id, authorType: "HUMAN_HR", content: message },
      });
    }

    const history = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCompanyAgentMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep] provider init failed:", detail);
      res.status(503).json({ error: toSafeLlmErrorMessage(error) });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await withLlmRetry(
        () => provider.complete(llmMessages),
        { label: "prep:message" },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[prep:${provider.name}] llm failed:`, detail);
      res.status(llmHttpStatus(error)).json({ error: toSafeLlmErrorMessage(error) });
      return;
    }

    const { message: agentMessage, readyForConfirmation } = parseAgentReply(rawReply);

    try {
      await prisma.prepMessageHr.create({
        data: { sessionId: session.id, authorType: "AGENT_COMPANY", content: agentMessage },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep] failed to persist agent reply:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ message: agentMessage, readyForConfirmation });
  });

  router.delete("/prep/:vacancyId", async (req: Request, res: Response) => {
    const { vacancyId } = req.params;
    const prisma = getPrisma();

    const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }

    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const existingProfile = await prisma.companyProfile.findUnique({ where: { vacancyId } });
    if (existingProfile?.confirmedAt) {
      res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
      return;
    }

    try {
      const session = await prisma.prepSessionHr.findUnique({ where: { vacancyId } });
      if (session) {
        await prisma.prepMessageHr.deleteMany({ where: { sessionId: session.id } });
        await prisma.prepSessionHr.delete({ where: { id: session.id } });
      }
      await prisma.companyProfile.deleteMany({ where: { vacancyId } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:delete] failed to reset prep chat:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ ok: true });
  });

  return router;
}

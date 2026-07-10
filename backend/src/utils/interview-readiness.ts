import type { Interview, PrismaClient } from "@prisma/client";
import { SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME } from "./candidate-interview-kind";

export const ACTIVE_CANDIDATE_INTERVIEW_STATUSES = ["AWAITING_CANDIDATE", "READY", "LIVE"] as const;

const NON_JOINABLE_INTERVIEW_STATUSES = ["LIVE", "ENDED"] as const;

type JoinCheckInterview = Pick<Interview, "id" | "status" | "candidateUserId">;

export type JoinCheckResult = { ok: true } | { ok: false; error: string };

async function findQuestionnaireInterview(prisma: PrismaClient, candidateUserId: string) {
  return prisma.interview.findFirst({
    where: {
      candidateUserId,
      displayName: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME,
      status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function isCandidateQuestionnaireConfirmed(
  prisma: PrismaClient,
  candidateUserId: string,
): Promise<boolean> {
  const questionnaire = await findQuestionnaireInterview(prisma, candidateUserId);
  if (!questionnaire) return false;

  const profile = await prisma.candidateProfile.findUnique({
    where: { interviewId: questionnaire.id },
  });
  return profile?.confirmedAt != null;
}

export async function canCandidateJoinInterview(
  prisma: PrismaClient,
  candidateUserId: string,
  interview: JoinCheckInterview,
): Promise<JoinCheckResult> {
  if (
    NON_JOINABLE_INTERVIEW_STATUSES.includes(
      interview.status as (typeof NON_JOINABLE_INTERVIEW_STATUSES)[number],
    )
  ) {
    return { ok: false, error: "Interview is not joinable" };
  }

  if (interview.candidateUserId && interview.candidateUserId !== candidateUserId) {
    return { ok: false, error: "Interview already taken" };
  }

  const existingActive = await prisma.interview.findFirst({
    where: {
      candidateUserId,
      status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
      displayName: { not: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME },
      NOT: { id: interview.id },
    },
  });

  if (existingActive) {
    return { ok: false, error: "Candidate already has active interview" };
  }

  const isRejoin = interview.candidateUserId === candidateUserId;
  if (!isRejoin) {
    const questionnaire = await findQuestionnaireInterview(prisma, candidateUserId);
    if (!questionnaire) {
      return { ok: false, error: "Candidate questionnaire required" };
    }

    const profile = await prisma.candidateProfile.findUnique({
      where: { interviewId: questionnaire.id },
    });
    if (!profile) {
      return { ok: false, error: "Candidate questionnaire required" };
    }
    if (profile.confirmedAt == null) {
      return { ok: false, error: "Candidate questionnaire not confirmed" };
    }
  }

  return { ok: true };
}

async function maybeTransitionHrInterviewToReady(
  prisma: PrismaClient,
  interviewId: string,
): Promise<Interview | null> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      vacancy: { include: { companyProfile: true } },
    },
  });

  if (!interview || interview.status !== "AWAITING_CANDIDATE") {
    return interview;
  }

  if (interview.displayName === SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME) {
    return interview;
  }

  const hrReady =
    interview.vacancy.status === "CONFIRMED" &&
    interview.vacancy.companyProfile?.confirmedAt != null;
  const candidateReady =
    interview.candidateUserId != null &&
    (await isCandidateQuestionnaireConfirmed(prisma, interview.candidateUserId));

  if (!hrReady || !candidateReady) {
    return interview;
  }

  return prisma.interview.update({
    where: { id: interviewId },
    data: { status: "READY" },
  });
}

export async function maybeTransitionToReady(
  prisma: PrismaClient,
  interviewId: string,
): Promise<Interview | null> {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
  if (!interview) return null;

  if (interview.displayName === SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME) {
    const candidateUserId = interview.candidateUserId;
    if (!candidateUserId) return interview;

    const hrInterview = await prisma.interview.findFirst({
      where: {
        candidateUserId,
        status: "AWAITING_CANDIDATE",
        displayName: { not: SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!hrInterview) return interview;
    return (await maybeTransitionHrInterviewToReady(prisma, hrInterview.id)) ?? interview;
  }

  return maybeTransitionHrInterviewToReady(prisma, interviewId);
}

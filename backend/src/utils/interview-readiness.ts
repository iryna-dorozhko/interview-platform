import type { Interview, PrismaClient } from "@prisma/client";

export const ACTIVE_CANDIDATE_INTERVIEW_STATUSES = ["AWAITING_CANDIDATE", "READY", "LIVE"] as const;

const NON_JOINABLE_INTERVIEW_STATUSES = ["LIVE", "ENDED"] as const;

type JoinCheckInterview = Pick<Interview, "id" | "status" | "candidateUserId">;

export type JoinCheckResult = { ok: true } | { ok: false; error: string };

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
      NOT: { id: interview.id },
    },
  });

  if (existingActive) {
    return { ok: false, error: "Candidate already has active interview" };
  }

  return { ok: true };
}

export async function maybeTransitionToReady(
  prisma: PrismaClient,
  interviewId: string,
): Promise<Interview | null> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      vacancy: { include: { companyProfile: true } },
      candidateProfile: true,
    },
  });

  if (!interview || interview.status !== "AWAITING_CANDIDATE") {
    return interview;
  }

  const hrReady =
    interview.vacancy.status === "CONFIRMED" &&
    interview.vacancy.companyProfile?.confirmedAt != null;
  const candidateReady =
    interview.candidateUserId != null && interview.candidateProfile?.confirmedAt != null;

  if (!hrReady || !candidateReady) {
    return interview;
  }

  return prisma.interview.update({
    where: { id: interviewId },
    data: { status: "READY" },
  });
}

export type InterviewDecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

export type TerminalApplicationStatus =
  | "DECLINED_BY_HR"
  | "ACCEPTED"
  | "ADDITIONAL_MEETING";

type ApplyTerminalTx = {
  vacancyApplication: {
    update: (args: {
      where: { id: string };
      data: { status: TerminalApplicationStatus };
    }) => Promise<unknown>;
  };
  vacancyOfferDecision: {
    upsert: (args: {
      where: {
        candidateUserId_vacancyId: {
          candidateUserId: string;
          vacancyId: string;
        };
      };
      create: {
        candidateUserId: string;
        vacancyId: string;
        decision: "REJECTED";
      };
      update: { decision: "REJECTED" };
    }) => Promise<unknown>;
  };
};

export function applicationStatusFromDecisionType(
  type: InterviewDecisionType,
): TerminalApplicationStatus {
  if (type === "ACCEPT") return "ACCEPTED";
  if (type === "ADDITIONAL_MEETING") return "ADDITIONAL_MEETING";
  return "DECLINED_BY_HR";
}

export async function applyTerminalApplicationStatus(
  tx: ApplyTerminalTx,
  input: {
    applicationId: string;
    candidateUserId: string;
    vacancyId: string;
    status: TerminalApplicationStatus;
  },
): Promise<void> {
  await tx.vacancyApplication.update({
    where: { id: input.applicationId },
    data: { status: input.status },
  });
  await tx.vacancyOfferDecision.upsert({
    where: {
      candidateUserId_vacancyId: {
        candidateUserId: input.candidateUserId,
        vacancyId: input.vacancyId,
      },
    },
    create: {
      candidateUserId: input.candidateUserId,
      vacancyId: input.vacancyId,
      decision: "REJECTED",
    },
    update: { decision: "REJECTED" },
  });
}

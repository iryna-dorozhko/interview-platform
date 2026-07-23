import type { InterviewDecisionType, Recommendation } from "@prisma/client";

const AGREED: Record<Recommendation, InterviewDecisionType> = {
  HIRE: "ACCEPT",
  REJECT: "REJECT",
  MAYBE: "ADDITIONAL_MEETING",
};

export function hrAgreedWithArbiter(
  recommendation: Recommendation,
  decision: InterviewDecisionType,
): boolean {
  return AGREED[recommendation] === decision;
}

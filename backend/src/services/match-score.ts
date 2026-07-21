export type RequirementStatus = "met" | "unknown" | "unmet";

export type RequirementAssessment = {
  requirement: string;
  priority: "critical" | "desired";
  status: RequirementStatus;
  evidence: string;
};

export type MatchBreakdown = {
  assessments: RequirementAssessment[];
  contextFit: number;
  criticalFit: number | null;
  desiredFit: number | null;
  requirementsFit: number | null;
  rawScore: number;
  cappedByCriticalUnmet: boolean;
  matchScore: number;
};

const STATUS_POINTS: Record<RequirementStatus, number> = {
  met: 100,
  unknown: 50,
  unmet: 0,
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeMatchScore(
  assessments: RequirementAssessment[],
  contextFit: number,
): MatchBreakdown {
  const critical = assessments.filter((item) => item.priority === "critical");
  const desired = assessments.filter((item) => item.priority === "desired");
  const criticalFit = average(critical.map((item) => STATUS_POINTS[item.status]));
  const desiredFit = average(desired.map((item) => STATUS_POINTS[item.status]));

  let requirementsFit: number | null = null;
  if (criticalFit != null && desiredFit != null) {
    requirementsFit = 0.75 * criticalFit + 0.25 * desiredFit;
  } else if (criticalFit != null) {
    requirementsFit = criticalFit;
  } else if (desiredFit != null) {
    requirementsFit = desiredFit;
  }

  const rawScore =
    requirementsFit == null ? contextFit : 0.8 * requirementsFit + 0.2 * contextFit;
  const cappedByCriticalUnmet = critical.some((item) => item.status === "unmet");
  const matchScore = clampScore(cappedByCriticalUnmet ? Math.min(rawScore, 69) : rawScore);

  return {
    assessments,
    contextFit,
    criticalFit,
    desiredFit,
    requirementsFit,
    rawScore,
    cappedByCriticalUnmet,
    matchScore,
  };
}

import type {
  InterviewDecisionType,
  PrismaClient,
  Recommendation,
} from "@prisma/client";
import { hrAgreedWithArbiter } from "./interview-eval-agreement";
import {
  clearCounters,
  getCounters,
  type InterviewEvalRuntimeCounters,
} from "./interview-eval-counters";
import { liveDurationMs, prepDurationMs } from "./interview-eval-durations";

export type EvalSnapshotRow = {
  interviewId: string;
  prepCandidateDurationMs: number | null;
  prepVacancyDurationMs: number | null;
  liveDurationMs: number | null;
  autoRetryCount: number;
  manualRetryCount: number;
  hrMessageCount: number;
  hrControlActionCount: number;
  clarifyingQuestionCount: number;
  agentMessageCount: number;
  finalMatchScore: number | null;
  arbiterRecommendation: Recommendation | null;
  hrDecisionType: InterviewDecisionType | null;
  hrAgreedWithArbiter: boolean | null;
  reportCreatedAt: Date | null;
  decisionUpdatedAt: Date | null;
};

export type EvalSummary = {
  snapshotCount: number;
  withDecisionCount: number;
  avgPrepCandidateDurationMs: number | null;
  avgPrepVacancyDurationMs: number | null;
  avgLiveDurationMs: number | null;
  avgAutoRetryCount: number;
  avgManualRetryCount: number;
  avgHrMessageCount: number;
  avgHrControlActionCount: number;
  clarifyingRate: number;
  avgFinalMatchScore: number | null;
  agreementRate: number | null;
};

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const AGENT_TYPES = ["AGENT_ARBITER", "AGENT_COMPANY", "AGENT_CANDIDATE"] as const;

export function summarizeEvalSnapshots(
  snapshots: Array<{
    prepCandidateDurationMs: number | null;
    prepVacancyDurationMs: number | null;
    liveDurationMs: number | null;
    autoRetryCount: number;
    manualRetryCount: number;
    hrMessageCount: number;
    hrControlActionCount: number;
    clarifyingQuestionCount: number;
    agentMessageCount: number;
    finalMatchScore: number | null;
    hrAgreedWithArbiter: boolean | null;
  }>,
): EvalSummary {
  const snapshotCount = snapshots.length;
  const withDecision = snapshots.filter((s) => s.hrAgreedWithArbiter !== null);
  const agreed = withDecision.filter((s) => s.hrAgreedWithArbiter === true);
  const clarifyingSum = snapshots.reduce((n, s) => n + s.clarifyingQuestionCount, 0);
  const agentSum = snapshots.reduce((n, s) => n + s.agentMessageCount, 0);

  return {
    snapshotCount,
    withDecisionCount: withDecision.length,
    avgPrepCandidateDurationMs: avg(
      snapshots
        .map((s) => s.prepCandidateDurationMs)
        .filter((n): n is number => n != null),
    ),
    avgPrepVacancyDurationMs: avg(
      snapshots
        .map((s) => s.prepVacancyDurationMs)
        .filter((n): n is number => n != null),
    ),
    avgLiveDurationMs: avg(
      snapshots.map((s) => s.liveDurationMs).filter((n): n is number => n != null),
    ),
    avgAutoRetryCount: avg(snapshots.map((s) => s.autoRetryCount)) ?? 0,
    avgManualRetryCount: avg(snapshots.map((s) => s.manualRetryCount)) ?? 0,
    avgHrMessageCount: avg(snapshots.map((s) => s.hrMessageCount)) ?? 0,
    avgHrControlActionCount: avg(snapshots.map((s) => s.hrControlActionCount)) ?? 0,
    clarifyingRate: agentSum === 0 ? 0 : clarifyingSum / agentSum,
    avgFinalMatchScore: avg(
      snapshots.map((s) => s.finalMatchScore).filter((n): n is number => n != null),
    ),
    agreementRate:
      withDecision.length === 0 ? null : agreed.length / withDecision.length,
  };
}

export async function upsertEvalAfterReport(
  prisma: PrismaClient,
  interviewId: string,
): Promise<void> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      prepSessionCd: true,
      liveSession: true,
      finalReport: true,
      vacancy: { include: { prepSessionHr: true } },
    },
  });

  if (!interview?.finalReport) return;

  const sessionId = interview.liveSession?.id;
  const hrMessageCount = sessionId
    ? await prisma.liveMessage.count({
        where: { sessionId, authorType: "HUMAN_HR" },
      })
    : 0;
  const dbAgentCount = sessionId
    ? await prisma.liveMessage.count({
        where: { sessionId, authorType: { in: [...AGENT_TYPES] } },
      })
    : 0;

  const runtime: InterviewEvalRuntimeCounters = getCounters(interviewId);
  const agentMessageCount = Math.max(dbAgentCount, runtime.agentMessageCount);

  const data = {
    prepCandidateDurationMs: prepDurationMs(interview.prepSessionCd),
    prepVacancyDurationMs: prepDurationMs(interview.vacancy.prepSessionHr),
    liveDurationMs: liveDurationMs(interview.liveSession),
    autoRetryCount: runtime.autoRetryCount,
    manualRetryCount: runtime.manualRetryCount,
    hrMessageCount,
    hrControlActionCount: runtime.hrControlActionCount,
    clarifyingQuestionCount: runtime.clarifyingQuestionCount,
    agentMessageCount,
    finalMatchScore: interview.finalReport.matchScore,
    arbiterRecommendation: interview.finalReport.recommendation,
    reportCreatedAt: interview.finalReport.createdAt,
  };

  await prisma.interviewEvalSnapshot.upsert({
    where: { interviewId },
    create: {
      interviewId,
      ...data,
      hrDecisionType: null,
      hrAgreedWithArbiter: null,
      decisionUpdatedAt: null,
    },
    update: {
      ...data,
    },
  });

  clearCounters(interviewId);
}

export async function updateEvalAfterDecision(
  prisma: PrismaClient,
  interviewId: string,
): Promise<void> {
  const decision = await prisma.interviewDecision.findFirst({
    where: { interviewId },
    orderBy: { createdAt: "desc" },
  });
  if (!decision) return;

  const report = await prisma.finalReport.findUnique({
    where: { interviewId },
  });
  if (!report) return;

  const agreed = hrAgreedWithArbiter(report.recommendation, decision.type);

  await prisma.interviewEvalSnapshot.upsert({
    where: { interviewId },
    create: {
      interviewId,
      finalMatchScore: report.matchScore,
      arbiterRecommendation: report.recommendation,
      reportCreatedAt: report.createdAt,
      hrDecisionType: decision.type,
      hrAgreedWithArbiter: agreed,
      decisionUpdatedAt: new Date(),
    },
    update: {
      hrDecisionType: decision.type,
      hrAgreedWithArbiter: agreed,
      decisionUpdatedAt: new Date(),
    },
  });
}

export async function listEvalSnapshots(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<EvalSnapshotRow[]> {
  const rows = await prisma.interviewEvalSnapshot.findMany({
    where: {
      reportCreatedAt: {
        gte: from,
        lt: to,
      },
    },
    orderBy: { reportCreatedAt: "asc" },
  });
  return rows.map((row) => ({
    interviewId: row.interviewId,
    prepCandidateDurationMs: row.prepCandidateDurationMs,
    prepVacancyDurationMs: row.prepVacancyDurationMs,
    liveDurationMs: row.liveDurationMs,
    autoRetryCount: row.autoRetryCount,
    manualRetryCount: row.manualRetryCount,
    hrMessageCount: row.hrMessageCount,
    hrControlActionCount: row.hrControlActionCount,
    clarifyingQuestionCount: row.clarifyingQuestionCount,
    agentMessageCount: row.agentMessageCount,
    finalMatchScore: row.finalMatchScore,
    arbiterRecommendation: row.arbiterRecommendation,
    hrDecisionType: row.hrDecisionType,
    hrAgreedWithArbiter: row.hrAgreedWithArbiter,
    reportCreatedAt: row.reportCreatedAt,
    decisionUpdatedAt: row.decisionUpdatedAt,
  }));
}

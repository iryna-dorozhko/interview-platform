export type InterviewEvalRuntimeCounters = {
  autoRetryCount: number;
  manualRetryCount: number;
  hrControlActionCount: number;
  clarifyingQuestionCount: number;
  agentMessageCount: number;
};

const ZERO: InterviewEvalRuntimeCounters = {
  autoRetryCount: 0,
  manualRetryCount: 0,
  hrControlActionCount: 0,
  clarifyingQuestionCount: 0,
  agentMessageCount: 0,
};

const store = new Map<string, InterviewEvalRuntimeCounters>();

function entry(interviewId: string): InterviewEvalRuntimeCounters {
  let current = store.get(interviewId);
  if (!current) {
    current = { ...ZERO };
    store.set(interviewId, current);
  }
  return current;
}

export function bumpAutoRetry(interviewId: string): void {
  entry(interviewId).autoRetryCount += 1;
}

export function bumpManualRetry(interviewId: string): void {
  entry(interviewId).manualRetryCount += 1;
}

export function bumpHrControl(interviewId: string): void {
  entry(interviewId).hrControlActionCount += 1;
}

export function bumpAgentMessage(
  interviewId: string,
  kind: "clarifying" | "normal",
): void {
  const counters = entry(interviewId);
  counters.agentMessageCount += 1;
  if (kind === "clarifying") {
    counters.clarifyingQuestionCount += 1;
  }
}

export function getCounters(interviewId: string): InterviewEvalRuntimeCounters {
  const current = store.get(interviewId);
  return current ? { ...current } : { ...ZERO };
}

export function clearCounters(interviewId: string): void {
  store.delete(interviewId);
}

export function resetAllEvalCounters(): void {
  store.clear();
}

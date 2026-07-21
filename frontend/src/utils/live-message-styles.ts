import type { CandidateConfidence } from "../composables/useInterviewRoom";

export type LiveAuthorType =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

type BubbleStyle = { background: string; color: string };
type LabelStyle = { background: string; color: string };

const STYLES: Record<
  LiveAuthorType,
  { label: string; accent: BubbleStyle; labelStyle: LabelStyle }
> = {
  HUMAN_HR: {
    label: "HR",
    accent: { background: "#eff6ff", color: "#2563eb" },
    labelStyle: { background: "#dbeafe", color: "#1d4ed8" },
  },
  HUMAN_CANDIDATE: {
    label: "Кандидат",
    accent: { background: "#ecfdf5", color: "#059669" },
    labelStyle: { background: "#d1fae5", color: "#047857" },
  },
  AGENT_ARBITER: {
    label: "Arbiter",
    accent: { background: "#f5f3ff", color: "#7c3aed" },
    labelStyle: { background: "#ede9fe", color: "#6d28d9" },
  },
  AGENT_COMPANY: {
    label: "Компанія (АІ)",
    accent: { background: "#fff7ed", color: "#ea580c" },
    labelStyle: { background: "#ffedd5", color: "#c2410c" },
  },
  AGENT_CANDIDATE: {
    label: "Кандидат (AI)",
    accent: { background: "#f0f9ff", color: "#0284c7" },
    labelStyle: { background: "#e0f2fe", color: "#0369a1" },
  },
};

export function labelFor(authorType: LiveAuthorType): string {
  return STYLES[authorType]?.label ?? "Учасник";
}

export function isOwnMessage(
  authorType: LiveAuthorType,
  currentRole: "HR" | "CANDIDATE",
): boolean {
  return (
    (currentRole === "HR" && authorType === "HUMAN_HR") ||
    (currentRole === "CANDIDATE" && authorType === "HUMAN_CANDIDATE")
  );
}

export function messageStyles(
  authorType: LiveAuthorType,
  currentRole: "HR" | "CANDIDATE",
): { bubble: BubbleStyle; label: LabelStyle; own: boolean } {
  const own = isOwnMessage(authorType, currentRole);
  const config = STYLES[authorType] ?? STYLES.HUMAN_HR;

  return {
    bubble: config.accent,
    label: config.labelStyle,
    own,
  };
}

const CONFIDENCE_BADGES: Record<
  CandidateConfidence,
  { label: string; background: string; color: string }
> = {
  CONFIRMED: { label: "З профілю", background: "#d1fae5", color: "#047857" },
  INFERRED: { label: "Висновок", background: "#fef3c7", color: "#d97706" },
  UNKNOWN: { label: "Потрібна відповідь", background: "#ffedd5", color: "#c2410c" },
};

export function confidenceBadgeFor(
  authorType: LiveAuthorType,
  confidence?: CandidateConfidence | null,
): { label: string; background: string; color: string } | null {
  if (authorType !== "AGENT_CANDIDATE" || !confidence) return null;
  return CONFIDENCE_BADGES[confidence] ?? null;
}

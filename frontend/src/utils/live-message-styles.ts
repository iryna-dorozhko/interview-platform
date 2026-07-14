export type LiveAuthorType =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

type BubbleStyle = { background: string; color: string };
type LabelStyle = { background: string; color: string };

const NEUTRAL_BUBBLE: BubbleStyle = { background: "#f3f4f6", color: "#111827" };

const STYLES: Record<
  LiveAuthorType,
  { label: string; accent: BubbleStyle; labelStyle: LabelStyle }
> = {
  HUMAN_HR: {
    label: "HR",
    accent: { background: "#ecfdf5", color: "#115e59" },
    labelStyle: { background: "#ecfdf5", color: "#0f766e" },
  },
  HUMAN_CANDIDATE: {
    label: "Кандидат",
    accent: { background: "#f0fdfa", color: "#134e4a" },
    labelStyle: { background: "#f0fdfa", color: "#0f766e" },
  },
  AGENT_ARBITER: {
    label: "Arbiter",
    accent: { background: "#f3f4f6", color: "#374151" },
    labelStyle: { background: "#e5e7eb", color: "#374151" },
  },
  AGENT_COMPANY: {
    label: "Компанія",
    accent: { background: "#ecfdf5", color: "#0f766e" },
    labelStyle: { background: "#d1fae5", color: "#065f46" },
  },
  AGENT_CANDIDATE: {
    label: "Кандидат (AI)",
    accent: { background: "#f0fdfa", color: "#115e59" },
    labelStyle: { background: "#ccfbf1", color: "#0f766e" },
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

  if (authorType.startsWith("AGENT_")) {
    return { bubble: config.accent, label: config.labelStyle, own: false };
  }

  if (own) {
    return { bubble: config.accent, label: config.labelStyle, own: true };
  }

  return {
    bubble: NEUTRAL_BUBBLE,
    label: { background: "#f3f4f6", color: "#6b7280" },
    own: false,
  };
}

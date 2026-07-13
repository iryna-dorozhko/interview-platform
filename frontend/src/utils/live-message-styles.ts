export type LiveAuthorType =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

type BubbleStyle = { background: string; color: string };
type LabelStyle = { background: string; color: string };

const NEUTRAL_BUBBLE: BubbleStyle = { background: "#e5e7eb", color: "#1f2937" };

const STYLES: Record<
  LiveAuthorType,
  { label: string; accent: BubbleStyle; labelStyle: LabelStyle }
> = {
  HUMAN_HR: {
    label: "HR",
    accent: { background: "#dbeafe", color: "#1e3a5f" },
    labelStyle: { background: "#dbeafe", color: "#1e40af" },
  },
  HUMAN_CANDIDATE: {
    label: "Кандидат",
    accent: { background: "#d1fae5", color: "#065f46" },
    labelStyle: { background: "#d1fae5", color: "#047857" },
  },
  AGENT_ARBITER: {
    label: "Arbiter",
    accent: { background: "#ede9fe", color: "#5b21b6" },
    labelStyle: { background: "#ede9fe", color: "#6d28d9" },
  },
  AGENT_COMPANY: {
    label: "Компанія",
    accent: { background: "#ffedd5", color: "#9a3412" },
    labelStyle: { background: "#ffedd5", color: "#c2410c" },
  },
  AGENT_CANDIDATE: {
    label: "Кандидат (AI)",
    accent: { background: "#fce7f3", color: "#9d174d" },
    labelStyle: { background: "#fce7f3", color: "#be185d" },
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
    label: { background: "#f3f4f6", color: "#4b5563" },
    own: false,
  };
}

export function buildInviteLink(origin: string, joinCode: string): string {
  const code = joinCode.trim().toUpperCase();
  return `${origin.replace(/\/$/, "")}/join?code=${encodeURIComponent(code)}`;
}

export function formatScheduledAtUk(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function buildInviteMessage(input: {
  displayName: string;
  joinCode: string;
  origin: string;
  scheduledAt?: string | null;
  interviewKind?: "STANDARD" | "ADDITIONAL_MEETING" | null;
}): string {
  const link = buildInviteLink(input.origin, input.joinCode);
  const time = formatScheduledAtUk(input.scheduledAt ?? null);
  const isAdditional = input.interviewKind === "ADDITIONAL_MEETING";
  const lines = [
    isAdditional
      ? `Вас запрошено на додаткову співбесіду «${input.displayName}».`
      : `Вас запрошено на співбесіду «${input.displayName}».`,
    `Код: ${input.joinCode}`,
    `Посилання: ${link}`,
  ];
  if (time) lines.push(`Час: ${time}`);
  if (isAdditional) {
    lines.push(
      "Зверніть увагу: на цій додатковій зустрічі AI-агент кандидата не бере участі — відповідаєте ви особисто.",
    );
  }
  return lines.join("\n");
}

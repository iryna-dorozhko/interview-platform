export type VacancyRequirements = {
  critical: string[];
  desired: string[];
};

function cleanList(items: unknown): string[] | null {
  if (!Array.isArray(items)) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function normalizeVacancyRequirements(raw: unknown): VacancyRequirements | null {
  if (Array.isArray(raw)) {
    const desired = cleanList(raw);
    if (!desired) return null;
    return { critical: [], desired };
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { critical, desired } = raw as Record<string, unknown>;
  const criticalList = cleanList(critical ?? []);
  const desiredList = cleanList(desired ?? []);
  if (!criticalList || !desiredList) return null;

  const criticalKeys = new Set(criticalList.map((item) => item.toLowerCase()));
  return {
    critical: criticalList,
    desired: desiredList.filter((item) => !criticalKeys.has(item.toLowerCase())),
  };
}

export function assertNonEmptyRequirements(req: VacancyRequirements): boolean {
  return req.critical.length > 0 || req.desired.length > 0;
}

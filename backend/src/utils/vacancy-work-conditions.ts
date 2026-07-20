export type VacancyCompensation = {
  min?: number;
  max?: number;
  currency?: string;
  grossNet?: "gross" | "net";
  displayText: string;
};

export const WORK_CONDITION_PREFIXES = [
  "Формат:",
  "Графік:",
  "Бенефіти:",
  "Релокація:",
  "Випробувальний:",
  "Обладнання:",
] as const;

const NOT_SPECIFIED = "не вказано";

export function parseWorkConditionsArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseVacancyCompensation(value: unknown): VacancyCompensation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.displayText !== "string" || !record.displayText.trim()) return null;
  const result: VacancyCompensation = { displayText: record.displayText.trim() };
  if (typeof record.min === "number") result.min = record.min;
  if (typeof record.max === "number") result.max = record.max;
  if (typeof record.currency === "string") result.currency = record.currency;
  if (record.grossNet === "gross" || record.grossNet === "net") result.grossNet = record.grossNet;
  return result;
}

export function formatSalaryDisplay(compensation: unknown): string | null {
  const parsed = parseVacancyCompensation(compensation);
  if (!parsed) return null;
  const text = parsed.displayText.trim();
  if (!text || text.toLowerCase() === NOT_SPECIFIED) return null;
  return text;
}

export function formatWorkFormatDisplay(workConditions: unknown): string | null {
  const items = parseWorkConditionsArray(workConditions);
  const formatLine = items.find((item) => item.startsWith("Формат:"));
  if (!formatLine) return null;
  const value = formatLine.slice("Формат:".length).trim();
  if (!value || value.toLowerCase() === NOT_SPECIFIED) return null;
  return value;
}

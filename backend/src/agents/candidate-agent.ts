import type { ChatMessage } from "../llm/types";
import { CANDIDATE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-agent.uk";
import { CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/candidate-profile-extraction.uk";

export type CandidatePrepAuthorType = "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";

export interface CandidatePrepHistoryItem {
  authorType: CandidatePrepAuthorType;
  content: string;
}

const EMPTY_TURN_PLACEHOLDER = "(порожнє повідомлення)";

export function extractFirstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  const [firstName] = trimmed.split(/\s+/);
  return firstName || null;
}

function buildCandidateAgentSystemPrompt(candidateFirstName?: string | null): string {
  const firstName = extractFirstName(candidateFirstName);
  if (!firstName) {
    return CANDIDATE_AGENT_SYSTEM_PROMPT_UK;
  }

  return `${CANDIDATE_AGENT_SYSTEM_PROMPT_UK}

Контекст: ім'я кандидата — ${firstName}. Використовуй його для вибіркового звернення згідно з правилами вище.`;
}

export function buildCandidateAgentMessages(
  history: CandidatePrepHistoryItem[],
  options?: { candidateFirstName?: string | null },
): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: buildCandidateAgentSystemPrompt(options?.candidateFirstName),
  };

  const historyMessages: ChatMessage[] = history.map((item) => ({
    role: item.authorType === "HUMAN_CANDIDATE" ? "user" : "assistant",
    content: item.content,
  }));

  const lastMessage = historyMessages[historyMessages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    historyMessages.push({ role: "user", content: EMPTY_TURN_PLACEHOLDER });
  }

  return [systemMessage, ...historyMessages];
}

export interface ContactPreview {
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_PATTERN = /\+?\d[\d\s\-()]{8,14}\d/;
const DECLINE_PATTERN = /^(ні|не хочу|відмовляюсь|без номера|пропустити|немає)/i;

function extractEmail(text: string): string | null {
  const match = text.match(EMAIL_PATTERN);
  return match ? match[0].toLowerCase() : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(PHONE_PATTERN);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  return digits.length >= 9 ? match[0].trim() : null;
}

function looksLikeName(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (DECLINE_PATTERN.test(trimmed)) return false;
  if (extractEmail(trimmed) || extractPhone(trimmed)) return false;
  return true;
}

export function extractContactPreviewFromHistory(
  history: CandidatePrepHistoryItem[],
  fallbackEmail?: string | null,
): ContactPreview {
  const humanMessages = history
    .filter((item) => item.authorType === "HUMAN_CANDIDATE")
    .map((item) => item.content.trim())
    .filter(Boolean);

  let fullName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

  for (const text of humanMessages) {
    if (!email) {
      email = extractEmail(text);
    }
    if (!phone) {
      phone = extractPhone(text);
    }
    if (!fullName && looksLikeName(text)) {
      fullName = text;
    }
  }

  if (!email && fallbackEmail?.trim()) {
    email = fallbackEmail.trim().toLowerCase();
  }

  return { fullName, email, phone };
}

export interface ExtractedCandidateProfile {
  fullName: string;
  email: string;
  phone: string | null;
  experience: string[];
  skills: {
    strong: string[];
    growth: string[];
  };
  goals: string[];
  summary: string;
}

export class CandidateProfileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateProfileExtractionError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CandidateProfileExtractionError(`missing or invalid field: ${field}`);
  }
  return value.map((item) => String(item));
}

function toOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeSkillsFields(
  data: Record<string, unknown>
): { strong: unknown; growth: unknown } {
  const skills = data.skills;

  if (typeof skills === "object" && skills !== null && !Array.isArray(skills)) {
    const skillsObj = skills as Record<string, unknown>;
    return { strong: skillsObj.strong, growth: skillsObj.growth };
  }

  if (data["skills.strong"] !== undefined || data["skills.growth"] !== undefined) {
    return { strong: data["skills.strong"], growth: data["skills.growth"] };
  }

  if (Array.isArray(skills)) {
    return { strong: skills, growth: ["не вказано"] };
  }

  throw new CandidateProfileExtractionError("missing or invalid field: skills");
}

export function parseCandidateProfileExtraction(rawText: string): ExtractedCandidateProfile {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new CandidateProfileExtractionError("LLM returned invalid JSON for profile extraction");
  }

  if (typeof data !== "object" || data === null) {
    throw new CandidateProfileExtractionError("LLM response is not a JSON object");
  }

  const record = data as Record<string, unknown>;
  const { experience, goals, summary } = record;
  const skillsFields = normalizeSkillsFields(record);

  const fullName = String(record.fullName ?? "").trim();
  const email = String(record.email ?? "").trim().toLowerCase();
  const phone = toOptionalString(record.phone);

  if (!fullName) throw new CandidateProfileExtractionError("missing or invalid field: fullName");
  if (!email) throw new CandidateProfileExtractionError("missing or invalid field: email");

  if (typeof summary !== "string" || !summary.trim()) {
    throw new CandidateProfileExtractionError("missing or invalid field: summary");
  }

  return {
    fullName,
    email,
    phone,
    experience: toStringArray(experience, "experience"),
    skills: {
      strong: toStringArray(skillsFields.strong, "skills.strong"),
      growth: toStringArray(skillsFields.growth, "skills.growth"),
    },
    goals: toStringArray(goals, "goals"),
    summary: summary.trim(),
  };
}

export function buildCandidateProfileExtractionMessages(
  history: CandidatePrepHistoryItem[]
): ChatMessage[] {
  const transcript = history
    .map(
      (item) =>
        `${item.authorType === "HUMAN_CANDIDATE" ? "Кандидат" : "Агент"}: ${item.content}`
    )
    .join("\n");

  return [
    { role: "system", content: CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK },
    { role: "user", content: transcript || "(розмова порожня)" },
  ];
}

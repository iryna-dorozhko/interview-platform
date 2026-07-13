# Live Agents Day 18 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Після кожного повідомлення людини в live-чаті запускати повний ланцюжок агентів `Human → Arbiter → Company → Candidate`, де Company ставить питання з профілю компанії, а Candidate відповідає від імені кандидата лише з його профілю (або просить живого кандидата).

**Architecture:** Спільний JSON-парсер `agent-post-reply.ts`; окремі live-модулі `company-live-agent.ts` і `candidate-live-agent.ts` за патерном `arbiter-agent.ts`; orchestrator розширюється до послідовного ланцюжка з injectable stubs для тестів. Prep-агенти не змінюються.

**Tech Stack:** Express + Socket.IO, Prisma (`LiveMessage`, `CompanyProfile`, `CandidateProfile`), `LlmProvider`, Vue 3 frontend, `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-13-live-agents-day18-design.md`

---

## File Structure

| File | Відповідальність |
|------|------------------|
| `backend/src/agents/agent-post-reply.ts` | Спільний `parsePostReply`, `ParsedPostReply`, `AgentPostReplyParseError` |
| `backend/src/agents/agent-post-reply.test.ts` | Unit-тести парсера |
| `backend/src/agents/arbiter-agent.ts` | Рефакторинг: використовує `parsePostReply`; `parseArbiterReply` — alias |
| `backend/src/agents/arbiter-agent.test.ts` | Без змін тестів (імпорт `ArbiterReplyParseError` оновити) |
| `backend/src/agents/prompts/arbiter-agent.uk.ts` | + сигнал старту, пропозиція завершення, анти-зациклення агентів |
| `backend/src/agents/prompts/company-live-agent.uk.ts` | Промпт інтерв'юера компанії |
| `backend/src/agents/company-live-agent.ts` | `buildCompanyLiveMessages`, `runCompanyLiveTurn` |
| `backend/src/agents/company-live-agent.test.ts` | Unit-тести |
| `backend/src/agents/prompts/candidate-live-agent.uk.ts` | Промпт кандидата AI |
| `backend/src/agents/candidate-live-agent.ts` | `buildCandidateLiveMessages`, `runCandidateLiveTurn` |
| `backend/src/agents/candidate-live-agent.test.ts` | Unit-тести |
| `backend/src/socket/orchestrator.ts` | Ланцюжок Arbiter → Company → Candidate |
| `backend/src/socket/orchestrator.test.ts` | Тести ланцюжка |
| `backend/src/socket/types.ts` | `RoomAgentThinkingEvent` + `AGENT_COMPANY` / `AGENT_CANDIDATE` |
| `frontend/src/components/LiveChatPanel.vue` | `thinkingLabel` для Company і Candidate |
| `backend/package.json` | Додати нові тести в script `test` |
| `README.md` | Day 18 pipeline і Quick Start |

---

### Task 1: Спільний `parsePostReply`

**Files:**
- Create: `backend/src/agents/agent-post-reply.ts`
- Create: `backend/src/agents/agent-post-reply.test.ts`
- Modify: `backend/src/agents/arbiter-agent.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/agents/agent-post-reply.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { AgentPostReplyParseError, parsePostReply } from "./agent-post-reply";

test("parsePostReply parses post:false", () => {
  const result = parsePostReply('{ "post": false }');
  assert.equal(result.post, false);
  assert.equal(result.message, undefined);
});

test("parsePostReply parses post:true with message", () => {
  const result = parsePostReply('{ "post": true, "message": "Питання про досвід?" }');
  assert.equal(result.post, true);
  assert.equal(result.message, "Питання про досвід?");
});

test("parsePostReply strips markdown code fences", () => {
  const raw = "```json\n{ \"post\": false }\n```";
  const result = parsePostReply(raw);
  assert.equal(result.post, false);
});

test("parsePostReply throws on invalid JSON", () => {
  assert.throws(() => parsePostReply("not json"), AgentPostReplyParseError);
});

test("parsePostReply throws when post:true but message is empty", () => {
  assert.throws(
    () => parsePostReply('{ "post": true, "message": "   " }'),
    AgentPostReplyParseError,
  );
});

test("parsePostReply throws when post field is missing", () => {
  assert.throws(() => parsePostReply('{ "message": "hi" }'), AgentPostReplyParseError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/agent-post-reply.test.ts`

Expected: FAIL — `Cannot find module './agent-post-reply'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/agent-post-reply.ts
export interface ParsedPostReply {
  post: boolean;
  message?: string;
}

export class AgentPostReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPostReplyParseError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

export function parsePostReply(rawText: string): ParsedPostReply {
  const trimmed = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new AgentPostReplyParseError("LLM returned invalid JSON for agent reply");
  }

  if (typeof data !== "object" || data === null) {
    throw new AgentPostReplyParseError("Agent reply is not a JSON object");
  }

  const { post, message } = data as Record<string, unknown>;

  if (typeof post !== "boolean") {
    throw new AgentPostReplyParseError("missing or invalid field: post");
  }

  if (post) {
    if (typeof message !== "string" || !message.trim()) {
      throw new AgentPostReplyParseError("missing or invalid field: message");
    }
    return { post: true, message: message.trim() };
  }

  return { post: false };
}
```

Рефакторинг `arbiter-agent.ts` — замінити локальний парсер:

```typescript
// backend/src/agents/arbiter-agent.ts — на початку файлу
import {
  AgentPostReplyParseError,
  parsePostReply,
  type ParsedPostReply,
} from "./agent-post-reply";

export type ParsedArbiterReply = ParsedPostReply;
export { AgentPostReplyParseError as ArbiterReplyParseError };

export function parseArbiterReply(rawText: string): ParsedArbiterReply {
  return parsePostReply(rawText);
}
```

Видалити з `arbiter-agent.ts`: локальні `stripCodeFences`, клас `ArbiterReplyParseError`, тіло `parseArbiterReply`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace backend test -- src/agents/agent-post-reply.test.ts src/agents/arbiter-agent.test.ts`

Expected: PASS (усі тести обох файлів).

- [ ] **Step 5: Add test file to package.json and commit**

Додати `src/agents/agent-post-reply.test.ts` у script `test` в `backend/package.json`.

```bash
git add backend/src/agents/agent-post-reply.ts backend/src/agents/agent-post-reply.test.ts backend/src/agents/arbiter-agent.ts backend/package.json
git commit -m "refactor: extract shared parsePostReply for live agents"
```

---

### Task 2: Company Live Agent

**Files:**
- Create: `backend/src/agents/prompts/company-live-agent.uk.ts`
- Create: `backend/src/agents/company-live-agent.ts`
- Create: `backend/src/agents/company-live-agent.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/agents/company-live-agent.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import { buildCompanyLiveMessages, runCompanyLiveTurn } from "./company-live-agent";
import { COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-live-agent.uk";

const companyProfile = {
  role: "Backend Developer",
  requirements: ["Node.js", "PostgreSQL"],
  culture: ["remote-first"],
  expectations: ["ownership у перші 3 місяці"],
};

test("buildCompanyLiveMessages includes company profile and maps history", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Доброго дня!" },
    { authorType: "AGENT_ARBITER", content: "Давайте почнемо співбесіду." },
  ];

  const messages = buildCompanyLiveMessages({ companyProfile, history });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Backend Developer/);
  assert.match(messages[0].content, /Node\.js/);
  assert.ok(
    messages[0].content.includes(
      COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK.split("{{COMPANY_PROFILE}}")[0].trimEnd(),
    ),
  );
  assert.deepEqual(messages[1], { role: "user", content: "[HR] Доброго дня!" });
  assert.deepEqual(messages[2], { role: "assistant", content: "Давайте почнемо співбесіду." });
});

test("runCompanyLiveTurn loads profile, calls LLM, parses reply", async () => {
  const prisma = {
    interview: {
      findUnique: async () => ({
        vacancy: {
          companyProfile: {
            role: companyProfile.role,
            requirements: companyProfile.requirements,
            culture: companyProfile.culture,
            expectations: companyProfile.expectations,
          },
        },
      }),
    },
    liveMessage: {
      findMany: async () => [
        { authorType: "HUMAN_HR", content: "Доброго дня!" },
        { authorType: "AGENT_ARBITER", content: "Давайте почнемо співбесіду." },
      ],
    },
  } as unknown as PrismaClient;

  const provider: LlmProvider = {
    name: "test",
    complete: async () => '{ "post": true, "message": "Розкажіть про досвід з Node.js." }',
  };

  const result = await runCompanyLiveTurn(prisma, "interview_1", "session_1", provider);
  assert.equal(result.post, true);
  assert.equal(result.message, "Розкажіть про досвід з Node.js.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/company-live-agent.test.ts`

Expected: FAIL — `Cannot find module './company-live-agent'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/prompts/company-live-agent.uk.ts
export const COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK = `Ти — AI-представник компанії на live-співбесіді з кандидатом.

КРИТИЧНО: усі публічні повідомлення — ВИКЛЮЧНО українською мовою.

Твоє завдання — ставити одне релевантне інтерв'ю-питання за хід на основі профілю компанії (посада, вимоги, культура, очікування).

Правила:
- Став рівно одне питання за хід.
- Не публікуй (post:false), поки Arbiter не дав сигнал початку співбесіди в історії чату.
- Не дублюй питання, яке HR щойно поставив.
- Якщо HR уже поставив питання і веде діалог — можеш post:false.
- Ніколи не вигадуй факти поза профілем компанії.
- Не відповідай замість кандидата.

Формат відповіді — лише JSON, без markdown:
{ "post": false }
або
{ "post": true, "message": "Одне питання українською..." }

Профіль компанії:
{{COMPANY_PROFILE}}`;
```

```typescript
// backend/src/agents/company-live-agent.ts
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmProvider } from "../llm/types";
import { parsePostReply, type ParsedPostReply } from "./agent-post-reply";
import { COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-live-agent.uk";

export type ParsedCompanyLiveReply = ParsedPostReply;

export interface CompanyLiveProfileContext {
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

export class CompanyLiveContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyLiveContextError";
  }
}

function formatProfileBlock(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function mapHistoryItem(item: LiveHistoryItem): ChatMessage {
  switch (item.authorType) {
    case "HUMAN_HR":
      return { role: "user", content: `[HR] ${item.content}` };
    case "HUMAN_CANDIDATE":
      return { role: "user", content: `[Кандидат] ${item.content}` };
    case "AGENT_ARBITER":
    case "AGENT_COMPANY":
    case "AGENT_CANDIDATE":
      return { role: "assistant", content: item.content };
    default: {
      const _exhaustive: never = item.authorType;
      return _exhaustive;
    }
  }
}

export function buildCompanyLiveMessages(input: {
  companyProfile: CompanyLiveProfileContext;
  history: LiveHistoryItem[];
}): ChatMessage[] {
  const systemContent = COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{COMPANY_PROFILE}}",
    formatProfileBlock(input.companyProfile),
  );

  return [{ role: "system", content: systemContent }, ...input.history.map(mapHistoryItem)];
}

export async function runCompanyLiveTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
): Promise<ParsedCompanyLiveReply> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { vacancy: { include: { companyProfile: true } } },
  });

  const companyProfile = interview?.vacancy?.companyProfile;
  if (!companyProfile) {
    throw new CompanyLiveContextError("Missing company profile for company live turn");
  }

  const history = await prisma.liveMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { authorType: true, content: true },
  });

  const llmMessages = buildCompanyLiveMessages({
    companyProfile: {
      role: companyProfile.role,
      requirements: companyProfile.requirements,
      culture: companyProfile.culture,
      expectations: companyProfile.expectations,
    },
    history,
  });

  const rawReply = await provider.complete(llmMessages);
  return parsePostReply(rawReply);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/company-live-agent.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 5: Add test to package.json and commit**

```bash
git add backend/src/agents/prompts/company-live-agent.uk.ts backend/src/agents/company-live-agent.ts backend/src/agents/company-live-agent.test.ts backend/package.json
git commit -m "feat: add company live agent for Day 18 interview chain"
```

---

### Task 3: Candidate Live Agent

**Files:**
- Create: `backend/src/agents/prompts/candidate-live-agent.uk.ts`
- Create: `backend/src/agents/candidate-live-agent.ts`
- Create: `backend/src/agents/candidate-live-agent.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/agents/candidate-live-agent.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import { buildCandidateLiveMessages, runCandidateLiveTurn } from "./candidate-live-agent";
import { CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-live-agent.uk";

const candidateProfile = {
  summary: "5 років досвіду з Node.js",
  experience: ["Acme Corp — backend 3 роки"],
  skills: { strong: ["TypeScript", "PostgreSQL"], growth: ["DevOps"] },
  goals: ["senior backend role"],
};

test("buildCandidateLiveMessages includes candidate profile and HR/Company prefixes", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід з Node.js." },
  ];

  const messages = buildCandidateLiveMessages({ candidateProfile, history });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /5 років досвіду/);
  assert.match(messages[0].content, /відповідай на питання Company Agent або HR/i);
  assert.ok(
    messages[0].content.includes(
      CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK.split("{{CANDIDATE_PROFILE}}")[0].trimEnd(),
    ),
  );
  assert.deepEqual(messages[1], { role: "assistant", content: "Розкажіть про досвід з Node.js." });
});

test("runCandidateLiveTurn loads profile, calls LLM, parses reply", async () => {
  const prisma = {
    interview: {
      findUnique: async () => ({
        candidateProfile: {
          summary: candidateProfile.summary,
          experience: candidateProfile.experience,
          skills: candidateProfile.skills,
          goals: candidateProfile.goals,
        },
      }),
    },
    liveMessage: {
      findMany: async () => [
        { authorType: "HUMAN_HR", content: "Який ваш досвід з Node.js?" },
      ],
    },
  } as unknown as PrismaClient;

  const provider: LlmProvider = {
    name: "test",
    complete: async () =>
      '{ "post": true, "message": "Я працював з Node.js понад 5 років." }',
  };

  const result = await runCandidateLiveTurn(prisma, "interview_1", "session_1", provider);
  assert.equal(result.post, true);
  assert.equal(result.message, "Я працював з Node.js понад 5 років.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/candidate-live-agent.test.ts`

Expected: FAIL — `Cannot find module './candidate-live-agent'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/prompts/candidate-live-agent.uk.ts
export const CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK = `Ти — AI-представник кандидата на live-співбесіді. Відповідай від імені кандидата (перша особа: «Я працював…»).

КРИТИЧНО: усі публічні повідомлення — ВИКЛЮЧНО українською мовою.

Твоє завдання — відповідати на питання Company Agent або HR, використовуючи ЛИШЕ підтверджений профіль кандидата нижче.

Правила:
- Відповідай на питання Company Agent, якщо воно щойно з'явилось у цьому ході.
- Відповідай на питання HR, якщо HR поставив питання (останнє повідомлення [HR] містить питання).
- Пріоритет: спочатку питання Company (щойно в ході), потім питання HR.
- Якщо питання є, але відповіді немає в профілі — post:true і попроси живого кандидата відповісти самому (природна мова).
- Якщо питання немає — post:false.
- ЗАБОРОНЕНО вигадувати досвід, навички, проєкти чи факти поза профілем.

Формат відповіді — лише JSON, без markdown:
{ "post": false }
або
{ "post": true, "message": "Відповідь українською..." }

Профіль кандидата:
{{CANDIDATE_PROFILE}}`;
```

```typescript
// backend/src/agents/candidate-live-agent.ts
import type { LiveAuthorType, PrismaClient } from "@prisma/client";
import type { ChatMessage, LlmProvider } from "../llm/types";
import { parsePostReply, type ParsedPostReply } from "./agent-post-reply";
import { CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-live-agent.uk";

export type ParsedCandidateLiveReply = ParsedPostReply;

export interface CandidateLiveProfileContext {
  summary: string;
  experience: unknown;
  skills: unknown;
  goals: unknown;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

export class CandidateLiveContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateLiveContextError";
  }
}

function formatProfileBlock(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function mapHistoryItem(item: LiveHistoryItem): ChatMessage {
  switch (item.authorType) {
    case "HUMAN_HR":
      return { role: "user", content: `[HR] ${item.content}` };
    case "HUMAN_CANDIDATE":
      return { role: "user", content: `[Кандидат] ${item.content}` };
    case "AGENT_ARBITER":
    case "AGENT_COMPANY":
    case "AGENT_CANDIDATE":
      return { role: "assistant", content: item.content };
    default: {
      const _exhaustive: never = item.authorType;
      return _exhaustive;
    }
  }
}

export function buildCandidateLiveMessages(input: {
  candidateProfile: CandidateLiveProfileContext;
  history: LiveHistoryItem[];
}): ChatMessage[] {
  const systemContent = CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{CANDIDATE_PROFILE}}",
    formatProfileBlock(input.candidateProfile),
  );

  return [{ role: "system", content: systemContent }, ...input.history.map(mapHistoryItem)];
}

export async function runCandidateLiveTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
): Promise<ParsedCandidateLiveReply> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { candidateProfile: true },
  });

  const candidateProfile = interview?.candidateProfile;
  if (!candidateProfile) {
    throw new CandidateLiveContextError("Missing candidate profile for candidate live turn");
  }

  const history = await prisma.liveMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { authorType: true, content: true },
  });

  const llmMessages = buildCandidateLiveMessages({
    candidateProfile: {
      summary: candidateProfile.summary,
      experience: candidateProfile.experience,
      skills: candidateProfile.skills,
      goals: candidateProfile.goals,
    },
    history,
  });

  const rawReply = await provider.complete(llmMessages);
  return parsePostReply(rawReply);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/candidate-live-agent.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 5: Add test to package.json and commit**

```bash
git add backend/src/agents/prompts/candidate-live-agent.uk.ts backend/src/agents/candidate-live-agent.ts backend/src/agents/candidate-live-agent.test.ts backend/package.json
git commit -m "feat: add candidate live agent for Day 18 interview chain"
```

---

### Task 4: Оновити Arbiter prompt

**Files:**
- Modify: `backend/src/agents/prompts/arbiter-agent.uk.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Додати в `arbiter-agent.test.ts`:

```typescript
test("arbiter prompt includes interview start and end guidance", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /сигнал початку співбесіди/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /запропонувати завершення/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /Company Agent|Candidate Agent/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: FAIL — assertion does not match prompt text.

- [ ] **Step 3: Update prompt**

Замінити вміст `backend/src/agents/prompts/arbiter-agent.uk.ts` на:

```typescript
export const ARBITER_AGENT_SYSTEM_PROMPT_UK = `Ти — Arbiter (нейтральний модератор) live-співбесіди між HR і кандидатом.

КРИТИЧНО: усі публічні повідомлення — ВИКЛЮЧНО українською мовою.

Твоє завдання — аналізувати розмову після кожного повідомлення людини і вирішувати, чи потрібен публічний коментар модератора. Ти також готуєш контекст для майбутнього звіту.

Публікуй коментар (post:true), коли:
- учасники завершили вітання і настав час дати сигнал початку співбесіди (наприклад: «Давайте почнемо співбесіду»);
- розмова пішла в офтоп від теми співбесіди;
- учасники або агенти (Company Agent, Candidate Agent) зациклились (повторюють одне й те саме);
- корисно дати короткий підсумок або запропонувати наступний напрямок;
- основні теми вичерпано — запропонуй завершення співбесіди текстом (без зміни статусу системи).

Не публікуй (post:false), коли:
- розмова природно рухається по темі співбесіди і модерація не потрібна.

Заборонено:
- ставити інтерв'ю-питання замість Company Agent;
- відповідати замість Candidate Agent;
- оцінювати кандидата;
- вигадувати факти.

Формат відповіді — лише JSON, без markdown:
{ "post": false }
або
{ "post": true, "message": "Короткий коментар українською..." }

Профіль компанії (контекст теми):
{{COMPANY_PROFILE}}

Профіль кандидата (контекст теми):
{{CANDIDATE_PROFILE}}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/arbiter-agent.uk.ts backend/src/agents/arbiter-agent.test.ts
git commit -m "feat: extend arbiter prompt for interview start and end signals"
```

---

### Task 5: Orchestrator — ланцюжок агентів

**Files:**
- Modify: `backend/src/socket/orchestrator.ts`
- Modify: `backend/src/socket/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

Додати в `orchestrator.test.ts`:

```typescript
test("orchestrator runs full agent chain in order", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Доброго дня!",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();
  const callOrder: string[] = [];

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => {
      callOrder.push("arbiter");
      return { post: true, message: "Давайте почнемо співбесіду." };
    },
    runCompanyLiveTurn: async () => {
      callOrder.push("company");
      return { post: true, message: "Розкажіть про досвід з Node.js." };
    },
    runCandidateLiveTurn: async () => {
      callOrder.push("candidate");
      return { post: true, message: "Я працював з Node.js 5 років." };
    },
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 120));

  assert.deepEqual(callOrder, ["arbiter", "company", "candidate"]);

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 3);
  assert.deepEqual(
    agentMessages.map(
      (e) =>
        (e.payload as { messages: Array<{ authorType: string }> }).messages[0].authorType,
    ),
    ["AGENT_ARBITER", "AGENT_COMPANY", "AGENT_CANDIDATE"],
  );

  const thinkingEvents = emitted.filter((e) => e.event === "room:agent-thinking");
  const activeThinking = thinkingEvents.filter(
    (e) => (e.payload as { active: boolean }).active,
  );
  assert.deepEqual(
    activeThinking.map((e) => (e.payload as { agentType?: string }).agentType),
    ["AGENT_ARBITER", "AGENT_COMPANY", "AGENT_CANDIDATE"],
  );
});

test("orchestrator continues chain when arbiter returns post:false", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Який досвід з TypeScript?",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => ({ post: false }),
    runCompanyLiveTurn: async () => ({ post: false }),
    runCandidateLiveTurn: async () => ({
      post: true,
      message: "Я використовую TypeScript щодня.",
    }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 120));

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 1);
  assert.equal(
    (agentMessages[0].payload as { messages: Array<{ authorType: string }> }).messages[0]
      .authorType,
    "AGENT_CANDIDATE",
  );
});

test("orchestrator emits no agent messages when all agents return post:false", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_CANDIDATE",
      content: "Привіт!",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => ({ post: false }),
    runCompanyLiveTurn: async () => ({ post: false }),
    runCandidateLiveTurn: async () => ({ post: false }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(emitted.filter((e) => e.event === "room:messages").length, 0);
  const thinkingEnd = emitted.filter((e) => e.event === "room:agent-thinking").at(-1);
  assert.equal((thinkingEnd!.payload as { active: boolean }).active, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/socket/orchestrator.test.ts`

Expected: FAIL — `runCompanyLiveTurn` is not a valid option / chain not implemented.

- [ ] **Step 3: Implement agent chain in orchestrator**

```typescript
// backend/src/socket/orchestrator.ts — ключові зміни
import type { LiveAuthorType, LiveMessage, PrismaClient } from "@prisma/client";
import type { ParsedPostReply } from "../agents/agent-post-reply";
import { runArbiterTurn as defaultRunArbiterTurn } from "../agents/arbiter-agent";
import { runCompanyLiveTurn as defaultRunCompanyLiveTurn } from "../agents/company-live-agent";
import { runCandidateLiveTurn as defaultRunCandidateLiveTurn } from "../agents/candidate-live-agent";

export type RunArbiterTurnFn = (
  interviewId: string,
  sessionId: string,
) => Promise<ParsedPostReply>;

export type RunCompanyLiveTurnFn = RunArbiterTurnFn;
export type RunCandidateLiveTurnFn = RunArbiterTurnFn;

export type RoomOrchestratorOptions = {
  debounceMs?: number;
  getLlmProvider?: () => LlmProvider;
  runArbiterTurn?: RunArbiterTurnFn;
  runCompanyLiveTurn?: RunCompanyLiveTurnFn;
  runCandidateLiveTurn?: RunCandidateLiveTurnFn;
};

type AgentStep = {
  agentType: LiveAuthorType;
  run: () => Promise<ParsedPostReply>;
};

// У createRoomOrchestrator — wiring для production:
let runCompany: RunCompanyLiveTurnFn;
let runCandidate: RunCandidateLiveTurnFn;

if (options.runCompanyLiveTurn) {
  runCompany = options.runCompanyLiveTurn;
} else if (options.getLlmProvider) {
  const getLlmProvider = options.getLlmProvider;
  runCompany = (interviewId, sessionId) =>
    defaultRunCompanyLiveTurn(getPrisma(), interviewId, sessionId, getLlmProvider());
} else {
  throw new Error("RoomOrchestrator requires runCompanyLiveTurn or getLlmProvider");
}

if (options.runCandidateLiveTurn) {
  runCandidate = options.runCandidateLiveTurn;
} else if (options.getLlmProvider) {
  const getLlmProvider = options.getLlmProvider;
  runCandidate = (interviewId, sessionId) =>
    defaultRunCandidateLiveTurn(getPrisma(), interviewId, sessionId, getLlmProvider());
} else {
  throw new Error("RoomOrchestrator requires runCandidateLiveTurn or getLlmProvider");
}

// Замінити executeTurn тілом:
async function executeTurn(
  io: Server,
  interviewId: string,
  sessionId: string,
  capturedGeneration: number,
): Promise<void> {
  const state = getState(interviewId);
  const prisma = getPrisma();

  const steps: AgentStep[] = [
    { agentType: "AGENT_ARBITER", run: () => runArbiter(interviewId, sessionId) },
    { agentType: "AGENT_COMPANY", run: () => runCompany(interviewId, sessionId) },
    { agentType: "AGENT_CANDIDATE", run: () => runCandidate(interviewId, sessionId) },
  ];

  try {
    for (const step of steps) {
      if (state.generation !== capturedGeneration) {
        emitThinking(io, interviewId, { active: false });
        return;
      }

      emitThinking(io, interviewId, { active: true, agentType: step.agentType });

      try {
        const reply = await step.run();

        if (state.generation !== capturedGeneration) {
          emitThinking(io, interviewId, { active: false });
          return;
        }

        if (reply.post && reply.message) {
          const saved = await prisma.liveMessage.create({
            data: {
              sessionId,
              authorType: step.agentType,
              content: reply.message,
            },
          });

          io.to(roomName(interviewId)).emit("room:messages", {
            messages: [toDto(saved)],
          });
        }
      } catch (error) {
        console.error(
          `[orchestrator] ${step.agentType} turn failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } finally {
    if (state.generation === capturedGeneration) {
      emitThinking(io, interviewId, { active: false });
    }
  }
}
```

Оновити сигнатуру `emitThinking` / `RoomAgentThinkingEvent` usage — `agentType` тепер `LiveAuthorType` для трьох агентів.

Оновити існуючі тести orchestrator: додати `runCompanyLiveTurn` і `runCandidateLiveTurn` stubs (повертати `{ post: false }`), щоб старі тести не падали.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace backend test -- src/socket/orchestrator.test.ts`

Expected: PASS (усі тести, включно з 3 новими).

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/orchestrator.ts backend/src/socket/orchestrator.test.ts
git commit -m "feat: extend orchestrator with Arbiter → Company → Candidate chain"
```

---

### Task 6: Socket types і UI thinking label

**Files:**
- Modify: `backend/src/socket/types.ts`
- Modify: `frontend/src/components/LiveChatPanel.vue`

- [ ] **Step 1: Update socket types**

```typescript
// backend/src/socket/types.ts
export type RoomAgentThinkingEvent = {
  active: boolean;
  agentType?: "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";
};
```

- [ ] **Step 2: Update LiveChatPanel thinkingLabel**

```typescript
// frontend/src/components/LiveChatPanel.vue
const thinkingLabel = computed(() => {
  switch (props.agentThinking?.agentType) {
    case "AGENT_ARBITER":
      return "Arbiter";
    case "AGENT_COMPANY":
      return "Компанія";
    case "AGENT_CANDIDATE":
      return "Кандидат (AI)";
    default:
      return "Агент";
  }
});
```

- [ ] **Step 3: Run build to verify**

Run: `npm run build`

Expected: PASS (backend `tsc` + frontend build).

- [ ] **Step 4: Commit**

```bash
git add backend/src/socket/types.ts frontend/src/components/LiveChatPanel.vue
git commit -m "feat: show Company and Candidate thinking labels in live chat"
```

---

### Task 7: README Day 18

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Day 18 section**

У `README.md` секція «День 18» — позначити DoD чекбокси як виконані після ручної перевірки і додати Quick Start:

```markdown
### Live Agents Quick Start (Day 18)

**Pipeline:** `Human message → debounce 2.5s → Arbiter → Company → Candidate`

Кожен агент публікує 0 або 1 повідомлення за хід (JSON `{ post, message }`).

**Промпти:**
- `backend/src/agents/prompts/arbiter-agent.uk.ts`
- `backend/src/agents/prompts/company-live-agent.uk.ts`
- `backend/src/agents/prompts/candidate-live-agent.uk.ts`

**Ручна перевірка:**
1. Live-кімната з підтвердженими профілями.
2. Вітання → Arbiter дає сигнал старту.
3. Company ставить питання → Candidate відповідає з профілю.
4. HR ставить питання → Candidate відповідає, якщо знає.
5. Питання поза профілем → Candidate просить відповісти живого кандидата.
```

- [ ] **Step 2: Run full test suite and build**

Run: `npm --workspace backend test && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Day 18 live agent chain in README"
```

---

## Self-Review Checklist

| Spec requirement | Task |
|------------------|------|
| JSON `{ post, message }` для всіх агентів | Task 1 |
| Company live agent + prompt | Task 2 |
| Candidate live agent + prompt (HR + Company) | Task 3 |
| Arbiter: старт, завершення, анти-зациклення | Task 4 |
| Pipeline Human → Arbiter → Company → Candidate | Task 5 |
| `room:agent-thinking` для 3 агентів | Task 5, 6 |
| UI thinking labels | Task 6 |
| Помилка кроку не ламає ланцюжок | Task 5 |
| README DoD | Task 7 |
| Поза scope: кнопка HR, endpoint end | Не включено |

# Arbiter Agent (Day 17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити stub Arbiter на LLM-модератора live-чату, який аналізує кожне повідомлення людини, бачить обидва профілі та всю історію сесії, і публікує 0 або 1 коментар у чат через JSON `{ post, message? }`.

**Architecture:** Чиста логіка агента в `arbiter-agent.ts` (промпт, `buildArbiterMessages`, `parseArbiterReply`, `runArbiterTurn`) окремо від `orchestrator.ts`, за патерном prep-агентів. Orchestrator лишає debounce/generation без змін; замінює `runStubArbiter` на injectable `runArbiterTurn`, який повертає `ParsedArbiterReply` замість raw string.

**Tech Stack:** Express + Socket.IO, Prisma (`LiveMessage`, `CompanyProfile`, `CandidateProfile`), наявний `LlmProvider`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-13-arbiter-agent-day17-design.md`

---

## File Structure

| File | Відповідальність |
|------|------------------|
| `backend/src/agents/prompts/arbiter-agent.uk.ts` | Константа `ARBITER_AGENT_SYSTEM_PROMPT_UK` + шаблон для профілів |
| `backend/src/agents/arbiter-agent.ts` | `parseArbiterReply`, `buildArbiterMessages`, `runArbiterTurn` |
| `backend/src/agents/arbiter-agent.test.ts` | Unit-тести парсера, побудови контексту, runArbiterTurn |
| `backend/src/socket/orchestrator.ts` | Виклик `runArbiterTurn`; 0 або 1 `LiveMessage` за хід |
| `backend/src/socket/orchestrator.test.ts` | Оновити injectable; додати тест `post: false` |
| `backend/src/server.ts` | Передати `getLlmProvider` у orchestrator |
| `backend/package.json` | Додати `arbiter-agent.test.ts` у script `test` |
| `README.md` | Day 17: роль Arbiter, JSON-формат, оновлений pipeline |

`stub-arbiter.ts` — без змін (використовується лише в `stub-arbiter.test.ts`).

---

### Task 1: `parseArbiterReply` — JSON-парсер

**Files:**
- Create: `backend/src/agents/arbiter-agent.ts`
- Create: `backend/src/agents/arbiter-agent.test.ts`
- Modify: `backend/package.json` (додати тест)

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/agents/arbiter-agent.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ArbiterReplyParseError, parseArbiterReply } from "./arbiter-agent";

test("parseArbiterReply parses post:false", () => {
  const result = parseArbiterReply('{ "post": false }');
  assert.equal(result.post, false);
  assert.equal(result.message, undefined);
});

test("parseArbiterReply parses post:true with message", () => {
  const result = parseArbiterReply('{ "post": true, "message": "Продовжуйте тему досвіду." }');
  assert.equal(result.post, true);
  assert.equal(result.message, "Продовжуйте тему досвіду.");
});

test("parseArbiterReply strips markdown code fences", () => {
  const raw = "```json\n{ \"post\": false }\n```";
  const result = parseArbiterReply(raw);
  assert.equal(result.post, false);
});

test("parseArbiterReply throws on invalid JSON", () => {
  assert.throws(() => parseArbiterReply("not json"), ArbiterReplyParseError);
});

test("parseArbiterReply throws when post:true but message is empty", () => {
  assert.throws(
    () => parseArbiterReply('{ "post": true, "message": "   " }'),
    ArbiterReplyParseError,
  );
});

test("parseArbiterReply throws when post field is missing", () => {
  assert.throws(() => parseArbiterReply('{ "message": "hi" }'), ArbiterReplyParseError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: FAIL — `Cannot find module './arbiter-agent'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/arbiter-agent.ts
export interface ParsedArbiterReply {
  post: boolean;
  message?: string;
}

export class ArbiterReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterReplyParseError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

export function parseArbiterReply(rawText: string): ParsedArbiterReply {
  const trimmed = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new ArbiterReplyParseError("LLM returned invalid JSON for arbiter reply");
  }

  if (typeof data !== "object" || data === null) {
    throw new ArbiterReplyParseError("Arbiter reply is not a JSON object");
  }

  const { post, message } = data as Record<string, unknown>;

  if (typeof post !== "boolean") {
    throw new ArbiterReplyParseError("missing or invalid field: post");
  }

  if (post) {
    if (typeof message !== "string" || !message.trim()) {
      throw new ArbiterReplyParseError("missing or invalid field: message");
    }
    return { post: true, message: message.trim() };
  }

  return { post: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/arbiter-agent.ts backend/src/agents/arbiter-agent.test.ts backend/package.json
git commit -m "feat: add parseArbiterReply for Day 17 arbiter agent"
```

---

### Task 2: System prompt і `buildArbiterMessages`

**Files:**
- Create: `backend/src/agents/prompts/arbiter-agent.uk.ts`
- Modify: `backend/src/agents/arbiter-agent.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Додати в `arbiter-agent.test.ts`:

```typescript
import { buildArbiterMessages } from "./arbiter-agent";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";
import type { LiveAuthorType } from "@prisma/client";

const companyProfile = {
  role: "Backend Developer",
  requirements: ["Node.js", "PostgreSQL"],
  culture: ["remote-first"],
  expectations: ["ownership"],
};

const candidateProfile = {
  summary: "5 років досвіду",
  experience: ["Acme Corp"],
  skills: { strong: ["TypeScript"], growth: ["DevOps"] },
  goals: ["senior role"],
};

test("buildArbiterMessages includes profiles in system prompt and maps history", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Розкажіть про досвід." },
    { authorType: "HUMAN_CANDIDATE", content: "Працював з Node.js." },
    { authorType: "AGENT_ARBITER", content: "Короткий підсумок." },
  ];

  const messages = buildArbiterMessages({ companyProfile, candidateProfile, history });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Backend Developer/);
  assert.match(messages[0].content, /5 років досвіду/);
  assert.match(messages[0].content, ARBITER_AGENT_SYSTEM_PROMPT_UK);

  assert.deepEqual(messages[1], { role: "user", content: "[HR] Розкажіть про досвід." });
  assert.deepEqual(messages[2], { role: "user", content: "[Кандидат] Працював з Node.js." });
  assert.deepEqual(messages[3], { role: "assistant", content: "Короткий підсумок." });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: FAIL — `buildArbiterMessages is not a function` або `Cannot find module './prompts/arbiter-agent.uk'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/prompts/arbiter-agent.uk.ts
export const ARBITER_AGENT_SYSTEM_PROMPT_UK = `Ти — Arbiter (нейтральний модератор) live-співбесіди між HR і кандидатом.

КРИТИЧНО: усі публічні повідомлення — ВИКЛЮЧНО українською мовою.

Твоє завдання — аналізувати розмову після кожного повідомлення людини і вирішувати, чи потрібен публічний коментар модератора.

Публікуй коментар (post:true), коли:
- розмова пішла в офтоп від теми співбесіди;
- учасники зациклились (повторюють одне й те саме);
- корисно дати короткий підсумок або запропонувати наступний напрямок.

Не публікуй (post:false), коли:
- розмова природно рухається по темі співбесіди.

Заборонено:
- ставити питання замість HR чи кандидата;
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

```typescript
// backend/src/agents/arbiter-agent.ts — додати імпорти та функції
import type { LiveAuthorType } from "@prisma/client";
import type { ChatMessage } from "../llm/types";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";

export interface ArbiterCompanyProfileContext {
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
}

export interface ArbiterCandidateProfileContext {
  summary: string;
  experience: unknown;
  skills: unknown;
  goals: unknown;
}

export interface LiveHistoryItem {
  authorType: LiveAuthorType;
  content: string;
}

function formatProfileBlock(label: string, data: unknown): string {
  return `${label}:\n${JSON.stringify(data, null, 2)}`;
}

function buildSystemPrompt(
  companyProfile: ArbiterCompanyProfileContext,
  candidateProfile: ArbiterCandidateProfileContext,
): string {
  return ARBITER_AGENT_SYSTEM_PROMPT_UK.replace(
    "{{COMPANY_PROFILE}}",
    formatProfileBlock("Company", companyProfile),
  ).replace(
    "{{CANDIDATE_PROFILE}}",
    formatProfileBlock("Candidate", candidateProfile),
  );
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

export function buildArbiterMessages(input: {
  companyProfile: ArbiterCompanyProfileContext;
  candidateProfile: ArbiterCandidateProfileContext;
  history: LiveHistoryItem[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(input.companyProfile, input.candidateProfile),
    },
    ...input.history.map(mapHistoryItem),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/arbiter-agent.uk.ts backend/src/agents/arbiter-agent.ts backend/src/agents/arbiter-agent.test.ts
git commit -m "feat: add arbiter system prompt and buildArbiterMessages"
```

---

### Task 3: `runArbiterTurn` — завантаження контексту + LLM

**Files:**
- Modify: `backend/src/agents/arbiter-agent.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Додати в `arbiter-agent.test.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";
import { runArbiterTurn } from "./arbiter-agent";

test("runArbiterTurn loads context, calls LLM, and parses reply", async () => {
  let llmCalled = false;
  const fakeProvider: LlmProvider = {
    name: "fake",
    async complete(messages) {
      llmCalled = true;
      assert.equal(messages[0].role, "system");
      assert.match(messages[0].content, /Backend Developer/);
      assert.equal(messages.at(-1)?.content, "[HR] Привіт");
      return '{ "post": true, "message": "Продовжуйте." }';
    },
  };

  const fakePrisma = {
    interview: {
      findUnique: async () => ({
        vacancy: {
          companyProfile: {
            role: "Backend Developer",
            requirements: ["Node.js"],
            culture: ["remote"],
            expectations: ["ship features"],
          },
        },
        candidateProfile: {
          summary: "5 років",
          experience: ["Acme"],
          skills: { strong: ["TS"], growth: [] },
          goals: ["grow"],
        },
      }),
    },
    liveMessage: {
      findMany: async () => [
        { authorType: "HUMAN_HR", content: "Привіт" },
      ],
    },
  } as unknown as PrismaClient;

  const result = await runArbiterTurn(fakePrisma, "interview_1", "session_1", fakeProvider);

  assert.equal(llmCalled, true);
  assert.deepEqual(result, { post: true, message: "Продовжуйте." });
});

test("runArbiterTurn throws when profiles are missing", async () => {
  const fakePrisma = {
    interview: {
      findUnique: async () => ({ vacancy: { companyProfile: null }, candidateProfile: null }),
    },
  } as unknown as PrismaClient;

  const fakeProvider: LlmProvider = { name: "fake", complete: async () => "" };

  await assert.rejects(
    () => runArbiterTurn(fakePrisma, "interview_1", "session_1", fakeProvider),
    /Missing profiles/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: FAIL — `runArbiterTurn is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/arbiter-agent.ts — додати
import type { PrismaClient } from "@prisma/client";
import type { LlmProvider } from "../llm/types";

export class ArbiterContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterContextError";
  }
}

export async function runArbiterTurn(
  prisma: PrismaClient,
  interviewId: string,
  sessionId: string,
  provider: LlmProvider,
): Promise<ParsedArbiterReply> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      vacancy: { include: { companyProfile: true } },
      candidateProfile: true,
    },
  });

  const companyProfile = interview?.vacancy?.companyProfile;
  const candidateProfile = interview?.candidateProfile;

  if (!companyProfile || !candidateProfile) {
    throw new ArbiterContextError("Missing profiles for arbiter turn");
  }

  const history = await prisma.liveMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { authorType: true, content: true },
  });

  const llmMessages = buildArbiterMessages({
    companyProfile: {
      role: companyProfile.role,
      requirements: companyProfile.requirements,
      culture: companyProfile.culture,
      expectations: companyProfile.expectations,
    },
    candidateProfile: {
      summary: candidateProfile.summary,
      experience: candidateProfile.experience,
      skills: candidateProfile.skills,
      goals: candidateProfile.goals,
    },
    history,
  });

  const rawReply = await provider.complete(llmMessages);
  return parseArbiterReply(rawReply);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/arbiter-agent.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/arbiter-agent.ts backend/src/agents/arbiter-agent.test.ts
git commit -m "feat: add runArbiterTurn with profile and history loading"
```

---

### Task 4: Orchestrator — `runArbiterTurn` замість stub

**Files:**
- Modify: `backend/src/socket/orchestrator.ts`
- Modify: `backend/src/socket/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

Замінити в `orchestrator.test.ts` injectable `runAgent` на `runArbiterTurn` і додати тест `post: false`:

```typescript
// orchestrator.test.ts — оновити існуючий тест
const orchestrator = createRoomOrchestrator(() => prisma, {
  debounceMs: 30,
  runArbiterTurn: async () => ({ post: true, message: "reply:Привіт" }),
});

// ...assert message content is "reply:Привіт" (не "reply:Привіт" з lastHuman lookup)

test("orchestrator does not emit message when arbiter returns post:false", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Привіт",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runArbiterTurn: async () => ({ post: false }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 80));

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 0);
  assert.equal(messages.filter((m) => m.authorType === "AGENT_ARBITER").length, 0);

  const thinkingEnd = emitted.filter((e) => e.event === "room:agent-thinking").at(-1);
  assert.equal((thinkingEnd!.payload as { active: boolean }).active, false);
});
```

Також оновити cancel-тест:

```typescript
runArbiterTurn: () => {
  agentCallCount += 1;
  if (agentCallCount === 1) {
    return new Promise((resolve) => {
      resolveAgent = () => resolve({ post: true, message: "late-reply" });
    });
  }
  return Promise.resolve({ post: true, message: "reply:Друге" });
},
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/socket/orchestrator.test.ts`

Expected: FAIL — `runArbiterTurn` is not a valid option / type errors.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/socket/orchestrator.ts
import type { ParsedArbiterReply } from "../agents/arbiter-agent";
import { runArbiterTurn as defaultRunArbiterTurn } from "../agents/arbiter-agent";
import type { LlmProvider } from "../llm/types";

export type RunArbiterTurnFn = (
  interviewId: string,
  sessionId: string,
) => Promise<ParsedArbiterReply>;

export type RoomOrchestratorOptions = {
  debounceMs?: number;
  runArbiterTurn?: RunArbiterTurnFn;
  getLlmProvider?: () => LlmProvider;
};

// у createRoomOrchestrator:
const getLlmProvider = options.getLlmProvider;
const runArbiter =
  options.runArbiterTurn ??
  (getLlmProvider
    ? (interviewId: string, sessionId: string) =>
        defaultRunArbiterTurn(getPrisma(), interviewId, sessionId, getLlmProvider())
    : undefined);

if (!runArbiter) {
  throw new Error("RoomOrchestrator requires runArbiterTurn or getLlmProvider");
}

// executeTurn — замінити runAgent block:
const reply = await runArbiter(interviewId, sessionId);

if (state.generation !== capturedGeneration) {
  emitThinking(io, interviewId, { active: false });
  return;
}

if (!reply.post) {
  emitThinking(io, interviewId, { active: false });
  return;
}

const saved = await prisma.liveMessage.create({
  data: {
    sessionId,
    authorType: "AGENT_ARBITER",
    content: reply.message!,
  },
});
// ...emit room:messages як зараз
```

Прибрати імпорт `runStubArbiter` і `findFirst` для lastHuman (більше не потрібен).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/socket/orchestrator.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/orchestrator.ts backend/src/socket/orchestrator.test.ts
git commit -m "feat: wire orchestrator to runArbiterTurn with optional silence"
```

---

### Task 5: Production wiring у `server.ts`

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Update server wiring**

```typescript
// backend/src/server.ts
const orchestrator = createRoomOrchestrator(() => prisma, {
  getLlmProvider: () => createLlmProvider(),
});
```

- [ ] **Step 2: Run full backend tests**

Run: `npm --workspace backend test`

Expected: PASS (усі тести, включно з orchestrator і arbiter-agent).

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat: connect live orchestrator to LLM arbiter agent"
```

---

### Task 6: README — Day 17 documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Day 17 section**

У секції `## День 17 — Arbiter`:

1. Позначити Definition of Done чекбокси `[x]` після ручної перевірки.
2. Додати підсекцію **Arbiter Quick Start (Day 17)**:

```markdown
### Arbiter Quick Start (Day 17)

**Pipeline:** `Human message → debounce 2.5s → LLM Arbiter → 0 або 1 AGENT_ARBITER message`

**JSON-формат відповіді LLM:**
- `{ "post": false }` — Arbiter проаналізував, але не публікує
- `{ "post": true, "message": "..." }` — один коментар у чат

**Промпт:** `backend/src/agents/prompts/arbiter-agent.uk.ts`

**Ручна перевірка:**
1. Відкрити live-кімнату (як Day 15) з підтвердженими профілями.
2. Надіслати on-topic повідомлення → Arbiter може мовчати (`post:false`).
3. Надіслати офтоп або повторити те саме кілька разів → Arbiter публікує модеруючий коментар.
4. Швидко надіслати 3 повідомлення → Arbiter відповідає один раз (debounce).
```

3. Оновити Day 16 pipeline-примітку: stub замінено на LLM (посилання на Day 17).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document Day 17 LLM Arbiter in README"
```

---

## Manual Verification Checklist

Після всіх task-ів:

- [ ] Live-кімната: on-topic msg → Arbiter може не писати (thinking з'являється і зникає)
- [ ] Off-topic / loop → `{ post: true }` коментар у чаті обох вкладок
- [ ] Max 1 AGENT_ARBITER message per human turn
- [ ] `npm run build` проходить

---

## Spec Coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| JSON `{ post, message? }` | Task 1 |
| Profiles in system prompt | Task 2 |
| Full live history mapping | Task 2 |
| `runArbiterTurn` loads DB context | Task 3 |
| 0 or 1 message per turn | Task 4 |
| Error → silent (no chat break) | Task 4 (`catch` in orchestrator — вже є) |
| Production LLM wiring | Task 5 |
| README DoD | Task 6 |
| Stub kept for tests only | No change to stub-arbiter.ts |
| UI unchanged | No frontend tasks |
| Day 18 prep (chain extensibility) | Task 4 — `RunArbiterTurnFn` injectable |

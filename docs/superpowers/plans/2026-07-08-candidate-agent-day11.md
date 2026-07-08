# Candidate Agent Day 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати серверний candidate prep-чат: Candidate Agent з промптом (досвід, сильні/слабкі сторони, цілі), API `GET`/`POST /message`/`DELETE` на `/api/candidate-prep/:interviewId`, збереження в `PrepSessionCandidate` / `PrepMessageCandidate`.

**Architecture:** Окремий модуль `candidate-agent.ts` і router `candidate-prep.ts` за патерном Company Agent / `prep.ts`. Спільний `parseAgentReply` виноситься в `agent-reply.ts`. Auth: `requireAuth` + `requireCandidate`; перевірка лише що interview існує (ownership — День 14).

**Tech Stack:** Node.js test runner + Express + Prisma + TypeScript; існуючий `LlmProvider`.

**Spec:** `docs/superpowers/specs/2026-07-08-candidate-agent-day11-design.md`

---

## File Structure (before tasks)

### Create

- `backend/src/agents/agent-reply.ts` — shared `parseAgentReply`
- `backend/src/agents/agent-reply.test.ts` — unit-тести парсера (перенесені з company-agent)
- `backend/src/agents/candidate-agent.ts` — `buildCandidateAgentMessages`
- `backend/src/agents/candidate-agent.test.ts` — unit-тести candidate agent
- `backend/src/agents/prompts/candidate-agent.uk.ts` — system prompt
- `backend/src/routes/candidate-prep.ts` — GET, POST /message, DELETE
- `backend/src/routes/candidate-prep.test.ts` — integration-тести router

### Modify

- `backend/src/agents/company-agent.ts` — прибрати `parseAgentReply`, re-export з `agent-reply`
- `backend/src/agents/company-agent.test.ts` — імпорт `parseAgentReply` з `agent-reply` (або лишити через re-export)
- `backend/src/auth/middleware.ts` — додати `requireCandidate`
- `backend/src/auth/middleware.test.ts` — тест `requireCandidate`
- `backend/src/server.ts` — монтувати candidate-prep router
- `backend/package.json` — додати нові test-файли в `test` script
- `README.md` — Day 11 quick-start, термінологія, curl

### Verification

- `npm --workspace backend test`
- `npm run build`

---

### Task 1: Extract `parseAgentReply` to shared module

**Files:**
- Create: `backend/src/agents/agent-reply.ts`
- Create: `backend/src/agents/agent-reply.test.ts`
- Modify: `backend/src/agents/company-agent.ts`
- Modify: `backend/src/agents/company-agent.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Create `agent-reply.ts`**

```ts
export interface ParsedAgentReply {
  message: string;
  readyForConfirmation: boolean;
}

const READY_MARKER_PATTERN = /\n?[[(]?\s*READY:\s*(true|false)\s*[\])]?[.!]?\s*$/i;

export function parseAgentReply(rawText: string): ParsedAgentReply {
  const trimmed = rawText.trim();
  const match = trimmed.match(READY_MARKER_PATTERN);

  if (!match) {
    return { message: trimmed, readyForConfirmation: false };
  }

  const message = trimmed.slice(0, match.index).trim();
  const readyForConfirmation = match[1].toLowerCase() === "true";
  return { message, readyForConfirmation };
}
```

- [ ] **Step 2: Create `agent-reply.test.ts` with parseAgentReply tests**

Скопіюй усі тести `parseAgentReply` з `company-agent.test.ts` (рядки 12–73), змінивши імпорт:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentReply } from "./agent-reply";

test("parseAgentReply extracts READY:true marker and strips it from message", () => {
  const raw = "Дякую! Це все, що потрібно.\nREADY:true";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую! Це все, що потрібно.");
  assert.equal(result.readyForConfirmation, true);
});

// ... (решта 8 тестів parseAgentReply без змін)
```

- [ ] **Step 3: Update `company-agent.ts` — remove local implementation, re-export**

Видали `ParsedAgentReply`, `READY_MARKER_PATTERN`, `parseAgentReply` з `company-agent.ts`. Додай на початку після імпортів:

```ts
export { parseAgentReply, type ParsedAgentReply } from "./agent-reply";
```

Оновити імпорт у `company-agent.ts` для внутрішнього використання не потрібен — `parseAgentReply` там не викликається.

- [ ] **Step 4: Remove duplicate parseAgentReply tests from `company-agent.test.ts`**

Видали тести `parseAgentReply` (рядки 12–73). Імпорт `parseAgentReply` прибери, якщо більше не використовується в цьому файлі.

- [ ] **Step 5: Add test files to `backend/package.json`**

У масив `test` додай після `src/agents/company-agent.test.ts`:

```
src/agents/agent-reply.test.ts
```

- [ ] **Step 6: Run tests**

Run: `npm --workspace backend test`  
Expected: PASS (усі тести, включно з `agent-reply.test.ts` і без дублікатів у `company-agent.test.ts`)

- [ ] **Step 7: Commit**

```bash
git add backend/src/agents/agent-reply.ts backend/src/agents/agent-reply.test.ts \
  backend/src/agents/company-agent.ts backend/src/agents/company-agent.test.ts \
  backend/package.json
git commit -m "refactor: extract shared parseAgentReply to agent-reply module"
```

---

### Task 2: `requireCandidate` middleware

**Files:**
- Modify: `backend/src/auth/middleware.ts`
- Modify: `backend/src/auth/middleware.test.ts`

- [ ] **Step 1: Write failing test for `requireCandidate`**

Додай в кінець `middleware.test.ts`:

```ts
test("requireCandidate returns 403 for HR role", async () => {
  const token = signToken({ sub: "u1", email: "hr@test.com", role: "HR" });

  const app = express();
  app.get(
    "/candidate-only",
    requireAuth,
    requireCandidate,
    (_req, res) => res.status(200).json({ ok: true })
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/candidate-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("requireCandidate allows CANDIDATE role", async () => {
  const token = signToken({ sub: "u2", email: "cd@test.com", role: "CANDIDATE" });

  const app = express();
  app.get(
    "/candidate-only",
    requireAuth,
    requireCandidate,
    (_req, res) => res.status(200).json({ ok: true })
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/candidate-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
```

Оновити імпорт:

```ts
import { requireAuth, requireHr, requireCandidate } from "./middleware";
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --import tsx --test src/auth/middleware.test.ts` (з `backend/`)  
Expected: FAIL — `requireCandidate is not defined` або `is not a function`

- [ ] **Step 3: Implement `requireCandidate` in `middleware.ts`**

Після `requireHr`:

```ts
export function requireCandidate(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "CANDIDATE") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test src/auth/middleware.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/middleware.ts backend/src/auth/middleware.test.ts
git commit -m "feat: add requireCandidate auth middleware"
```

---

### Task 3: Candidate Agent prompt + `buildCandidateAgentMessages`

**Files:**
- Create: `backend/src/agents/prompts/candidate-agent.uk.ts`
- Create: `backend/src/agents/candidate-agent.ts`
- Create: `backend/src/agents/candidate-agent.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing tests in `candidate-agent.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateAgentMessages } from "./candidate-agent";
import { CANDIDATE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-agent.uk";

test("buildCandidateAgentMessages prepends system prompt and maps author types", () => {
  const history = [
    { authorType: "HUMAN_CANDIDATE" as const, content: "Привіт" },
    { authorType: "AGENT_CANDIDATE" as const, content: "Розкажіть про досвід." },
  ];
  const messages = buildCandidateAgentMessages(history);

  assert.deepEqual(messages[0], { role: "system", content: CANDIDATE_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "Привіт" });
  assert.deepEqual(messages[2], { role: "assistant", content: "Розкажіть про досвід." });
});

test("buildCandidateAgentMessages appends placeholder user turn for empty history", () => {
  const messages = buildCandidateAgentMessages([]);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: CANDIDATE_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "(порожнє повідомлення)" });
});

test("buildCandidateAgentMessages appends placeholder when history ends with agent", () => {
  const history = [
    { authorType: "HUMAN_CANDIDATE" as const, content: "3 роки backend" },
    { authorType: "AGENT_CANDIDATE" as const, content: "Які ваші сильні сторони?" },
  ];
  const messages = buildCandidateAgentMessages(history);
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[3], { role: "user", content: "(порожнє повідомлення)" });
});

test("candidate system prompt mentions experience, strengths, weaknesses, and goals", () => {
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /досвід/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /сильн/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /слабк/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /ціл/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /READY:true/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --import tsx --test src/agents/candidate-agent.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: Create `prompts/candidate-agent.uk.ts`**

```ts
export const CANDIDATE_AGENT_SYSTEM_PROMPT_UK = `Ти — AI-асистент кандидата, який проводить структуроване інтерв'ю, щоб зібрати профіль перед співбесідою.

КРИТИЧНО: усі повідомлення для кандидата — ВИКЛЮЧНО українською мовою. Заборонено китайську, англійську, російську, ієрогліфи та будь-яку іншу мову.

Твоє завдання — під час діалогу зібрати достатньо конкретної інформації за чотирма темами:
1. Досвід (попередні ролі, роки, ключові проєкти, технології).
2. Сильні сторони (конкретні навички та досягнення).
3. Слабі сторони (зони росту — конструктивно, без токсичної самокритики).
4. Цілі (кар'єрні цілі, очікування від нової ролі).

Правила ведення діалогу:
- Став рівно одне запитання за раз, українською мовою.
- Не показуй кандидату весь список тем одразу — веди природну розмову.
- Якщо відповідь кандидата розпливчаста, постав одне коротке уточнювальне питання, перш ніж переходити до наступної теми.
- Ніколи не вигадуй факти за кандидата і не роби припущень замість нього.
- Якщо кандидат ще нічого не написав (порожнє повідомлення на початку розмови), привітайся і одразу постав перше питання про досвід.

Формат відповіді (дотримуйся точно щоразу):
1. Текст твого повідомлення чи запитання для кандидата.
2. Останній рядок — рівно один з двох варіантів, без дужок, крапок чи будь-яких інших символів навколо: READY:true або READY:false.

Ставай READY:true лише тоді, коли одночасно виконано:
- відбулося щонайменше 3 змістовні обміни повідомленнями з кандидатом;
- по всіх чотирьох темах (досвід, сильні сторони, слабкі сторони, цілі) зібрано конкретну інформацію, а не загальні фрази.

У всіх інших випадках завжди пиши READY:false.`;
```

- [ ] **Step 4: Create `candidate-agent.ts`**

```ts
import type { ChatMessage } from "../llm/types";
import { CANDIDATE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/candidate-agent.uk";

export type CandidatePrepAuthorType = "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";

export interface CandidatePrepHistoryItem {
  authorType: CandidatePrepAuthorType;
  content: string;
}

const EMPTY_TURN_PLACEHOLDER = "(порожнє повідомлення)";

export function buildCandidateAgentMessages(history: CandidatePrepHistoryItem[]): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: CANDIDATE_AGENT_SYSTEM_PROMPT_UK,
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
```

- [ ] **Step 5: Add to `package.json` test script**

```
src/agents/candidate-agent.test.ts
```

- [ ] **Step 6: Run tests**

Run: `node --import tsx --test src/agents/candidate-agent.test.ts`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/agents/prompts/candidate-agent.uk.ts backend/src/agents/candidate-agent.ts \
  backend/src/agents/candidate-agent.test.ts backend/package.json
git commit -m "feat: add candidate agent prompt and message builder"
```

---

### Task 4: `candidate-prep` router + integration tests

**Files:**
- Create: `backend/src/routes/candidate-prep.ts`
- Create: `backend/src/routes/candidate-prep.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing integration tests (core cases first)**

Створи `candidate-prep.test.ts` з `makeFakePrisma`, `withUser`, і цими тестами:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { requireAuth, requireCandidate, type AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { createCandidatePrepRouter } from "./candidate-prep";
import { LlmUnavailableError, LlmEmptyResponseError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type FakeInterview = { id: string; vacancyId: string; hrUserId: string };
type FakeSession = { id: string; interviewId: string; isClosed: boolean };
type FakeMessage = {
  id: string;
  sessionId: string;
  authorType: "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";
  content: string;
  createdAt: Date;
};
type FakeProfile = {
  id: string;
  interviewId: string;
  experience: unknown;
  skills: unknown;
  goals: unknown;
  summary: string;
  confirmedAt: Date | null;
};

function makeFakePrisma(
  seed: {
    interviews?: FakeInterview[];
    sessions?: FakeSession[];
    profiles?: FakeProfile[];
  } = {}
) {
  const interviews = seed.interviews ?? [];
  const sessions = seed.sessions ?? [];
  const profiles = seed.profiles ?? [];
  const messages: FakeMessage[] = [];
  let counter = 0;

  return {
    interview: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        interviews.find((item) => item.id === where.id) ?? null,
    },
    prepSessionCandidate: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        sessions.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { interviewId: string };
        create: { interviewId: string };
      }) => {
        let session = sessions.find((item) => item.interviewId === where.interviewId);
        if (!session) {
          session = { id: `session_${++counter}`, interviewId: create.interviewId, isClosed: false };
          sessions.push(session);
        }
        return session;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = sessions.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("session not found");
        const [removed] = sessions.splice(index, 1);
        return removed;
      },
    },
    prepMessageCandidate: {
      create: async ({
        data,
      }: {
        data: {
          sessionId: string;
          authorType: "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";
          content: string;
        };
      }) => {
        const message: FakeMessage = { id: `message_${++counter}`, createdAt: new Date(), ...data };
        messages.push(message);
        return message;
      },
      findMany: async ({ where }: { where: { sessionId: string } }) =>
        messages
          .filter((item) => item.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      deleteMany: async ({ where }: { where: { sessionId: string } }) => {
        const remaining = messages.filter((item) => item.sessionId !== where.sessionId);
        const removedCount = messages.length - remaining.length;
        messages.length = 0;
        messages.push(...remaining);
        return { count: removedCount };
      },
    },
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
      deleteMany: async ({ where }: { where: { interviewId: string } }) => {
        const remaining = profiles.filter((item) => item.interviewId !== where.interviewId);
        const removedCount = profiles.length - remaining.length;
        profiles.length = 0;
        profiles.push(...remaining);
        return { count: removedCount };
      },
    },
    __sessions: sessions,
    __messages: messages,
    __profiles: profiles,
    __interviews: interviews,
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function mountApp(fakePrisma: ReturnType<typeof makeFakePrisma>, fakeProvider: LlmProvider, user: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createCandidatePrepRouter(() => fakePrisma as never, () => fakeProvider));
  return app;
}

test("GET /candidate-prep/:interviewId returns empty state when no session exists", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { messages: [], isClosed: false, profile: null });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message creates session and agent message on first turn", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Вітаю! Розкажіть про ваш досвід.\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.message, "Вітаю! Розкажіть про ваш досвід.");
    assert.equal(body.readyForConfirmation, false);
    assert.equal(fakePrisma.__sessions.length, 1);
    assert.equal(fakePrisma.__messages.length, 1);
    assert.equal(fakePrisma.__messages[0].authorType, "AGENT_CANDIDATE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message saves candidate message and readyForConfirmation=true", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Дякую, цього достатньо.\nREADY:true";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "3 роки backend, Node.js, PostgreSQL" }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.readyForConfirmation, true);
    assert.equal(body.message, "Дякую, цього достатньо.");
    assert.equal(fakePrisma.__messages.length, 2);
    assert.equal(fakePrisma.__messages[0].authorType, "HUMAN_CANDIDATE");
    assert.equal(fakePrisma.__messages[1].authorType, "AGENT_CANDIDATE");
    assert.equal(fakePrisma.__messages[1].content, "Дякую, цього достатньо.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/missing/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Interview not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/message returns 409 when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Ще одна відповідь" }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Prep session closed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /candidate-prep/:interviewId removes session, messages, and unconfirmed profile", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: {},
        skills: {},
        goals: {},
        summary: "summary",
        confirmedAt: null,
      },
    ],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "AGENT_CANDIDATE",
    content: "Привіт!",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(fakePrisma.__sessions.length, 0);
    assert.equal(fakePrisma.__messages.length, 0);
    assert.equal(fakePrisma.__profiles.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /candidate-prep/:interviewId returns 409 when profile is confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: {},
        skills: {},
        goals: {},
        summary: "summary",
        confirmedAt: new Date("2026-07-08T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Profile is confirmed and cannot be reset");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("requireCandidate blocks HR token on candidate-prep routes", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };
  const token = signToken({ sub: "hr_1", email: "hr@test.com", role: "HR" });

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth, requireCandidate, createCandidatePrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --import tsx --test src/routes/candidate-prep.test.ts`  
Expected: FAIL — `createCandidatePrepRouter` not found

- [ ] **Step 3: Implement `candidate-prep.ts`**

Створи router за зразком `prep.ts`. Ключові відмінності:
- `interviewId` замість `vacancyId`
- `prepSessionCandidate` / `prepMessageCandidate` / `candidateProfile`
- `buildCandidateAgentMessages` + `parseAgentReply` з `agent-reply`
- Немає `finish` / `confirm`
- GET `profile` лише коли `session.isClosed` (як HR prep)

```ts
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { buildCandidateAgentMessages } from "../agents/candidate-agent";
import { parseAgentReply } from "../agents/agent-reply";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type MessageBody = {
  message?: unknown;
};

export function createCandidatePrepRouter(
  getPrisma: () => PrismaClient,
  getProvider: () => LlmProvider
): Router {
  const router = Router();

  router.get("/candidate-prep/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(200).json({ messages: [], isClosed: false, profile: null });
      return;
    }

    const messages = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const profile = session.isClosed
      ? await prisma.candidateProfile.findUnique({ where: { interviewId } })
      : null;

    res.status(200).json({
      messages: messages.map((item) => ({
        id: item.id,
        authorType: item.authorType,
        content: item.content,
        createdAt: item.createdAt,
      })),
      isClosed: session.isClosed,
      profile: profile
        ? {
            experience: profile.experience,
            skills: profile.skills,
            goals: profile.goals,
            summary: profile.summary,
            confirmedAt: profile.confirmedAt,
          }
        : null,
    });
  });

  router.post("/candidate-prep/:interviewId/message", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const body = (req.body ?? {}) as MessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.upsert({
      where: { interviewId },
      update: {},
      create: { interviewId },
    });

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    if (message) {
      await prisma.prepMessageCandidate.create({
        data: { sessionId: session.id, authorType: "HUMAN_CANDIDATE", content: message },
      });
    }

    const history = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCandidateAgentMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[candidate-prep:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[candidate-prep:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[candidate-prep:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    const { message: agentMessage, readyForConfirmation } = parseAgentReply(rawReply);

    try {
      await prisma.prepMessageCandidate.create({
        data: { sessionId: session.id, authorType: "AGENT_CANDIDATE", content: agentMessage },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep] failed to persist agent reply:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ message: agentMessage, readyForConfirmation });
  });

  router.delete("/candidate-prep/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const existingProfile = await prisma.candidateProfile.findUnique({ where: { interviewId } });
    if (existingProfile?.confirmedAt) {
      res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
      return;
    }

    try {
      const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
      if (session) {
        await prisma.prepMessageCandidate.deleteMany({ where: { sessionId: session.id } });
        await prisma.prepSessionCandidate.delete({ where: { id: session.id } });
      }
      await prisma.candidateProfile.deleteMany({ where: { interviewId } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:delete] failed to reset prep chat:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Add test file to `package.json`**

```
src/routes/candidate-prep.test.ts
```

- [ ] **Step 5: Run tests**

Run: `node --import tsx --test src/routes/candidate-prep.test.ts`  
Expected: PASS (усі 8 тестів)

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/candidate-prep.ts backend/src/routes/candidate-prep.test.ts backend/package.json
git commit -m "feat: add candidate prep chat API with tests"
```

---

### Task 5: Mount router in `server.ts`

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Import and mount candidate-prep router**

```ts
import { requireAuth, requireHr, requireCandidate } from "./auth/middleware";
import { createCandidatePrepRouter } from "./routes/candidate-prep";
```

Після рядка з `createPrepRouter`:

```ts
app.use(
  "/api",
  requireAuth,
  requireCandidate,
  createCandidatePrepRouter(() => prisma, () => createLlmProvider())
);
```

- [ ] **Step 2: Run full backend test suite**

Run: `npm --workspace backend test`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat: mount candidate prep router behind requireCandidate"
```

---

### Task 6: README — Day 11 documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Day 11 section**

Після блоку `## День 11 — Candidate Agent (серверна частина)` додай підрозділи (за аналогією з Day 10):

**Terminology:**

| Назва | Prisma | Автори повідомлень |
|-------|--------|-------------------|
| COMPANY_PREP | `PrepSessionHr` | `HUMAN_HR`, `AGENT_COMPANY` |
| CANDIDATE_PREP | `PrepSessionCandidate` | `HUMAN_CANDIDATE`, `AGENT_CANDIDATE` |

**API endpoints** (усі вимагають `Authorization: Bearer <candidate-token>`):

| Метод | Шлях | Опис |
|-------|------|------|
| `GET` | `/candidate-prep/:interviewId` | Історія чату |
| `POST` | `/candidate-prep/:interviewId/message` | Надіслати повідомлення → відповідь агента |
| `DELETE` | `/candidate-prep/:interviewId` | Скинути чат |

**Candidate Prep Quick Start:**

```bash
# 1. Зареєструвати кандидата (якщо ще немає)
curl -s -X POST http://localhost:3000/api/auth/candidate/register \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}'

# 2. Логін
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/candidate/login \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}' | jq -r .token)

# 3. interviewId з seed (joinCode=TEST01) — див. вивід db:seed
INTERVIEW_ID="<interviewId-from-seed>"

# 4. Привітання агента (порожнє повідомлення)
curl -s -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":""}' | jq

# 5. Відповідь кандидата
curl -s -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"3 роки backend, Node.js, PostgreSQL"}' | jq

# 6. Ще один обмін + перевірка історії
curl -s "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Примітка:** на Дні 11 не перевіряється `interview.candidateUserId` — будь-який авторизований кандидат може писати в prep за відомим `interviewId`. Ownership check — День 14.

- [ ] **Step 2: Mark Day 11 DoD checkboxes** лише якщо ручна перевірка пройдена; інакше залиш `[ ]` і додай примітку що API готовий до перевірки.

- [ ] **Step 3: Run full build**

Run: `npm run build`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add Day 11 candidate prep API quick-start"
```

---

### Task 7: Manual verification (Day 11 DoD)

- [ ] **Step 1: Start services**

```bash
# terminal 1: omlx (якщо локально)
omlx serve --port 8000

# terminal 2: backend + DB
docker compose up -d postgres
npm --workspace backend run db:seed
npm run dev
```

- [ ] **Step 2: Run 3+ message exchanges via curl** (quick-start з README)

Expected:
- Агент відповідає українською про досвід/навички
- `GET` повертає зростаючу історію в `PrepMessageCandidate`
- HR-токен на `/api/candidate-prep/...` → `403`

- [ ] **Step 3: Update README DoD checkboxes to `[x]`** після успішної перевірки

- [ ] **Step 4: Final commit (if only checkbox changes)**

```bash
git add README.md
git commit -m "docs: mark Day 11 candidate prep DoD complete"
```

---

## Plan Self-Review

| Spec requirement | Task |
|------------------|------|
| Candidate Agent prompt (4 themes) | Task 3 |
| POST message → agent reply + readyForConfirmation | Task 4 |
| GET history + isClosed + profile | Task 4 |
| DELETE reset | Task 4 |
| PrepSessionCandidate / PrepMessageCandidate persistence | Task 4 |
| requireCandidate auth | Task 2, 5 |
| interview exists check, no ownership | Task 4 |
| parseAgentReply shared refactor | Task 1 |
| README terminology + curl | Task 6 |
| Manual 3+ exchanges demo | Task 7 |

No placeholders. Types consistent across tasks.

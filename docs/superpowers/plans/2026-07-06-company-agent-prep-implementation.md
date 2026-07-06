# Company Agent Prep Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR може через `POST /api/prep/:interviewId/message` вести чат з Company Agent (мінімум 3 обміни), який ставить питання про вакансію, вимоги, культуру й очікування, зберігає повну історію в `PrepSessionHr`/`PrepMessageHr` і сигналізує `readyForConfirmation`, коли даних достатньо.

**Architecture:** Чиста логіка агента (`buildCompanyAgentMessages`, `parseAgentReply`) окремо від HTTP/Prisma-обв'язки (`routes/prep.ts`), за тим самим поділом, що вже є між `llm/` і `routes/llm.ts`. Готовність сигналізується текстовим маркером `READY:true|false` в кінці відповіді LLM (безпечний fallback `false` при відсутності маркера). Seed розширюється тестовим `Interview`, бо `POST /interviews` з'явиться лише в День 8.

**Tech Stack:** Express + TypeScript, Prisma (`PrepSessionHr`, `PrepMessageHr`, `Interview`), наявний `LlmProvider` (omlx/gemini), `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-06-company-agent-prep-design.md`

---

## File Structure

| File | Відповідальність |
|------|------------------|
| `backend/src/agents/prompts/company-agent.uk.ts` | Константа `COMPANY_AGENT_SYSTEM_PROMPT_UK` — system prompt українською |
| `backend/src/agents/company-agent.ts` | `parseAgentReply`, `buildCompanyAgentMessages` — чиста, тестована логіка агента |
| `backend/src/agents/company-agent.test.ts` | Unit-тести парсингу маркера й побудови контексту |
| `backend/src/routes/prep.ts` | `POST /prep/:interviewId/message` — HTTP/Prisma/LLM обв'язка |
| `backend/src/routes/prep.test.ts` | HTTP-тести роуту (fake Prisma + fake LlmProvider) |
| `backend/src/server.ts` | Підключення `createPrepRouter` за `requireAuth` + `requireHr` |
| `backend/src/seed/hr-user.js` | Модифікація: `seedHrUser` повертає ще й `id` |
| `backend/src/seed/hr-user.test.js` | Модифікація: перевірка, що `id` повертається |
| `backend/src/seed/hr-interview.js` | `seedHrInterview` — upsert тестового `Interview` (DRAFT) |
| `backend/src/seed/hr-interview.test.js` | Unit-тест `seedHrInterview` |
| `backend/prisma/seed.js` | Виклик `seedHrInterview` після `seedHrUser`, лог `id`/`joinCode` |
| `backend/package.json` | Додавання нових тестових файлів у script `test` |
| `README.md` | Секція День 4: quick start, curl-приклад, DoD |

> Примітка щодо відхилення від дизайн-спеку: спек згадував `company-agent.uk.md`. Обрано `.ts`-файл з експортованою константою замість `.md`, який довелося б читати через `fs` у рантаймі (зайва складність з `tsc`-білдом і шляхами після компіляції). Поведінка та ізоляція промпту від логіки — ті самі, що описані в спеку.

---

### Task 1: Company Agent — промпт і чиста логіка

**Files:**
- Create: `backend/src/agents/prompts/company-agent.uk.ts`
- Create: `backend/src/agents/company-agent.ts`
- Create: `backend/src/agents/company-agent.test.ts`
- Modify: `backend/package.json` (додати тест у script `test`)

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/agents/company-agent.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanyAgentMessages, parseAgentReply } from "./company-agent";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";

test("parseAgentReply extracts READY:true marker and strips it from message", () => {
  const raw = "Дякую! Це все, що потрібно.\nREADY:true";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую! Це все, що потрібно.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply extracts READY:false marker and strips it from message", () => {
  const raw = "Розкажіть більше про вимоги до кандидата.\nREADY:false";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Розкажіть більше про вимоги до кандидата.");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply falls back to readyForConfirmation=false when marker is missing", () => {
  const raw = "Яка це посада?";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Яка це посада?");
  assert.equal(result.readyForConfirmation, false);
});

test("parseAgentReply is case-insensitive and tolerates trailing whitespace", () => {
  const raw = "Дякую.\nready:TRUE  \n";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Дякую.");
  assert.equal(result.readyForConfirmation, true);
});

test("parseAgentReply handles marker with no preceding newline", () => {
  const raw = "Питання?READY:false";
  const result = parseAgentReply(raw);
  assert.equal(result.message, "Питання?");
  assert.equal(result.readyForConfirmation, false);
});

test("buildCompanyAgentMessages prepends system prompt and maps author types", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Привіт" },
    { authorType: "AGENT_COMPANY" as const, content: "Яка це посада?" },
  ];
  const messages = buildCompanyAgentMessages(history);

  assert.deepEqual(messages[0], { role: "system", content: COMPANY_AGENT_SYSTEM_PROMPT_UK });
  assert.deepEqual(messages[1], { role: "user", content: "Привіт" });
  assert.deepEqual(messages[2], { role: "assistant", content: "Яка це посада?" });
});

test("buildCompanyAgentMessages returns only system prompt for empty history", () => {
  const messages = buildCompanyAgentMessages([]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "system");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/company-agent.test.ts`

Expected: FAIL — `Cannot find module './company-agent'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/prompts/company-agent.uk.ts
export const COMPANY_AGENT_SYSTEM_PROMPT_UK = `Ти — AI-асистент компанії, який проводить структуроване інтерв'ю з HR-менеджером, щоб зібрати профіль вакансії перед співбесідою з кандидатом.

Твоє завдання — під час діалогу зібрати достатньо конкретної інформації за чотирма темами:
1. Посада (роль, рівень — junior/middle/senior, команда).
2. Вимоги (обов'язкові й бажані навички, досвід, технології).
3. Культура компанії (цінності, стиль роботи команди, формат — офіс/віддалено/гібрид).
4. Очікування від кандидата на цій посаді в перші місяці роботи.

Правила ведення діалогу:
- Став рівно одне запитання за раз, українською мовою.
- Не показуй HR весь список тем одразу — веди природну розмову.
- Якщо відповідь HR розпливчаста, постав одне коротке уточнювальне питання, перш ніж переходити до наступної теми.
- Ніколи не вигадуй факти за HR і не роби припущень замість нього.
- Якщо HR ще нічого не написав (порожнє повідомлення на початку розмови), привітайся і одразу постав перше питання про посаду.

Формат відповіді (дотримуйся точно щоразу):
1. Текст твого повідомлення чи запитання для HR.
2. Останній рядок — рівно один з двох варіантів без жодних додаткових символів чи пояснень: READY:true або READY:false.

Ставай READY:true лише тоді, коли одночасно виконано:
- відбулося щонайменше 3 змістовні обміни повідомленнями з HR;
- по всіх чотирьох темах (посада, вимоги, культура, очікування) зібрано конкретну інформацію, а не загальні фрази.

У всіх інших випадках завжди пиши READY:false.`;
```

```typescript
// backend/src/agents/company-agent.ts
import type { ChatMessage } from "../llm/types";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";

export type PrepAuthorType = "HUMAN_HR" | "AGENT_COMPANY";

export interface PrepHistoryItem {
  authorType: PrepAuthorType;
  content: string;
}

export interface ParsedAgentReply {
  message: string;
  readyForConfirmation: boolean;
}

const READY_MARKER_PATTERN = /\n?READY:(true|false)\s*$/i;

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

export function buildCompanyAgentMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: COMPANY_AGENT_SYSTEM_PROMPT_UK,
  };

  const historyMessages: ChatMessage[] = history.map((item) => ({
    role: item.authorType === "HUMAN_HR" ? "user" : "assistant",
    content: item.content,
  }));

  return [systemMessage, ...historyMessages];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/company-agent.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 5: Add to package.json test script**

Модифікувати `backend/package.json`, поле `scripts.test`, додати `src/agents/company-agent.test.ts` в кінець списку:

```
"test": "node --import tsx --test src/db/healthcheck.test.js src/seed/hr-user.test.js src/db/seed-check.test.ts src/routes/health.test.ts src/llm/omlx.provider.test.ts src/llm/factory.test.ts src/routes/llm.test.ts src/auth/password.test.ts src/auth/jwt.test.ts src/auth/middleware.test.ts src/routes/auth.test.ts src/agents/company-agent.test.ts"
```

- [ ] **Step 6: Run full backend test suite**

Run: `npm --workspace backend test`

Expected: PASS (усі попередні тести + 7 нових).

- [ ] **Step 7: Commit**

```bash
git add backend/src/agents/prompts/company-agent.uk.ts backend/src/agents/company-agent.ts backend/src/agents/company-agent.test.ts backend/package.json
git commit -m "feat(backend): add company agent prompt and reply parsing"
```

---

### Task 2: Prep router — `POST /prep/:interviewId/message`

**Files:**
- Create: `backend/src/routes/prep.ts`
- Create: `backend/src/routes/prep.test.ts`
- Modify: `backend/package.json` (додати тест у script `test`)

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/prep.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { requireAuth, requireHr, type AuthUser } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { createPrepRouter } from "./prep";
import { LlmUnavailableError, LlmEmptyResponseError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type FakeInterview = { id: string; hrUserId: string };
type FakeSession = { id: string; interviewId: string; isClosed: boolean };
type FakeMessage = {
  id: string;
  sessionId: string;
  authorType: "HUMAN_HR" | "AGENT_COMPANY";
  content: string;
  createdAt: Date;
};

function makeFakePrisma(seed: { interviews?: FakeInterview[]; sessions?: FakeSession[] } = {}) {
  const interviews = seed.interviews ?? [];
  const sessions = seed.sessions ?? [];
  const messages: FakeMessage[] = [];
  let counter = 0;

  return {
    interview: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        interviews.find((item) => item.id === where.id) ?? null,
    },
    prepSessionHr: {
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
    },
    prepMessageHr: {
      create: async ({
        data,
      }: {
        data: { sessionId: string; authorType: "HUMAN_HR" | "AGENT_COMPANY"; content: string };
      }) => {
        const message: FakeMessage = { id: `message_${++counter}`, createdAt: new Date(), ...data };
        messages.push(message);
        return message;
      },
      findMany: async ({ where }: { where: { sessionId: string } }) =>
        messages
          .filter((item) => item.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    },
    __sessions: sessions,
    __messages: messages,
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

test("POST /prep/:interviewId/message creates session and both messages on first turn", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Привіт! Розкажіть, будь ласка, про вакансію.\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.message, "Привіт! Розкажіть, будь ласка, про вакансію.");
    assert.equal(body.readyForConfirmation, false);
    assert.equal(fakePrisma.__sessions.length, 1);
    assert.equal(fakePrisma.__messages.length, 1);
    assert.equal(fakePrisma.__messages[0].authorType, "AGENT_COMPANY");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message saves HR message and extracts readyForConfirmation=true", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Дякую, цього достатньо.\nREADY:true";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Middle Backend Developer, 3+ роки досвіду" }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.readyForConfirmation, true);
    assert.equal(body.message, "Дякую, цього достатньо.");
    assert.equal(fakePrisma.__messages.length, 2);
    assert.equal(fakePrisma.__messages[0].authorType, "HUMAN_HR");
    assert.equal(fakePrisma.__messages[0].content, "Middle Backend Developer, 3+ роки досвіду");
    assert.equal(fakePrisma.__messages[1].authorType, "AGENT_COMPANY");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/missing/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Interview not found");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 403 when interview belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_other" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 409 when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Ще одне питання" }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Prep session closed");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 503 when LLM unavailable", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      throw new LlmUnavailableError("omlx server not reachable");
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "LLM unavailable");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 502 when LLM returns empty response", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      throw new LlmEmptyResponseError();
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 502);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message returns 401 without auth when middleware applied", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth, requireHr, createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /prep/:interviewId/message works with valid token through requireAuth+requireHr", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  const token = signToken({ sub: "hr_1", email: "hr@test.com", role: "HR" });
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Привіт!\nREADY:false";
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth, requireHr, createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/routes/prep.test.ts`

Expected: FAIL — `Cannot find module './prep'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/routes/prep.ts
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { buildCompanyAgentMessages, parseAgentReply } from "../agents/company-agent";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { LlmProvider } from "../llm/types";

type MessageBody = {
  message?: unknown;
};

export function createPrepRouter(
  getPrisma: () => PrismaClient,
  getProvider: () => LlmProvider
): Router {
  const router = Router();

  router.post("/prep/:interviewId/message", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const body = (req.body ?? {}) as MessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const session = await prisma.prepSessionHr.upsert({
      where: { interviewId },
      update: {},
      create: { interviewId },
    });

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    if (message) {
      await prisma.prepMessageHr.create({
        data: { sessionId: session.id, authorType: "HUMAN_HR", content: message },
      });
    }

    const history = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCompanyAgentMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    try {
      const rawReply = await provider.complete(llmMessages);
      const { message: agentMessage, readyForConfirmation } = parseAgentReply(rawReply);

      await prisma.prepMessageHr.create({
        data: { sessionId: session.id, authorType: "AGENT_COMPANY", content: agentMessage },
      });

      res.status(200).json({ message: agentMessage, readyForConfirmation });
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[prep:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[prep:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[prep:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/routes/prep.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 5: Add to package.json test script**

Додати `src/routes/prep.test.ts` в кінець рядка `scripts.test` у `backend/package.json`.

- [ ] **Step 6: Run full backend test suite**

Run: `npm --workspace backend test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts backend/package.json
git commit -m "feat(backend): add prep message endpoint for company agent"
```

---

### Task 3: Підключити prep router у server.ts

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Update server.ts**

```typescript
// backend/src/server.ts — додати імпорт і маршрут
import { createPrepRouter } from "./routes/prep";

// після рядка, що монтує createLlmRouter:
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, () => createLlmProvider()));
```

Повний блок монтування роутів після зміни:

```typescript
app.use("/api", createHealthRouter(() => prisma));
app.use("/api", createAuthRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createLlmRouter(() => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, () => createLlmProvider()));
```

- [ ] **Step 2: Run full backend test suite**

Run: `npm --workspace backend test`

Expected: PASS (нічого не зламано; `prep.test.ts` вже покриває 401/200-сценарії з реальним middleware).

- [ ] **Step 3: Run backend build**

Run: `npm --workspace backend run build`

Expected: PASS без помилок TypeScript.

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat(backend): wire prep router into server"
```

---

### Task 4: seedHrUser повертає id (потрібно для FK тестового Interview)

**Files:**
- Modify: `backend/src/seed/hr-user.js`
- Modify: `backend/src/seed/hr-user.test.js`

- [ ] **Step 1: Write the failing assertion**

Додати в кінець тесту `"seedHrUser upserts HR user with hashed password"` у `backend/src/seed/hr-user.test.js` (перед закриваючою дужкою тесту):

```javascript
  assert.equal(result.id, "user_1");
```

Повний тест після зміни:

```javascript
test("seedHrUser upserts HR user with hashed password", async () => {
  const calls = [];

  const fakePrisma = {
    user: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "user_1", ...args.create };
      },
    },
  };

  const UserRole = { HR: "HR", CANDIDATE: "CANDIDATE" };
  const result = await seedHrUser(fakePrisma, { UserRole });

  assert.equal(result.email, "hr@test.com");
  assert.equal(result.id, "user_1");
  assert.equal(calls.length, 1);

  const upsertArgs = calls[0];
  assert.equal(upsertArgs.where.email, "hr@test.com");
  assert.equal(
    upsertArgs.create.passwordHash,
    "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
  );
  assert.equal(upsertArgs.create.role, UserRole.HR);
  assert.equal(upsertArgs.update.passwordHash, upsertArgs.create.passwordHash);
  assert.equal(upsertArgs.update.role, UserRole.HR);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/seed/hr-user.test.js`

Expected: FAIL — `result.id` is `undefined`, очікується `"user_1"`.

- [ ] **Step 3: Update implementation**

```javascript
// backend/src/seed/hr-user.js — замінити тіло seedHrUser
async function seedHrUser(prisma, { UserRole }) {
  const { email, password, role } = SEED_HR_USER;
  const passwordHash = hashPassword(password);
  const userRole = UserRole[role];

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: userRole,
    },
    create: {
      email,
      passwordHash,
      role: userRole,
    },
  });

  return { id: user.id, email: user.email };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/seed/hr-user.test.js`

Expected: PASS (3 tests).

- [ ] **Step 5: Run full backend test suite**

Run: `npm --workspace backend test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/seed/hr-user.js backend/src/seed/hr-user.test.js
git commit -m "fix(backend): return id from seedHrUser for downstream seeds"
```

---

### Task 5: Seed тестового Interview

**Files:**
- Create: `backend/src/seed/hr-interview.js`
- Create: `backend/src/seed/hr-interview.test.js`
- Modify: `backend/package.json` (додати тест у script `test`)

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/seed/hr-interview.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED_INTERVIEW, seedHrInterview } = require("./hr-interview");

test("SEED_INTERVIEW has fixed test join code", () => {
  assert.deepEqual(SEED_INTERVIEW, { joinCode: "TEST01" });
});

test("seedHrInterview upserts DRAFT interview for given HR user", async () => {
  const calls = [];
  const fakePrisma = {
    interview: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "interview_1", ...args.create };
      },
    },
  };

  const result = await seedHrInterview(fakePrisma, "user_hr_1");

  assert.equal(result.id, "interview_1");
  assert.equal(result.joinCode, "TEST01");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.joinCode, "TEST01");
  assert.equal(calls[0].create.hrUserId, "user_hr_1");
  assert.equal(calls[0].create.joinCode, "TEST01");
  assert.equal(calls[0].create.status, "DRAFT");
  assert.equal(calls[0].update.hrUserId, "user_hr_1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/seed/hr-interview.test.js`

Expected: FAIL — `Cannot find module './hr-interview'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/seed/hr-interview.js
const SEED_INTERVIEW = {
  joinCode: "TEST01",
};

async function seedHrInterview(prisma, hrUserId) {
  const interview = await prisma.interview.upsert({
    where: { joinCode: SEED_INTERVIEW.joinCode },
    update: { hrUserId },
    create: {
      hrUserId,
      joinCode: SEED_INTERVIEW.joinCode,
      status: "DRAFT",
    },
  });

  return { id: interview.id, joinCode: interview.joinCode };
}

module.exports = {
  SEED_INTERVIEW,
  seedHrInterview,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/seed/hr-interview.test.js`

Expected: PASS (2 tests).

- [ ] **Step 5: Add to package.json test script**

Додати `src/seed/hr-interview.test.js` в кінець рядка `scripts.test` у `backend/package.json`.

- [ ] **Step 6: Run full backend test suite**

Run: `npm --workspace backend test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/seed/hr-interview.js backend/src/seed/hr-interview.test.js backend/package.json
git commit -m "feat(backend): add seed for test interview"
```

---

### Task 6: Підключити seed тестового Interview у prisma/seed.js

**Files:**
- Modify: `backend/prisma/seed.js`

- [ ] **Step 1: Update seed.js**

```javascript
// backend/prisma/seed.js
require("dotenv/config");
const { PrismaClient, UserRole } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { seedHrUser } = require("../src/seed/hr-user");
const { seedHrInterview } = require("../src/seed/hr-interview");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";

const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl }));
const prisma = new PrismaClient({ adapter });

async function main() {
  const hrUser = await seedHrUser(prisma, { UserRole });
  console.log(`Seeded HR user: ${hrUser.email}`);

  const interview = await seedHrInterview(prisma, hrUser.id);
  console.log(`Seeded test interview: id=${interview.id} joinCode=${interview.joinCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Run seed against local Postgres**

Run: `npm --workspace backend run db:seed`

Expected output includes:

```
Seeded HR user: hr@test.com
Seeded test interview: id=<cuid> joinCode=TEST01
```

Записати виведений `id` — знадобиться для ручної перевірки в Task 8.

- [ ] **Step 3: Run full backend test suite**

Run: `npm --workspace backend test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.js
git commit -m "feat(backend): seed test interview alongside HR user"
```

---

### Task 7: README — Company Agent Quick Start (День 4)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Додати секцію після "День 4 — Company Agent (серверна частина)"**

Додати перед наступним `---` (перед секцією "День 5"):

```markdown
### Company Agent Quick Start (Day 4)

**1. Отримати id тестової співбесіди** (створюється разом з HR під час `db:seed`):

```bash
npm --workspace backend run db:seed
```

У виводі буде рядок на кшталт:

```
Seeded test interview: id=clx1a2b3c4d5e6f7g8h9i0j1k joinCode=TEST01
```

Скопіюй значення `id` — це `<interviewId>` для наступних кроків.

**2. Логін HR:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@test.com","password":"123456"}'
```

**3. Перше повідомлення (агент сам вітається і ставить перше питання):**

```bash
TOKEN="<token-from-login>"
INTERVIEW_ID="<interviewId-from-seed>"

curl -X POST "http://localhost:3000/api/prep/$INTERVIEW_ID/message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

Очікувана відповідь:

```json
{ "message": "Привіт! Розкажіть, будь ласка, про вакансію — яка це посада?", "readyForConfirmation": false }
```

**4. Продовжити діалог (мінімум 3 обміни):**

```bash
curl -X POST "http://localhost:3000/api/prep/$INTERVIEW_ID/message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Middle Backend Developer, потрібен досвід з Node.js та PostgreSQL"}'
```

Повторити з наступними відповідями про вимоги, культуру й очікування. Коли даних достатньо, відповідь міститиме `"readyForConfirmation": true`.

**5. Перевірка в базі:** повідомлення зберігаються в таблицях `PrepSessionHr` і `PrepMessageHr`, прив'язаних до `interviewId`.
```

- [ ] **Step 2: Позначити DoD Дня 4 як виконаний**

Замінити в секції "День 4":

```markdown
**Definition of Done:**
- [x] Демонстрація: через Postman/curl HR веде діалог з Company Agent (мінімум 3 обміни)
- [x] Сценарій: повідомлення зберігаються в `ChatSession` + `Message`; відповіді агента релевантні темі вакансії
- [x] Збірка: `npm run build` проходить
- [x] README: endpoint `POST /prep/:interviewId/message`, приклад запиту/відповіді
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Day 4 company agent quick start and mark DoD"
```

---

### Task 8: Фінальна верифікація

**Files:** немає змін коду — лише перевірка.

- [ ] **Step 1: Повний білд монорепо**

Run: `npm run build`

Expected: PASS без помилок (frontend + backend).

- [ ] **Step 2: Повний backend test suite**

Run: `npm --workspace backend test`

Expected: PASS — усі тести, включно з новими для `company-agent`, `prep`, `hr-interview`, оновленим `hr-user`.

- [ ] **Step 3: Ручний сценарій (потребує запущеного Postgres і LLM-провайдера)**

```bash
docker compose up -d postgres
npm --workspace backend run db:migrate
npm --workspace backend run db:seed
npm run dev
```

В окремому терміналі — виконати кроки 2–4 з README Company Agent Quick Start (мінімум 3 обміни), перевірити:
1. Кожна відповідь — `200` з полями `message` і `readyForConfirmation`.
2. Останній обмін повертає `readyForConfirmation: true`.
3. У базі є один `PrepSessionHr` для інтерв'ю і всі повідомлення в `PrepMessageHr` у правильному порядку.
4. Повторний запит без токена → `401`.
5. Запит з чужим `interviewId` (неіснуючий id) → `404`.

- [ ] **Step 4: Якщо все пройшло — фінальний коміт (якщо залишились незакомічені зміни, наприклад нотатки README)**

```bash
git status
```

Якщо є незакомічені зміни — закомітити їх окремим комітом з описовим повідомленням.

---

## Spec Coverage

| Spec requirement | Task |
|---|---|
| `POST /prep/:interviewId/message` контракт | Task 2, 3 |
| Автостворення `PrepSessionHr` | Task 2 |
| Перший запуск без `message` → агент вітається | Task 1, 2 |
| `readyForConfirmation` через текстовий маркер `READY:true\|false` | Task 1, 2 |
| Промпт покриває посаду/вимоги/культуру/очікування | Task 1 |
| Ownership-перевірка (403) | Task 2 |
| 404 неіснуюча співбесіда | Task 2 |
| 409 закрита сесія | Task 2 |
| 503/502 помилки LLM | Task 2 |
| `requireAuth` + `requireHr` захист | Task 2, 3 |
| Seed тестового `Interview` (обхід відсутності Дня 8) | Task 4, 5, 6 |
| README quick start + DoD | Task 7 |
| `npm run build` без помилок | Task 3, 8 |

## Execution Handoff

План збережено в `docs/superpowers/plans/2026-07-06-company-agent-prep-implementation.md`. Два варіанти виконання:

**1. Subagent-Driven (рекомендовано)** — окремий subagent на кожну задачу, рев'ю між задачами.

**2. Inline Execution** — виконання в цій сесії через executing-plans, батчами з чекпоінтами.

Який підхід обираєш?

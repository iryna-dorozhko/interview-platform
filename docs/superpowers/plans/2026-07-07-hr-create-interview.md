# HR Create Interview (Day 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HR create a new interview via a "Створити співбесіду" button, generating a unique 6-character join code (`DRAFT` status) that HR can then take into the existing prep flow (Days 4–7).

**Architecture:** New `generateJoinCode()` utility (`backend/src/utils/joinCode.ts`) produces a 6-character code from a confusable-character-free alphabet. A new `POST /api/interviews` endpoint on the existing `interviews.ts` router creates an `Interview` row (`status: DRAFT`) with a generated code, retrying on unique-constraint collisions. The frontend adds a "Створити співбесіду" button to `HomeView.vue` that calls this endpoint and displays the returned code in a banner with a link into the existing `/prep/:interviewId` flow.

**Tech Stack:** Express + Prisma (backend), Node's built-in `node:crypto`/`node:test`/`assert`, Vue 3 `<script setup>` + TypeScript (frontend, no test runner configured — verified via `vue-tsc`/manual check).

**Spec:** `docs/superpowers/specs/2026-07-07-hr-create-interview-design.md`

---

### Task 1: Join code generator utility

**Files:**
- Create: `backend/src/utils/joinCode.ts`
- Create: `backend/src/utils/joinCode.test.ts`
- Modify: `backend/package.json:10` (`test` script — add the new test file)

- [ ] **Step 1: Write the failing tests**

Create `backend/src/utils/joinCode.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { generateJoinCode } from "./joinCode";

test("generateJoinCode returns a 6-character code", () => {
  const code = generateJoinCode();
  assert.equal(code.length, 6);
});

test("generateJoinCode only uses the allowed alphabet (no 0/O/1/I)", () => {
  const code = generateJoinCode();
  assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
});

test("generateJoinCode produces different codes across many calls", () => {
  const codes = new Set(Array.from({ length: 50 }, () => generateJoinCode()));
  assert.ok(codes.size > 1, "expected at least some variation across 50 generated codes");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --import tsx --test src/utils/joinCode.test.ts`
Expected: FAIL — `Cannot find module './joinCode'` (file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `backend/src/utils/joinCode.ts`:

```ts
import crypto from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

export function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/utils/joinCode.test.ts`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Register the test file in the workspace test script**

In `backend/package.json`, append `src/utils/joinCode.test.ts` to the end of the `test` script (after `src/routes/interviews.test.ts`):

```json
    "test": "node --import tsx --test src/db/healthcheck.test.js src/seed/hr-user.test.js src/db/seed-check.test.ts src/routes/health.test.ts src/llm/omlx.provider.test.ts src/llm/gemini.provider.test.ts src/llm/openai.provider.test.ts src/llm/factory.test.ts src/routes/llm.test.ts src/auth/password.test.ts src/auth/jwt.test.ts src/auth/middleware.test.ts src/routes/auth.test.ts src/agents/company-agent.test.ts src/routes/prep.test.ts src/seed/hr-interview.test.js src/routes/interviews.test.ts src/utils/joinCode.test.ts",
```

Run (from `backend/`): `npm test`
Expected: all existing suites still PASS, plus the 3 new `joinCode` tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/joinCode.ts backend/src/utils/joinCode.test.ts backend/package.json
git commit -m "feat: add join code generator utility"
```

---

### Task 2: `POST /api/interviews` endpoint

**Files:**
- Modify: `backend/src/routes/interviews.ts` (add `POST /interviews` handler)
- Modify: `backend/src/routes/interviews.test.ts` (add `create` support to the fake Prisma double, add new tests)

Auth/role enforcement (`requireAuth`, `requireHr`) is already applied to this whole router in `backend/src/server.ts:31` and is covered by `backend/src/auth/middleware.test.ts` — no new auth tests needed here, consistent with the existing `GET /interviews/mine` tests which also inject `req.user` directly rather than re-testing the middleware.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/routes/interviews.test.ts` with:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createInterviewsRouter } from "./interviews";

type FakeInterview = { id: string; hrUserId: string; joinCode: string; status: string; createdAt: Date };
type CreateInput = { data: { hrUserId: string; joinCode: string; status: string } };
type CreateImpl = (input: CreateInput) => Promise<FakeInterview> | FakeInterview;

function makeFakePrisma(interviews: FakeInterview[] = [], createImpl?: CreateImpl) {
  let counter = 0;
  return {
    interview: {
      findMany: async ({ where }: { where: { hrUserId: string } }) =>
        interviews
          .filter((item) => item.hrUserId === where.hrUserId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      create: async (input: CreateInput) => {
        if (createImpl) return createImpl(input);
        counter += 1;
        const created: FakeInterview = {
          id: `generated_${counter}`,
          hrUserId: input.data.hrUserId,
          joinCode: input.data.joinCode,
          status: input.data.status,
          createdAt: new Date(),
        };
        interviews.push(created);
        return created;
      },
    },
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user: AuthUser) {
  const app = express();
  app.use(withUser(user));
  app.use("/api", createInterviewsRouter(() => fakePrisma as never));
  return app;
}

test("GET /interviews/mine returns interviews for the current HR only, newest first", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "i1", hrUserId: "hr_1", joinCode: "AAAAAA", status: "DRAFT", createdAt: new Date(1) },
    { id: "i2", hrUserId: "hr_other", joinCode: "BBBBBB", status: "DRAFT", createdAt: new Date(2) },
    { id: "i3", hrUserId: "hr_1", joinCode: "CCCCCC", status: "DRAFT", createdAt: new Date(3) },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 2);
    assert.equal(body.interviews[0].id, "i3");
    assert.equal(body.interviews[1].id, "i1");
    assert.deepEqual(Object.keys(body.interviews[0]).sort(), ["id", "joinCode", "status"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/mine returns empty array when HR has no interviews", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.interviews, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews creates a DRAFT interview with a 6-character join code", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.interview.status, "DRAFT");
    assert.equal(typeof body.interview.id, "string");
    assert.match(body.interview.joinCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews returns a different join code on each call", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const first = await (await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" })).json();
    const second = await (await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" })).json();
    assert.notEqual(first.interview.joinCode, second.interview.joinCode);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews retries once when the generated join code collides, then succeeds", async () => {
  let attempts = 0;
  const createImpl: CreateImpl = async (input) => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("Unique constraint failed") as Error & { code: string };
      error.code = "P2002";
      throw error;
    }
    return {
      id: "generated_after_retry",
      hrUserId: input.data.hrUserId,
      joinCode: input.data.joinCode,
      status: input.data.status,
      createdAt: new Date(),
    };
  };
  const fakePrisma = makeFakePrisma([], createImpl);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
    assert.equal(response.status, 201);
    assert.equal(attempts, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /interviews returns 500 after exhausting retries on repeated collisions", async () => {
  const createImpl: CreateImpl = async () => {
    const error = new Error("Unique constraint failed") as Error & { code: string };
    error.code = "P2002";
    throw error;
  };
  const fakePrisma = makeFakePrisma([], createImpl);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Failed to generate unique join code");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("interview created via POST /interviews appears in GET /interviews/mine", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    await fetch(`http://127.0.0.1:${port}/api/interviews`, { method: "POST" });
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    const body = await response.json();
    assert.equal(body.interviews.length, 1);
    assert.equal(body.interviews[0].status, "DRAFT");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run (from `backend/`): `node --import tsx --test src/routes/interviews.test.ts`
Expected: the 2 `GET /interviews/mine` tests PASS (refactor-only change), the 5 new `POST /interviews` tests FAIL with `404` (route doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Replace the full contents of `backend/src/routes/interviews.ts` with:

```ts
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { generateJoinCode } from "../utils/joinCode";

const MAX_CREATE_ATTEMPTS = 5;

export function createInterviewsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/interviews/mine", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviews = await prisma.interview.findMany({
      where: { hrUserId: req.user?.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      interviews: interviews.map((item) => ({
        id: item.id,
        joinCode: item.joinCode,
        status: item.status,
      })),
    });
  });

  router.post("/interviews", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const hrUserId = req.user?.id as string;

    for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode();
      try {
        const interview = await prisma.interview.create({
          data: { hrUserId, joinCode, status: "DRAFT" },
        });
        res.status(201).json({
          interview: {
            id: interview.id,
            joinCode: interview.joinCode,
            status: interview.status,
            createdAt: interview.createdAt,
          },
        });
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        const isLastAttempt = attempt === MAX_CREATE_ATTEMPTS;
        if (code === "P2002" && !isLastAttempt) {
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[interviews:create] failed to create interview:", detail);
        res.status(500).json({ error: "Failed to generate unique join code" });
        return;
      }
    }
  });

  return router;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/routes/interviews.test.ts`
Expected: PASS — 7 tests, 0 failures.

Then run the full backend suite: `npm test` (from `backend/`)
Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts
git commit -m "feat: add POST /interviews endpoint for HR to create a new interview"
```

---

### Task 3: Frontend API client for creating an interview

**Files:**
- Modify: `frontend/src/api/interviews.ts`

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `frontend/src/api/interviews.ts` with:

```ts
import { fetchWithAuth } from "./client";

export type InterviewSummary = {
  id: string;
  joinCode: string;
  status: string;
};

export type CreatedInterview = {
  id: string;
  joinCode: string;
  status: string;
  createdAt: string;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore parse errors
  }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchMyInterviews(): Promise<InterviewSummary[]> {
  const response = await fetchWithAuth("/api/interviews/mine");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити список співбесід");
  }
  const body = (await response.json()) as { interviews: InterviewSummary[] };
  return body.interviews;
}

export async function createInterview(): Promise<CreatedInterview> {
  const response = await fetchWithAuth("/api/interviews", { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося створити співбесіду");
  }
  const body = (await response.json()) as { interview: CreatedInterview };
  return body.interview;
}
```

This keeps `fetchMyInterviews`'s public signature unchanged (callers in `HomeView.vue` are unaffected) while switching its error handling to the same `parseError` helper already used in `frontend/src/api/prep.ts`, so both functions in this file report backend error detail consistently.

- [ ] **Step 2: Verify no type errors**

Run (from `frontend/`): `npx vue-tsc --noEmit -p tsconfig.app.json`
Expected: no errors (no other file imports from this module yet besides `fetchMyInterviews`, which is unaffected).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/interviews.ts
git commit -m "feat: add createInterview API client function"
```

---

### Task 4: "Створити співбесіду" button and code banner on `HomeView.vue`

**Files:**
- Modify: `frontend/src/views/HomeView.vue`

- [ ] **Step 1: Update the `<script setup>` block**

In `frontend/src/views/HomeView.vue`, change the import line:

```ts
import { fetchMyInterviews } from "../api/interviews";
```

to:

```ts
import { createInterview, fetchMyInterviews, type CreatedInterview } from "../api/interviews";
```

Then, after the existing `goToCompanyPrep` function (right before `onMounted`), add:

```ts
const creatingInterview = ref(false);
const createInterviewError = ref<string | null>(null);
const createdInterview = ref<CreatedInterview | null>(null);

async function onCreateInterview(): Promise<void> {
  createInterviewError.value = null;
  creatingInterview.value = true;
  try {
    createdInterview.value = await createInterview();
  } catch (error) {
    createInterviewError.value =
      error instanceof Error ? error.message : "Не вдалося створити співбесіду";
  } finally {
    creatingInterview.value = false;
  }
}

function goToCreatedInterviewPrep(): void {
  if (!createdInterview.value) return;
  router.push({ name: "company-prep", params: { interviewId: createdInterview.value.id } });
}
```

- [ ] **Step 2: Update the template**

Replace the `.prep-nav` block:

```html
      <div class="prep-nav">
        <button type="button" class="btn-primary" @click="goToCompanyPrep">Анкета компанії</button>
        <p v-if="prepNavError" class="fail">{{ prepNavError }}</p>
      </div>
```

with:

```html
      <div class="prep-nav">
        <button type="button" class="btn-primary" @click="goToCompanyPrep">Анкета компанії</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="creatingInterview"
          @click="onCreateInterview"
        >
          {{ creatingInterview ? "Створення…" : "Створити співбесіду" }}
        </button>
        <p v-if="prepNavError" class="fail">{{ prepNavError }}</p>
        <p v-if="createInterviewError" class="fail">{{ createInterviewError }}</p>
      </div>

      <div v-if="createdInterview" class="created-banner">
        <p>
          Співбесіду створено! Код для кандидата:
          <strong class="created-code">{{ createdInterview.joinCode }}</strong>
        </p>
        <button type="button" class="btn-primary" @click="goToCreatedInterviewPrep">
          Перейти до анкети →
        </button>
      </div>
```

- [ ] **Step 3: Add styles**

In the `<style scoped>` block, after the existing `.prep-nav { margin: 1rem 0; }` rule, add:

```css
.prep-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.created-banner {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}
.created-code {
  font-family: monospace;
  font-size: 1.1rem;
  letter-spacing: 0.1em;
}
```

Note this replaces the existing `.prep-nav { margin: 1rem 0; }` rule (line 135-137 in the original file) with the expanded version above — don't leave both.

- [ ] **Step 4: Verify no type errors**

Run (from `frontend/`): `npx vue-tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 5: Manual check**

Run `npm run dev` from the repo root, log in as `hr@test.com` / `123456`, click **«Створити співбесіду»**, and confirm:
- A green banner appears with a 6-character code (letters/digits only, no `0/O/1/I`).
- Clicking **«Перейти до анкети →»** navigates to `/prep/:interviewId` for the new interview and the Company Agent greets as usual.
- Clicking **«Створити співбесіду»** again produces a different code.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/HomeView.vue
git commit -m "feat: add create-interview button and code banner to home page"
```

---

### Task 5: README documentation

**Files:**
- Modify: `README.md` (Day 8 section, lines 482–496 as of this plan)

- [ ] **Step 1: Update the Day 8 Definition of Done checkboxes**

Replace:

```markdown
**Definition of Done:**
- [ ] Демонстрація: HR натискає кнопку → бачить 6-символьний код на екрані
- [ ] Сценарій: код унікальний; співбесіда в статусі `DRAFT` або `PREP`; без підтвердженого профілю створення неможливе
- [ ] Збірка: `npm run build` проходить
- [ ] README: endpoint `POST /interviews`, формат коду, статуси співбесіди
```

with:

```markdown
**Definition of Done:**
- [x] Демонстрація: HR натискає кнопку → бачить 6-символьний код на екрані
- [x] Сценарій: код унікальний; співбесіда створюється в статусі `DRAFT`; профіль компанії підтверджується окремо через уже наявний флоу Днів 4–7, що переводить статус у `AWAITING_CANDIDATE`
- [x] Збірка: `npm run build` проходить
- [x] README: endpoint `POST /interviews`, формат коду, статуси співбесіди
```

- [ ] **Step 2: Add a Quick Start subsection**

Immediately after the Definition of Done block (and before the `---` that precedes `## День 9`), add:

```markdown

### Create Interview Quick Start (Day 8)

HR може створити нову співбесіду (незалежно від seed-співбесіди з Дня 1) одним запитом:

\`\`\`bash
TOKEN="<token-from-login>"

curl -X POST http://localhost:3000/api/interviews \
  -H "Authorization: Bearer $TOKEN"
\`\`\`

Очікувана відповідь:

\`\`\`json
{
  "interview": {
    "id": "cmr9...",
    "joinCode": "K7M2P9",
    "status": "DRAFT",
    "createdAt": "2026-07-07T10:00:00.000Z"
  }
}
\`\`\`

**Формат коду:** 6 символів з алфавіту `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (без `0`, `O`, `1`, `I` — щоб код було легше диктувати кандидату голосом). Унікальність гарантується `@unique` у схемі; при колізії бекенд автоматично генерує новий код (до 5 спроб) і лише після цього повертає `500`.

**Далі:** з отриманим `id` HR переходить у звичний prep-флоу (`GET/POST /api/prep/:interviewId/...`, Дні 4–7) — заповнює анкету, отримує й підтверджує профіль компанії. Підтвердження автоматично переводить `Interview.status` із `DRAFT` у `AWAITING_CANDIDATE` (реалізовано в Дні 7, працює однаково для будь-якої співбесіди, включно з новоствореними).

**UI:** на головній сторінці кнопка **«Створити співбесіду»** одразу показує код у зеленому банері з кнопкою «Перейти до анкети →», яка веде у щойно створену співбесіду.

**Помилки:**
- `500 { "error": "Failed to generate unique join code" }` — вичерпано 5 спроб згенерувати унікальний код (вкрай малоймовірно при 32^6 можливих кодах).
```

(Use literal triple backticks in the actual file — the `\`\`\`` above is escaped only for this plan document.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Day 8 create-interview quick start"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full workspace build**

Run (from repo root): `npm run build`
Expected: both `backend` and `frontend` build without errors.

- [ ] **Step 2: Full backend test suite**

Run (from `backend/`): `npm test`
Expected: all suites PASS, including the new `joinCode` and `interviews` tests.

- [ ] **Step 3: Manual end-to-end scenario**

1. `npm run dev` from repo root.
2. Log in as `hr@test.com` / `123456`.
3. Click **«Створити співбесіду»** → note the displayed code (e.g. `K7M2P9`).
4. Click **«Створити співбесіду»** again → confirm the second code differs from the first.
5. Click **«Перейти до анкети →»** for one of the created interviews → confirm the Company Agent greets and the prep chat works exactly as in Days 4–7.
6. Complete the chat, finish it, and confirm the profile → confirm `Interview.status` reaches `AWAITING_CANDIDATE` (visible via `curl http://localhost:3000/api/prep/<interviewId>` showing `confirmedAt` set, or by checking the DB directly).

No commit for this task — it's verification of work already committed in Tasks 1–5.

---

## Out of scope (Day 8)

- Dashboard listing all interviews with codes/statuses (`GET /interviews/mine` already returns the needed fields — rendering the list is Day 9).
- Candidate-side join-by-code endpoint.
- Deleting/archiving `DRAFT` interviews without a profile.
- Limits/quotas on how many interviews one HR can create.
- Regenerating or editing a `joinCode` after creation.

# HR Dashboard (Day 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the HR home page into a dashboard listing all of the logged-in HR's interviews (join code, status, creation date) with a per-row action ("Пройти анкету" for `DRAFT`, disabled "Відкрити" placeholder otherwise) and the existing "Створити співбесіду" flow above the list.

**Architecture:** `GET /api/interviews/mine` (existing endpoint) is extended to include `createdAt` in its response — no new endpoint. `frontend/src/api/interviews.ts`'s `InterviewSummary` type gains a `createdAt` field. `HomeView.vue` is rewritten: the system-status block and `ChatPanel` (Day 2 general AI chat) are removed, and a table of interviews (fed by `fetchMyInterviews()`) replaces them, reusing the existing `createInterview()` button/banner logic from Day 8 (now also prepending the new interview into the local list).

**Tech Stack:** Express + Prisma (backend), Node's built-in `node:test`/`assert`, Vue 3 `<script setup>` + TypeScript (frontend, verified via `vue-tsc` + manual check, no component test runner configured).

**Spec:** `docs/superpowers/specs/2026-07-08-hr-dashboard-design.md`

---

### Task 1: Include `createdAt` in `GET /interviews/mine` response

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/routes/interviews.test.ts`, replace the first test (`"GET /interviews/mine returns interviews for the current HR only, newest first"`) with:

```ts
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
    assert.deepEqual(Object.keys(body.interviews[0]).sort(), ["createdAt", "id", "joinCode", "status"]);
    assert.equal(body.interviews[0].createdAt, new Date(3).toISOString());
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

(Only this one test changes — the rest of the file stays as-is.)

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --import tsx --test src/routes/interviews.test.ts`
Expected: FAIL — `Object.keys(body.interviews[0]).sort()` is `["id", "joinCode", "status"]`, missing `"createdAt"`, so the `assert.deepEqual` fails.

- [ ] **Step 3: Write the minimal implementation**

In `backend/src/routes/interviews.ts`, update the `GET /interviews/mine` handler's response mapping:

```ts
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
        createdAt: item.createdAt,
      })),
    });
  });
```

(The only change is adding the `createdAt: item.createdAt` line — Express's `res.json` serializes `Date` values to ISO 8601 strings automatically, which is why the test compares against `new Date(3).toISOString()`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/routes/interviews.test.ts`
Expected: PASS — 7 tests, 0 failures.

Then run the full backend suite (from `backend/`): `npm test`
Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts
git commit -m "feat: include createdAt in GET /interviews/mine response"
```

---

### Task 2: Add `createdAt` to the frontend `InterviewSummary` type

**Files:**
- Modify: `frontend/src/api/interviews.ts`

- [ ] **Step 1: Update the type**

In `frontend/src/api/interviews.ts`, change:

```ts
export type InterviewSummary = {
  id: string;
  joinCode: string;
  status: string;
};
```

to:

```ts
export type InterviewSummary = {
  id: string;
  joinCode: string;
  status: string;
  createdAt: string;
};
```

No other changes in this file — `fetchMyInterviews()` and `createInterview()` already return/parse whatever the backend sends, so they pick up the new field automatically.

- [ ] **Step 2: Verify no type errors**

Run (from `frontend/`): `npx vue-tsc --noEmit -p tsconfig.app.json`
Expected: no errors (the field is additive; nothing currently destructures `InterviewSummary` field-by-field).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/interviews.ts
git commit -m "feat: add createdAt field to InterviewSummary type"
```

---

### Task 3: Rewrite `HomeView.vue` as the HR dashboard

**Files:**
- Modify: `frontend/src/views/HomeView.vue`

This task replaces the entire file: the system-status block (`fetchHealth`), `ChatPanel`, and the old "Анкета компанії" button/`goToCompanyPrep` are removed; a table of interviews is added, fed by `fetchMyInterviews()`, with the Day 8 create-interview button/banner logic kept (and extended to prepend the new interview into the local list).

- [ ] **Step 1: Replace the full file contents**

Replace the full contents of `frontend/src/views/HomeView.vue` with:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createInterview,
  fetchMyInterviews,
  type CreatedInterview,
  type InterviewSummary,
} from "../api/interviews";
import { useAuthStore } from "../stores/auth";

type ListState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Готова",
  LIVE: "В ефірі",
  ENDED: "Завершена",
};

const auth = useAuthStore();
const router = useRouter();

function logout(): void {
  auth.logout();
  router.push({ name: "login" });
}

const interviews = ref<InterviewSummary[]>([]);
const listState = ref<ListState>("loading");
const listError = ref<string | null>(null);

async function loadInterviews(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    interviews.value = await fetchMyInterviews();
    listState.value = "ready";
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити список співбесід";
  }
}

const creatingInterview = ref(false);
const createInterviewError = ref<string | null>(null);
const createdInterview = ref<CreatedInterview | null>(null);

async function onCreateInterview(): Promise<void> {
  createInterviewError.value = null;
  creatingInterview.value = true;
  try {
    const interview = await createInterview();
    createdInterview.value = interview;
    interviews.value.unshift(interview);
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

function goToPrep(interviewId: string): void {
  router.push({ name: "company-prep", params: { interviewId } });
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

onMounted(loadInterviews);
</script>

<template>
  <main class="page">
    <header class="header">
      <div>
        <h1>Interview Platform</h1>
        <p class="subtitle">HR — ваші співбесіди</p>
      </div>
      <div class="user-bar">
        <span>{{ auth.user?.email }}</span>
        <button type="button" @click="logout">Вийти</button>
      </div>
    </header>

    <div class="dashboard-actions">
      <button
        type="button"
        class="btn-primary"
        :disabled="creatingInterview"
        @click="onCreateInterview"
      >
        {{ creatingInterview ? "Створення…" : "Створити співбесіду" }}
      </button>
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

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="interviews.length === 0">
      У вас ще немає створених співбесід. Створіть першу!
    </p>
    <table v-else class="interviews-table">
      <thead>
        <tr>
          <th>Код</th>
          <th>Статус</th>
          <th>Дата створення</th>
          <th>Дія</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="interview in interviews" :key="interview.id">
          <td class="code-cell">{{ interview.joinCode }}</td>
          <td>{{ statusLabel(interview.status) }}</td>
          <td>{{ formatDate(interview.createdAt) }}</td>
          <td>
            <button
              v-if="interview.status === 'DRAFT'"
              type="button"
              class="btn-primary"
              @click="goToPrep(interview.id)"
            >
              Пройти анкету
            </button>
            <button
              v-else
              type="button"
              class="btn-disabled"
              disabled
              title="Скоро з'явиться"
            >
              Відкрити
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}
.subtitle { color: #555; }
.fail { color: #b00020; }
.dashboard-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 1rem 0;
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
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}
.btn-primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
.btn-disabled {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: #e5e7eb;
  color: #6b7280;
  cursor: not-allowed;
}
.interviews-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}
.interviews-table th,
.interviews-table td {
  text-align: left;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid #eee;
}
.interviews-table th {
  font-size: 0.8rem;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.code-cell {
  font-family: monospace;
  letter-spacing: 0.05em;
}
</style>
```

- [ ] **Step 2: Verify no type errors**

Run (from `frontend/`): `npx vue-tsc --noEmit -p tsconfig.app.json`
Expected: no errors. (`fetchHealth`, `HealthResponse`, and `ChatPanel` are no longer imported anywhere in this file, so there should be no unused-import errors either.)

- [ ] **Step 3: Manual check**

Run `npm run dev` from the repo root, log in as `hr@test.com` / `123456`, and confirm:
- The home page shows a table with at least the seed interview (`joinCode = TEST01`), columns **Код / Статус / Дата створення / Дія**.
- The seed interview's status shows as a Ukrainian label (e.g. "Чернетка" if still `DRAFT`), not the raw enum value.
- Clicking **«Створити співбесіду»** shows the green code banner AND immediately adds a new row to the table (status "Чернетка") without a page reload.
- Clicking **«Пройти анкету»** on a `DRAFT` row navigates to `/prep/:interviewId` and the Company Agent greets as usual.
- For any interview not in `DRAFT` (if none exist yet, confirm one via the Day 4–7 flow first), the row shows a greyed-out, disabled **«Відкрити»** button; hovering shows the tooltip "Скоро з'явиться".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/HomeView.vue
git commit -m "feat: replace HR home page with interviews dashboard"
```

---

### Task 4: README documentation

**Files:**
- Modify: `README.md` (Day 9 section)

- [ ] **Step 1: Update the Day 9 Definition of Done checkboxes**

Replace:

```markdown
**Definition of Done:**
- [ ] Демонстрація: повний HR-флоу — логін → анкета → підтвердження → створення → код на дашборді
- [ ] Сценарій: список показує всі співбесіди поточного HR; кожен рядок містить код, статус і дату; посилання ведуть на правильні сторінки
- [ ] Збірка: `npm run build` проходить
- [ ] README: повний сценарій перевірки HR-частини (крок за кроком)

✅ HR-частина готова.
```

with:

```markdown
**Definition of Done:**
- [x] Демонстрація: повний HR-флоу — логін → анкета → підтвердження → створення → код на дашборді
- [x] Сценарій: список показує всі співбесіди поточного HR; кожен рядок містить код, статус і дату; посилання ведуть на правильні сторінки
- [x] Збірка: `npm run build` проходить
- [x] README: повний сценарій перевірки HR-частини (крок за кроком)

### HR Dashboard Quick Start (Day 9)

**1. Увійти:**

\`\`\`bash
npm run dev
\`\`\`

Відкрий [http://localhost:5173](http://localhost:5173) → логін `hr@test.com` / `123456`. Головна сторінка одразу показує таблицю співбесід поточного HR (мінімум seed-співбесіда з кодом `TEST01`) з колонками **Код**, **Статус**, **Дата створення**, **Дія**.

**2. Статуси в таблиці:**

| Статус у БД | Мітка в UI |
|---|---|
| `DRAFT` | Чернетка |
| `AWAITING_CANDIDATE` | Очікує кандидата |
| `READY` | Готова |
| `LIVE` | В ефірі |
| `ENDED` | Завершена |

**3. Створення нової співбесіди:** кнопка **«Створити співбесіду»** над таблицею — після успіху показує банер з кодом і одразу додає новий рядок (статус «Чернетка») у таблицю, без перезавантаження сторінки.

**4. Дія в рядку залежить від статусу:**
- **«Пройти анкету»** (активна) — для співбесід у статусі «Чернетка»; веде на `/prep/:interviewId`.
- **«Відкрити»** (неактивна, підказка «Скоро з'явиться») — для всіх інших статусів; жива кімната співбесіди з'явиться в Днях 15–19.

**5. Повний сценарій перевірки HR-частини (Дні 3–9), крок за кроком:**
1. Логін `hr@test.com` / `123456` (Day 3) → дашборд одразу видно (Day 9).
2. «Створити співбесіду» (Day 8) → новий рядок зі статусом «Чернетка» на дашборді.
3. «Пройти анкету» на цьому рядку → чат із Company Agent (Дні 4–5), відповісти на кілька питань.
4. «Завершити чат» → переглянути зібраний профіль (Day 6).
5. «Підтвердити профіль» (Day 7) → повернутись на дашборд → статус рядка змінився на «Очікує кандидата», кнопка дії — неактивна «Відкрити».
6. Ендпоінт списку для перевірки curl/Postman:

\`\`\`bash
TOKEN="<token-from-login>"

curl "http://localhost:3000/api/interviews/mine" \\
  -H "Authorization: Bearer $TOKEN"
\`\`\`

Очікувана відповідь:

\`\`\`json
{
  "interviews": [
    { "id": "cmr9...", "joinCode": "K7M2P9", "status": "AWAITING_CANDIDATE", "createdAt": "2026-07-08T08:00:00.000Z" },
    { "id": "cmr8...", "joinCode": "TEST01", "status": "DRAFT", "createdAt": "2026-07-01T09:00:00.000Z" }
  ]
}
\`\`\`

✅ HR-частина готова.
```

(Use literal triple backticks in the actual file — the `\`\`\`` above is escaped only for this plan document.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Day 9 HR dashboard quick start"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full workspace build**

Run (from repo root): `npm run build`
Expected: both `backend` and `frontend` build without errors.

- [ ] **Step 2: Full backend test suite**

Run (from `backend/`): `npm test`
Expected: all suites PASS, including the updated `interviews.test.ts`.

- [ ] **Step 3: Manual end-to-end scenario**

1. `npm run dev` from repo root.
2. Log in as `hr@test.com` / `123456` → dashboard shows the seed interview.
3. Click **«Створити співбесіду»** → new row appears with status "Чернетка" and a fresh join code; the banner shows the same code.
4. Click **«Пройти анкету»** on that row → complete the Company Agent chat (Days 4–5), finish it (Day 6), and confirm the profile (Day 7).
5. Navigate back to the dashboard (`/`) → the row for that interview now shows status "Очікує кандидата" and a disabled "Відкрити" button with the "Скоро з'явиться" tooltip.
6. Create a second interview → confirm both rows are listed independently with their own codes/statuses/dates, newest first.

No commit for this task — it's verification of work already committed in Tasks 1–4.

---

## Out of scope (Day 9)

- Real "Відкрити" functionality (live interview room) — Days 15–19.
- Viewing/editing the company profile for `AWAITING_CANDIDATE`+ interviews directly from the dashboard.
- Pagination, filtering, or sorting controls on the interviews list.
- Deleting or archiving interviews from the dashboard.
- Candidate-facing "both ready" status handling — Days 10–14.

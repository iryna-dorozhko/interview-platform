# Report Page + Gemini LLM (Day 21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR can read the full AI interview report at `/report/:id`; `reportId` links from list, room, and detail views; Gemini cloud LLM switch documented via `LLM_PROVIDER=omlx|gemini`.

**Architecture:** New `GET /api/reports/:id` route returns the full `FinalReport` for the owning HR. Existing interview list/detail endpoints gain `reportId`. Frontend adds `ReportView.vue` with `marked` + `DOMPurify` markdown rendering, structured header (match score + recommendation badge), and strengths/risks cards. No LLM code changes — only README/`.env.example` updates.

**Tech Stack:** Express + Prisma + `node:test` (backend), Vue 3 + Vue Router + TypeScript + `marked` + `dompurify` (frontend).

**Spec:** `docs/superpowers/specs/2026-07-14-report-page-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/routes/reports.ts` | `GET /api/reports/:id` handler |
| `backend/src/routes/reports.test.ts` | Unit tests for reports route |
| `backend/src/routes/interviews.ts` | Add `reportId` to mine + detail responses |
| `backend/src/routes/interviews.test.ts` | Extend fake Prisma + assert `reportId` |
| `backend/src/server.ts` | Register reports router |
| `frontend/src/api/reports.ts` | `fetchReport()` client |
| `frontend/src/api/interviews.ts` | Add `reportId` to types |
| `frontend/src/views/ReportView.vue` | Structured report page |
| `frontend/src/router/index.ts` | Route `/report/:id` |
| `frontend/src/views/InterviewListView.vue` | Report column links |
| `frontend/src/components/InterviewRoomContent.vue` | Link after end + when ENDED |
| `frontend/src/views/HrInterviewRoomView.vue` | Pass `reportId` prop |
| `frontend/src/views/InterviewDetailView.vue` | Report link block |
| `README.md` | Day 21 section update |
| `backend/.env.example` | Minor Gemini switch clarity |

---

### Task 1: `GET /api/reports/:id` endpoint

**Files:**
- Create: `backend/src/routes/reports.ts`
- Create: `backend/src/routes/reports.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json` (`test` script)

- [ ] **Step 1: Write the failing tests**

Create `backend/src/routes/reports.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createReportsRouter } from "./reports";

type FakeReport = {
  id: string;
  interviewId: string;
  hrUserId: string;
  reportMarkdown: string;
  recommendation: string;
  matchScore: number;
  strengths: string[];
  risks: string[];
  createdAt: Date;
};

function makeFakePrisma(reports: FakeReport[] = []) {
  return {
    finalReport: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { interview: { select: { hrUserId: true } } };
      }) => {
        const report = reports.find((r) => r.id === where.id) ?? null;
        if (!report) return null;
        return {
          id: report.id,
          interviewId: report.interviewId,
          reportMarkdown: report.reportMarkdown,
          recommendation: report.recommendation,
          matchScore: report.matchScore,
          strengths: report.strengths,
          risks: report.risks,
          createdAt: report.createdAt,
          ...(include?.interview
            ? { interview: { hrUserId: report.hrUserId } }
            : {}),
        };
      },
    },
  };
}

function withUser(user: AuthUser | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user?: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createReportsRouter(() => fakePrisma as never));
  return app;
}

const sampleReport: FakeReport = {
  id: "rep_1",
  interviewId: "i1",
  hrUserId: "hr_1",
  reportMarkdown: "## Підсумок\n\nКандидат підходить.",
  recommendation: "HIRE",
  matchScore: 82,
  strengths: ["Досвід Node.js"],
  risks: ["Мало leadership"],
  createdAt: new Date("2026-07-14T09:00:00.000Z"),
};

test("GET /reports/:id returns 404 when report does not exist", async () => {
  const app = makeApp(makeFakePrisma(), { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/missing`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Report not found");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports/:id returns 403 when report belongs to another HR", async () => {
  const app = makeApp(makeFakePrisma([{ ...sampleReport, hrUserId: "hr_other" }]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports/:id returns full report for owner HR", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.report.id, "rep_1");
    assert.equal(body.report.interviewId, "i1");
    assert.equal(body.report.recommendation, "HIRE");
    assert.equal(body.report.matchScore, 82);
    assert.deepEqual(body.report.strengths, ["Досвід Node.js"]);
    assert.deepEqual(body.report.risks, ["Мало leadership"]);
    assert.equal(body.report.reportMarkdown, "## Підсумок\n\nКандидат підходить.");
    assert.equal(body.report.createdAt, sampleReport.createdAt.toISOString());
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/routes/reports.test.ts` (from `backend/`)
Expected: FAIL — `Cannot find module './reports'`

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/routes/reports.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

export function createReportsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/reports/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const report = await prisma.finalReport.findUnique({
      where: { id: req.params.id },
      include: {
        interview: { select: { hrUserId: true } },
      },
    });

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    if (report.interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.status(200).json({
      report: {
        id: report.id,
        interviewId: report.interviewId,
        reportMarkdown: report.reportMarkdown,
        recommendation: report.recommendation,
        matchScore: report.matchScore,
        strengths: report.strengths as string[],
        risks: report.risks as string[],
        createdAt: report.createdAt,
      },
    });
  });

  return router;
}
```

Register in `backend/src/server.ts` — add import and route (after interviews router line):

```typescript
import { createReportsRouter } from "./routes/reports";
```

```typescript
app.use("/api", requireAuth, requireHr, createReportsRouter(() => prisma));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/routes/reports.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Register test in package.json**

Append `src/routes/reports.test.ts` to the `test` script in `backend/package.json` (after `src/routes/interviews.test.ts`).

Run: `npm test` (from `backend/`)
Expected: all suites PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts backend/src/server.ts backend/package.json
git commit -m "feat: add GET /api/reports/:id endpoint"
```

---

### Task 2: `reportId` in interview responses

**Files:**
- Modify: `backend/src/routes/interviews.ts:32,56,45,78`
- Modify: `backend/src/routes/interviews.test.ts` (FakeFinalReport type, makeFakePrisma, key assertions)

- [ ] **Step 1: Write the failing tests**

In `backend/src/routes/interviews.test.ts`, extend `FakeFinalReport`:

```typescript
type FakeFinalReport = {
  id: string;
  interviewId: string;
  recommendation: string;
};
```

Update `makeFakePrisma` `finalReport` include handling — change select type from `{ recommendation: true }` to `{ id: true; recommendation: true }` and return both fields:

```typescript
finalReport?: { select: { id: true; recommendation: true } };
```

In the `finalReport` branch of both `findMany` and `findUnique`:

```typescript
finalReport: finalReport
  ? { id: finalReport.id, recommendation: finalReport.recommendation }
  : null,
```

Update existing test data — change `finalReports` array entries from `{ interviewId, recommendation }` to `{ id: "rep_1", interviewId: "i1", recommendation: "HIRE" }`.

Add `"reportId"` to the sorted keys assertion in `GET /interviews/mine returns only interviews for authenticated HR` test (line ~375).

Add new test after the `reportSummary` test:

```typescript
test("GET /interviews/mine returns reportId from finalReport when present", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "ENDED",
        createdAt: new Date(1),
      },
    ],
    [confirmedVacancy],
    undefined,
    [{ id: "rep_1", interviewId: "i1", recommendation: "HIRE" }],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews[0].reportId, "rep_1");
    assert.equal(body.interviews[0].reportSummary, "HIRE");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /interviews/:id returns reportId when finalReport exists", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "i1",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Frontend Dev",
        joinCode: "AAAAAA",
        status: "ENDED",
        createdAt: new Date(1),
      },
    ],
    [confirmedVacancy],
    undefined,
    [{ id: "rep_1", interviewId: "i1", recommendation: "HIRE" }],
  );
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/i1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.reportId, "rep_1");
    assert.equal(body.interview.reportSummary, "HIRE");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

Update `GET /interviews/:id returns interview for owner` test — add assertion:

```typescript
assert.equal(body.interview.reportId, null);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/routes/interviews.test.ts`
Expected: FAIL — `reportId` is `undefined` in response

- [ ] **Step 3: Implement reportId in interviews route**

In `backend/src/routes/interviews.ts`:

Change `finalReport` select in both queries from `{ recommendation: true }` to `{ id: true, recommendation: true }`.

Add `reportId` to both response mappers:

```typescript
reportSummary: item.finalReport?.recommendation ?? null,
reportId: item.finalReport?.id ?? null,
```

(same for `interview.finalReport` in detail endpoint)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/routes/interviews.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts
git commit -m "feat: expose reportId in interview list and detail API"
```

---

### Task 3: Frontend dependencies and API client

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/api/reports.ts`
- Modify: `frontend/src/api/interviews.ts`

- [ ] **Step 1: Install markdown dependencies**

Run (from repo root):

```bash
npm install marked dompurify --workspace frontend
npm install -D @types/dompurify --workspace frontend
```

- [ ] **Step 2: Create reports API client**

Create `frontend/src/api/reports.ts`:

```typescript
import { fetchWithAuth } from "./client";

export type FinalReport = {
  id: string;
  interviewId: string;
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
  createdAt: string;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore
  }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchReport(id: string): Promise<FinalReport> {
  const response = await fetchWithAuth(`/api/reports/${id}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити звіт");
  }
  const body = (await response.json()) as { report: FinalReport };
  return body.report;
}
```

- [ ] **Step 3: Add reportId to interview types**

In `frontend/src/api/interviews.ts`, add to `InterviewSummary` (and `InterviewDetail` inherits it):

```typescript
reportId: string | null;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run lint --workspace frontend`
Expected: PASS (no errors; views not using reportId yet won't fail)

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/api/reports.ts frontend/src/api/interviews.ts
git commit -m "feat: add frontend report API client and reportId type"
```

---

### Task 4: ReportView page and router

**Files:**
- Create: `frontend/src/views/ReportView.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: Create ReportView**

Create `frontend/src/views/ReportView.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { fetchReport, type FinalReport } from "../api/reports";

const route = useRoute();
const reportId = computed(() => String(route.params.id));

const report = ref<FinalReport | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const RECOMMENDATION_LABELS: Record<string, string> = {
  HIRE: "Найняти",
  MAYBE: "Під питанням",
  REJECT: "Відхилити",
};

const renderedMarkdown = computed(() => {
  if (!report.value) return "";
  const html = marked.parse(report.value.reportMarkdown, { async: false }) as string;
  return DOMPurify.sanitize(html);
});

function recommendationLabel(value: string): string {
  return RECOMMENDATION_LABELS[value] ?? value;
}

function badgeClass(value: string): string {
  if (value === "HIRE") return "badge-hire";
  if (value === "MAYBE") return "badge-maybe";
  if (value === "REJECT") return "badge-reject";
  return "badge-neutral";
}

async function loadReport(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    report.value = await fetchReport(reportId.value);
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити звіт";
  }
}

onMounted(loadReport);
</script>

<template>
  <main class="report-page">
    <header class="header">
      <RouterLink to="/interviews" class="back-link">← До списку співбесід</RouterLink>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else-if="report">
      <h1>Звіт про співбесіду</h1>

      <div class="summary-row">
        <div class="score-card">
          <span class="score-value">{{ report.matchScore }}%</span>
          <span class="score-label">Відповідність</span>
        </div>
        <div class="recommendation-card" :class="badgeClass(report.recommendation)">
          <span class="recommendation-value">{{ recommendationLabel(report.recommendation) }}</span>
          <span class="recommendation-label">Рекомендація</span>
        </div>
      </div>

      <div class="cards-row">
        <section class="info-card strengths">
          <h2>Сильні сторони</h2>
          <ul>
            <li v-for="(item, index) in report.strengths" :key="index">{{ item }}</li>
          </ul>
        </section>
        <section class="info-card risks">
          <h2>Ризики</h2>
          <ul>
            <li v-for="(item, index) in report.risks" :key="index">{{ item }}</li>
          </ul>
        </section>
      </div>

      <section class="report-body" v-html="renderedMarkdown" />
    </template>
  </main>
</template>

<style scoped>
.report-page {
  font-family: system-ui, sans-serif;
  max-width: 48rem;
}
.header {
  margin-bottom: 1rem;
}
.back-link {
  color: #2563eb;
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover {
  text-decoration: underline;
}
.error-banner {
  color: #b91c1c;
  background: #fee2e2;
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
}
.summary-row {
  display: flex;
  gap: 1rem;
  margin: 1.5rem 0;
}
.score-card,
.recommendation-card {
  flex: 1;
  padding: 1.25rem;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.score-value {
  font-size: 2rem;
  font-weight: 700;
  color: #1d4ed8;
}
.score-label,
.recommendation-label {
  font-size: 0.875rem;
  color: #6b7280;
}
.recommendation-value {
  font-size: 1.25rem;
  font-weight: 700;
}
.badge-hire {
  background: #dcfce7;
  border-color: #86efac;
  color: #16a34a;
}
.badge-maybe {
  background: #fef9c3;
  border-color: #fde047;
  color: #ca8a04;
}
.badge-reject {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #dc2626;
}
.cards-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.info-card {
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
}
.info-card h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}
.info-card ul {
  margin: 0;
  padding-left: 1.25rem;
}
.info-card li {
  margin-bottom: 0.25rem;
}
.strengths {
  background: #f0fdf4;
}
.risks {
  background: #fff7ed;
}
.report-body :deep(h2) {
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  font-size: 1.125rem;
}
.report-body :deep(p) {
  margin: 0.5rem 0;
  line-height: 1.6;
}
.report-body :deep(ul) {
  padding-left: 1.25rem;
}
</style>
```

- [ ] **Step 2: Register route**

In `frontend/src/router/index.ts`:

Add import:

```typescript
import ReportView from "../views/ReportView.vue";
```

Add child route inside HR layout (after `interview-room`):

```typescript
{
  path: "report/:id",
  name: "report",
  component: ReportView,
},
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace frontend`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ReportView.vue frontend/src/router/index.ts
git commit -m "feat: add structured report page at /report/:id"
```

---

### Task 5: Navigation links from list, room, and detail

**Files:**
- Modify: `frontend/src/views/InterviewListView.vue`
- Modify: `frontend/src/components/InterviewRoomContent.vue`
- Modify: `frontend/src/views/HrInterviewRoomView.vue`
- Modify: `frontend/src/views/InterviewDetailView.vue`

- [ ] **Step 1: InterviewListView — clickable report badge**

In `frontend/src/views/InterviewListView.vue`:

Add helper:

```typescript
function badgeClass(reportSummary: string): string {
  if (reportSummary === "HIRE") return "badge-hire";
  if (reportSummary === "MAYBE") return "badge-maybe";
  if (reportSummary === "REJECT") return "badge-reject";
  return "";
}
```

Replace the report `<td>`:

```vue
<td>
  <RouterLink
    v-if="interview.reportId"
    :to="{ name: 'report', params: { id: interview.reportId } }"
    class="report-badge"
    :class="badgeClass(interview.reportSummary ?? '')"
  >
    {{ reportLabel(interview.reportSummary) }}
  </RouterLink>
  <span v-else>—</span>
</td>
```

Add `RouterLink` to imports from `vue-router`.

Add scoped CSS:

```css
.report-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}
.report-badge.badge-hire { background: #dcfce7; color: #16a34a; }
.report-badge.badge-maybe { background: #fef9c3; color: #ca8a04; }
.report-badge.badge-reject { background: #fee2e2; color: #dc2626; }
```

Update `onInterviewCreated` stub to include `reportId: null`.

- [ ] **Step 2: HrInterviewRoomView — pass reportId**

In `frontend/src/views/HrInterviewRoomView.vue`:

Add ref:

```typescript
const reportId = ref<string | null>(null);
```

In `onMounted`, after `fetchInterview`:

```typescript
reportId.value = interview.reportId;
```

Pass to component:

```vue
<InterviewRoomContent
  ...
  :report-id="reportId"
/>
```

- [ ] **Step 3: InterviewRoomContent — link after end and when ENDED**

In `frontend/src/components/InterviewRoomContent.vue`:

Add prop:

```typescript
reportId?: string | null;
```

Add ref for link after end:

```typescript
const endedReportId = ref<string | null>(null);
```

In `onEndInterview` success block:

```typescript
endedReportId.value = result.reportId;
endSuccess.value = `Звіт згенеровано. Рекомендація: ${result.recommendation}`;
```

Add computed for active report link:

```typescript
const activeReportId = computed(
  () => endedReportId.value ?? props.reportId ?? null,
);

const showReportLink = computed(
  () => activeReportId.value !== null && interviewStatus.value === "ENDED",
);
```

Add import `RouterLink` from `vue-router`, `computed` already imported.

Replace success banner section:

```vue
<p v-if="endSuccess" class="success-banner">{{ endSuccess }}</p>
<RouterLink
  v-if="showReportLink && activeReportId"
  :to="{ name: 'report', params: { id: activeReportId } }"
  class="report-link"
>
  Переглянути звіт →
</RouterLink>
```

Add CSS:

```css
.report-link {
  display: inline-block;
  margin-bottom: 0.75rem;
  color: #2563eb;
  font-size: 0.875rem;
  text-decoration: none;
}
.report-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 4: InterviewDetailView — report block**

In `frontend/src/views/InterviewDetailView.vue`, after status meta paragraph, add:

```vue
<section v-if="interview.reportId" class="report-section">
  <h2>Фінальний звіт</h2>
  <p>
    Рекомендація:
    <strong>{{ interview.reportSummary }}</strong>
  </p>
  <RouterLink :to="{ name: 'report', params: { id: interview.reportId } }">
    Переглянути повний звіт →
  </RouterLink>
</section>
```

Add CSS:

```css
.report-section {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #f9fafb;
}
.report-section h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}
.report-section a {
  color: #2563eb;
  text-decoration: none;
}
.report-section a:hover {
  text-decoration: underline;
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build --workspace frontend`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/InterviewListView.vue frontend/src/views/HrInterviewRoomView.vue frontend/src/components/InterviewRoomContent.vue frontend/src/views/InterviewDetailView.vue
git commit -m "feat: add report navigation links from list, room, and detail"
```

---

### Task 6: README and .env.example documentation

**Files:**
- Modify: `README.md` (Day 21 section, ~lines 1372–1385)
- Modify: `backend/.env.example` (optional clarity tweak)

- [ ] **Step 1: Update README Day 21**

Replace the Day 21 section in `README.md`:

```markdown
## День 21 — Сторінка звіту + хмарна модель

**Задача:** звіт у браузері + можливість хмарної моделі.

**Що робиш:**
- Сторінка `/report/:id` — структурований перегляд звіту (match-score, рекомендація, strengths/risks, markdown)
- Посилання на звіт зі списку співбесід, live-кімнати та деталей співбесіди
- Перемикач у `.env`: `omlx` (локально) або `gemini` (хмара)

**Definition of Done:**
- [ ] Демонстрація: звіт читається в UI за `/report/:id`
- [ ] Сценарій: посилання на звіт працює зі списку, кімнати (після завершення) і `/interviews/:id`
- [ ] `LLM_PROVIDER=gemini` + `GEMINI_API_KEY` — `npm run llm:test --workspace backend` відповідає
- [ ] Збірка: `npm run build` проходить
- [ ] README: змінні `GEMINI_*`, як перемкнути провайдера

### Report API (Day 21)

**Endpoint:** `GET /api/reports/:id`

| Умова | Значення |
|-------|----------|
| Auth | HR (JWT), лише власник співбесіди |
| `:id` | `FinalReport.id` |

**Успіх (200):** повний звіт (`reportMarkdown`, `recommendation`, `matchScore`, `strengths`, `risks`).

**Помилки:** 403 (не власник), 404 (звіт не знайдено).

### Перемикання LLM-провайдера

```env
# Локально (за замовчуванням)
LLM_PROVIDER=omlx

# Хмара (Google Gemini)
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.0-flash
```

Після зміни `.env` — рестарт backend. Тест: `npm run llm:test --workspace backend`.
```

- [ ] **Step 2: Clarify .env.example Gemini block**

In `backend/.env.example`, ensure the gemini comment block reads:

```env
# --- gemini (хмарна модель: встанови LLM_PROVIDER=gemini) ---
# LLM_PROVIDER=gemini
# GEMINI_API_KEY=your-key-here
# GEMINI_MODEL=gemini-2.0-flash
```

- [ ] **Step 3: Commit**

```bash
git add README.md backend/.env.example
git commit -m "docs: update Day 21 report page and gemini LLM guide"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `npm test --workspace backend`
Expected: all PASS

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: backend `tsc` + frontend `vue-tsc` + `vite build` PASS

- [ ] **Step 3: Manual smoke test (optional but recommended)**

1. `npm run dev` — login as HR
2. Open an ended interview with a report (or end a LIVE one)
3. Verify `/report/:id` renders header, cards, markdown
4. Verify links from list, room banner, and `/interviews/:id`
5. Switch `LLM_PROVIDER=gemini` in `.env`, restart backend, run `npm run llm:test --workspace backend`

- [ ] **Step 4: Commit any fixes if needed**

```bash
git commit -m "fix: address Day 21 verification issues"  # only if fixes were needed
```

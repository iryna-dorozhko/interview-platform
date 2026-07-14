# HR Reports List Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR opens a «Звіти» tab listing all their final reports with email, vacancy, score, recommendation, and date, plus filters; clicking a row opens the existing full report page.

**Architecture:** Extend `createReportsRouter` with `GET /api/reports` (list) registered before `GET /api/reports/:id`. Server-side filters via query params. New `ReportListView` at `/reports` with sidebar link; vacancy dropdown reuses `fetchMyVacancies()`.

**Tech Stack:** Express + Prisma + `node:test` (backend), Vue 3 + Vue Router + TypeScript (frontend).

**Spec:** `docs/superpowers/specs/2026-07-14-hr-reports-list-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/routes/reports.ts` | Add `GET /reports` list handler (before `:id`) |
| `backend/src/routes/reports.test.ts` | Extend fake Prisma + list/filter tests |
| `frontend/src/api/reports.ts` | `ReportSummary`, `ReportListFilters`, `fetchReports` |
| `frontend/src/views/ReportListView.vue` | Filters row + reports table |
| `frontend/src/components/HrSidebar.vue` | Nav item «Звіти» |
| `frontend/src/router/index.ts` | Route `reports` |

---

### Task 1: Failing list tests + fake `findMany`

**Files:**
- Modify: `backend/src/routes/reports.test.ts`

- [ ] **Step 1: Extend `FakeReport` and `makeFakePrisma` for list**

Replace the fake types/helpers at the top of `backend/src/routes/reports.test.ts` so list queries work. Keep existing `findUnique` behavior for `:id` tests.

```typescript
type FakeReport = {
  id: string;
  interviewId: string;
  hrUserId: string;
  candidateEmail: string | null;
  vacancyId: string;
  vacancyTitle: string;
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
      findMany: async ({
        where,
        include,
        orderBy,
      }: {
        where?: {
          interview?: {
            hrUserId?: string;
            vacancyId?: string;
            candidateUser?: { email?: { contains: string; mode: string } };
          };
          recommendation?: string;
          createdAt?: { gte?: Date; lte?: Date };
        };
        include?: {
          interview: {
            select: {
              vacancyId: true;
              candidateUser: { select: { email: true } };
              vacancy: { select: { id: true; title: true } };
            };
          };
        };
        orderBy?: { createdAt: "desc" | "asc" };
      }) => {
        let filtered = [...reports];
        if (where?.interview?.hrUserId) {
          filtered = filtered.filter((r) => r.hrUserId === where.interview!.hrUserId);
        }
        if (where?.interview?.vacancyId) {
          filtered = filtered.filter((r) => r.vacancyId === where.interview!.vacancyId);
        }
        if (where?.recommendation) {
          filtered = filtered.filter((r) => r.recommendation === where.recommendation);
        }
        if (where?.interview?.candidateUser?.email?.contains) {
          const needle = where.interview.candidateUser.email.contains.toLowerCase();
          filtered = filtered.filter(
            (r) => r.candidateEmail?.toLowerCase().includes(needle) ?? false,
          );
        }
        if (where?.createdAt?.gte) {
          filtered = filtered.filter((r) => r.createdAt >= where.createdAt!.gte!);
        }
        if (where?.createdAt?.lte) {
          filtered = filtered.filter((r) => r.createdAt <= where.createdAt!.lte!);
        }
        if (orderBy?.createdAt === "desc") {
          filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return filtered.map((report) => ({
          id: report.id,
          interviewId: report.interviewId,
          recommendation: report.recommendation,
          matchScore: report.matchScore,
          createdAt: report.createdAt,
          ...(include?.interview
            ? {
                interview: {
                  vacancyId: report.vacancyId,
                  candidateUser: report.candidateEmail
                    ? { email: report.candidateEmail }
                    : null,
                  vacancy: { id: report.vacancyId, title: report.vacancyTitle },
                },
              }
            : {}),
        }));
      },
    },
  };
}
```

Update `sampleReport` to include the new fields:

```typescript
const sampleReport: FakeReport = {
  id: "rep_1",
  interviewId: "i1",
  hrUserId: "hr_1",
  candidateEmail: "anna@co.ua",
  vacancyId: "vac_1",
  vacancyTitle: "Senior Node",
  reportMarkdown: "## Підсумок\n\nКандидат підходить.",
  recommendation: "HIRE",
  matchScore: 82,
  strengths: ["Досвід Node.js"],
  risks: ["Мало leadership"],
  createdAt: new Date("2026-07-14T09:00:00.000Z"),
};
```

- [ ] **Step 2: Add failing list tests**

Append to `backend/src/routes/reports.test.ts`:

```typescript
test("GET /reports returns empty array when HR has no reports", async () => {
  const app = makeApp(makeFakePrisma(), { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.reports, []);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports returns only current HR reports with summary fields", async () => {
  const other: FakeReport = {
    ...sampleReport,
    id: "rep_other",
    interviewId: "i2",
    hrUserId: "hr_other",
    candidateEmail: "other@co.ua",
  };
  const app = makeApp(makeFakePrisma([sampleReport, other]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_1");
    assert.equal(body.reports[0].candidateEmail, "anna@co.ua");
    assert.equal(body.reports[0].vacancyId, "vac_1");
    assert.equal(body.reports[0].vacancyTitle, "Senior Node");
    assert.equal(body.reports[0].matchScore, 82);
    assert.equal(body.reports[0].recommendation, "HIRE");
    assert.equal(body.reports[0].interviewId, "i1");
    assert.equal(body.reports[0].createdAt, sampleReport.createdAt.toISOString());
    assert.equal(body.reports[0].reportMarkdown, undefined);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run:

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

Expected: new list tests FAIL (404 or cannot GET `/api/reports` without matching handler / wrong shape). Existing `:id` tests still pass.

- [ ] **Step 4: Commit test scaffolding**

```bash
git add backend/src/routes/reports.test.ts
git commit -m "test: add failing GET /api/reports list cases"
```

---

### Task 2: Implement `GET /api/reports` (no filters yet)

**Files:**
- Modify: `backend/src/routes/reports.ts`

- [ ] **Step 1: Add list handler before `:id`**

In `backend/src/routes/reports.ts`, insert **before** `router.get("/reports/:id", ...)`:

```typescript
router.get("/reports", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const hrUserId = req.user!.id;

  const reports = await prisma.finalReport.findMany({
    where: {
      interview: { hrUserId },
    },
    include: {
      interview: {
        select: {
          vacancyId: true,
          candidateUser: { select: { email: true } },
          vacancy: { select: { id: true, title: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json({
    reports: reports.map((report) => ({
      id: report.id,
      interviewId: report.interviewId,
      candidateEmail: report.interview.candidateUser?.email ?? null,
      vacancyId: report.interview.vacancy.id,
      vacancyTitle: report.interview.vacancy.title,
      matchScore: report.matchScore,
      recommendation: report.recommendation,
      createdAt: report.createdAt,
    })),
  });
});
```

- [ ] **Step 2: Run list tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

Expected: all tests in this file PASS (including existing `:id` tests).

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/reports.ts
git commit -m "feat: add GET /api/reports list for HR"
```

---

### Task 3: Filter query params (TDD)

**Files:**
- Modify: `backend/src/routes/reports.test.ts`
- Modify: `backend/src/routes/reports.ts`

- [ ] **Step 1: Write failing filter tests**

Append:

```typescript
const maybeReport: FakeReport = {
  ...sampleReport,
  id: "rep_2",
  interviewId: "i2",
  candidateEmail: "ivan@co.ua",
  vacancyId: "vac_2",
  vacancyTitle: "Frontend",
  recommendation: "MAYBE",
  matchScore: 61,
  createdAt: new Date("2026-07-12T12:00:00.000Z"),
};

test("GET /reports filters by recommendation", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?recommendation=MAYBE`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_2");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports returns 400 for invalid recommendation", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?recommendation=YES`,
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid recommendation");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports filters by vacancyId", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?vacancyId=vac_1`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_1");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports filters by email contains (case-insensitive)", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports?email=ANNA`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].candidateEmail, "anna@co.ua");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports filters by dateFrom and dateTo (UTC day bounds)", async () => {
  const app = makeApp(makeFakePrisma([sampleReport, maybeReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?dateFrom=2026-07-14&dateTo=2026-07-14`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, "rep_1");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("GET /reports returns 400 for invalid dateFrom", async () => {
  const app = makeApp(makeFakePrisma([sampleReport]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/reports?dateFrom=14-07-2026`,
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid dateFrom");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

Expected: filter tests FAIL (unfiltered results or missing 400).

- [ ] **Step 3: Implement filters in list handler**

Replace the `GET /reports` handler body in `backend/src/routes/reports.ts` with:

```typescript
router.get("/reports", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const hrUserId = req.user!.id;

  const recommendationRaw = typeof req.query.recommendation === "string"
    ? req.query.recommendation
    : undefined;
  const vacancyId =
    typeof req.query.vacancyId === "string" && req.query.vacancyId.length > 0
      ? req.query.vacancyId
      : undefined;
  const email =
    typeof req.query.email === "string" && req.query.email.trim().length > 0
      ? req.query.email.trim()
      : undefined;
  const dateFromRaw =
    typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateToRaw =
    typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

  const ALLOWED = new Set(["HIRE", "MAYBE", "REJECT"]);
  if (recommendationRaw !== undefined && !ALLOWED.has(recommendationRaw)) {
    res.status(400).json({ error: "Invalid recommendation" });
    return;
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  let createdAt: { gte?: Date; lte?: Date } | undefined;
  if (dateFromRaw !== undefined) {
    if (!DATE_RE.test(dateFromRaw)) {
      res.status(400).json({ error: "Invalid dateFrom" });
      return;
    }
    createdAt = {
      ...(createdAt ?? {}),
      gte: new Date(`${dateFromRaw}T00:00:00.000Z`),
    };
  }
  if (dateToRaw !== undefined) {
    if (!DATE_RE.test(dateToRaw)) {
      res.status(400).json({ error: "Invalid dateTo" });
      return;
    }
    createdAt = {
      ...(createdAt ?? {}),
      lte: new Date(`${dateToRaw}T23:59:59.999Z`),
    };
  }

  const reports = await prisma.finalReport.findMany({
    where: {
      interview: {
        hrUserId,
        ...(vacancyId ? { vacancyId } : {}),
        ...(email
          ? { candidateUser: { email: { contains: email, mode: "insensitive" } } }
          : {}),
      },
      ...(recommendationRaw
        ? { recommendation: recommendationRaw as "HIRE" | "MAYBE" | "REJECT" }
        : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    include: {
      interview: {
        select: {
          vacancyId: true,
          candidateUser: { select: { email: true } },
          vacancy: { select: { id: true, title: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json({
    reports: reports.map((report) => ({
      id: report.id,
      interviewId: report.interviewId,
      candidateEmail: report.interview.candidateUser?.email ?? null,
      vacancyId: report.interview.vacancy.id,
      vacancyTitle: report.interview.vacancy.title,
      matchScore: report.matchScore,
      recommendation: report.recommendation,
      createdAt: report.createdAt,
    })),
  });
});
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts
git commit -m "feat: filter GET /api/reports by vacancy, recommendation, email, dates"
```

---

### Task 4: Frontend API `fetchReports`

**Files:**
- Modify: `frontend/src/api/reports.ts`

- [ ] **Step 1: Add types and `fetchReports`**

Append to `frontend/src/api/reports.ts` (after `FinalReport` type, before or after `fetchReport`):

```typescript
export type ReportSummary = {
  id: string;
  interviewId: string;
  candidateEmail: string | null;
  vacancyId: string;
  vacancyTitle: string;
  matchScore: number;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  createdAt: string;
};

export type ReportListFilters = {
  vacancyId?: string;
  recommendation?: "HIRE" | "MAYBE" | "REJECT";
  email?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function fetchReports(
  filters: ReportListFilters = {},
): Promise<ReportSummary[]> {
  const params = new URLSearchParams();
  if (filters.vacancyId) params.set("vacancyId", filters.vacancyId);
  if (filters.recommendation) params.set("recommendation", filters.recommendation);
  if (filters.email) params.set("email", filters.email);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString();
  const response = await fetchWithAuth(`/api/reports${qs ? `?${qs}` : ""}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити список звітів");
  }
  const body = (await response.json()) as { reports: ReportSummary[] };
  return body.reports;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/reports.ts
git commit -m "feat: add fetchReports API client"
```

---

### Task 5: `ReportListView` + route + sidebar

**Files:**
- Create: `frontend/src/views/ReportListView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/components/HrSidebar.vue`

- [ ] **Step 1: Create `ReportListView.vue`**

Create `frontend/src/views/ReportListView.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  fetchReports,
  type ReportListFilters,
  type ReportSummary,
} from "../api/reports";
import { fetchMyVacancies, type VacancySummary } from "../api/vacancies";

type ListState = "loading" | "ready" | "error";

const RECOMMENDATION_LABELS: Record<string, string> = {
  HIRE: "Найняти",
  MAYBE: "Під питанням",
  REJECT: "Відхилити",
};

const reports = ref<ReportSummary[]>([]);
const vacancies = ref<VacancySummary[]>([]);
const listState = ref<ListState>("loading");
const listError = ref<string | null>(null);

const vacancyId = ref("");
const recommendation = ref("");
const email = ref("");
const dateFrom = ref("");
const dateTo = ref("");

const hasActiveFilters = computed(
  () =>
    Boolean(vacancyId.value) ||
    Boolean(recommendation.value) ||
    Boolean(email.value.trim()) ||
    Boolean(dateFrom.value) ||
    Boolean(dateTo.value),
);

function recommendationLabel(value: string): string {
  return RECOMMENDATION_LABELS[value] ?? value;
}

function badgeClass(value: string): string {
  if (value === "HIRE") return "badge-hire";
  if (value === "MAYBE") return "badge-maybe";
  if (value === "REJECT") return "badge-reject";
  return "";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

function currentFilters(): ReportListFilters {
  const filters: ReportListFilters = {};
  if (vacancyId.value) filters.vacancyId = vacancyId.value;
  if (recommendation.value === "HIRE" || recommendation.value === "MAYBE" || recommendation.value === "REJECT") {
    filters.recommendation = recommendation.value;
  }
  const trimmed = email.value.trim();
  if (trimmed) filters.email = trimmed;
  if (dateFrom.value) filters.dateFrom = dateFrom.value;
  if (dateTo.value) filters.dateTo = dateTo.value;
  return filters;
}

async function loadReports(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    reports.value = await fetchReports(currentFilters());
    listState.value = "ready";
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити список звітів";
  }
}

function resetFilters(): void {
  vacancyId.value = "";
  recommendation.value = "";
  email.value = "";
  dateFrom.value = "";
  dateTo.value = "";
}

let emailTimer: ReturnType<typeof setTimeout> | null = null;

watch([vacancyId, recommendation, dateFrom, dateTo], () => {
  void loadReports();
});

watch(email, () => {
  if (emailTimer) clearTimeout(emailTimer);
  emailTimer = setTimeout(() => {
    void loadReports();
  }, 300);
});

onMounted(async () => {
  try {
    vacancies.value = await fetchMyVacancies();
  } catch {
    // dropdown empty; reports can still load
  }
  await loadReports();
});
</script>

<template>
  <div class="report-list">
    <div class="list-header">
      <h1>Звіти</h1>
      <button
        v-if="hasActiveFilters"
        type="button"
        class="btn-reset"
        @click="resetFilters"
      >
        Скинути фільтри
      </button>
    </div>

    <div class="filters" aria-label="Фільтри звітів">
      <label class="filter-field">
        <span class="filter-label">Вакансія</span>
        <select v-model="vacancyId">
          <option value="">Усі</option>
          <option v-for="v in vacancies" :key="v.id" :value="v.id">
            {{ v.title }}
          </option>
        </select>
      </label>
      <label class="filter-field">
        <span class="filter-label">Рекомендація</span>
        <select v-model="recommendation">
          <option value="">Усі</option>
          <option value="HIRE">Найняти</option>
          <option value="MAYBE">Під питанням</option>
          <option value="REJECT">Відхилити</option>
        </select>
      </label>
      <label class="filter-field">
        <span class="filter-label">Пошта</span>
        <input v-model="email" type="search" placeholder="пошук…" />
      </label>
      <label class="filter-field">
        <span class="filter-label">Від</span>
        <input v-model="dateFrom" type="date" />
      </label>
      <label class="filter-field">
        <span class="filter-label">До</span>
        <input v-model="dateTo" type="date" />
      </label>
    </div>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="reports.length === 0" class="muted">
      <template v-if="hasActiveFilters">
        Нічого не знайдено за цими фільтрами.
      </template>
      <template v-else>
        Ще немає звітів. Вони з’являться після завершення співбесід.
      </template>
    </p>
    <table v-else class="reports-table">
      <thead>
        <tr>
          <th>Пошта</th>
          <th>Вакансія</th>
          <th>Оцінка</th>
          <th>Рекомендація</th>
          <th>Дата</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="report in reports" :key="report.id">
          <td>
            <RouterLink
              v-if="report.candidateEmail"
              :to="{ name: 'report', params: { id: report.id } }"
              class="email-link"
            >
              {{ report.candidateEmail }}
            </RouterLink>
            <RouterLink
              v-else
              :to="{ name: 'report', params: { id: report.id } }"
              class="email-link"
            >
              —
            </RouterLink>
          </td>
          <td>{{ report.vacancyTitle }}</td>
          <td>{{ report.matchScore }}%</td>
          <td>
            <RouterLink
              :to="{ name: 'report', params: { id: report.id } }"
              class="report-badge"
              :class="badgeClass(report.recommendation)"
            >
              {{ recommendationLabel(report.recommendation) }}
            </RouterLink>
          </td>
          <td>{{ formatDate(report.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.report-list h1 {
  margin: 0;
  font-size: 1.25rem;
}
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 8rem;
}
.filter-label {
  font-size: 0.75rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.filter-field select,
.filter-field input {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--surface);
  color: var(--text);
}
.btn-reset {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.muted {
  color: var(--muted);
}
.fail {
  color: var(--danger);
}
.reports-table {
  width: 100%;
  border-collapse: collapse;
}
.reports-table th,
.reports-table td {
  text-align: left;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.reports-table th {
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.email-link {
  color: var(--accent);
  text-decoration: none;
}
.email-link:hover {
  text-decoration: underline;
}
.report-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}
.report-badge.badge-hire {
  background: #dcfce7;
  color: #16a34a;
}
.report-badge.badge-maybe {
  background: #fef9c3;
  color: #ca8a04;
}
.report-badge.badge-reject {
  background: #fee2e2;
  color: #dc2626;
}
</style>
```

Note: `onMounted` calls `loadReports` which also triggers via watches when filters reset — avoid double-fetch races by not watching until after mount if needed. Prefer this simpler pattern: remove the dual `Promise.all` issue — `loadReports` is called once in `onMounted` and again when filters change. Fix `onMounted` to:

```typescript
onMounted(async () => {
  try {
    vacancies.value = await fetchMyVacancies();
  } catch {
    // dropdown empty; reports can still load
  }
  await loadReports();
});
```

Use that version in the file (replace the `onMounted` block above).

- [ ] **Step 2: Register route**

In `frontend/src/router/index.ts`:

1. Add import:

```typescript
import ReportListView from "../views/ReportListView.vue";
```

2. Inside `HrLayout` children, after the interviews routes (before or after `report/:id`), add:

```typescript
{
  path: "reports",
  name: "reports",
  component: ReportListView,
},
```

Keep `{ path: "report/:id", name: "report", ... }` unchanged.

- [ ] **Step 3: Add sidebar link**

In `frontend/src/components/HrSidebar.vue`, after the «Співбесіди» `RouterLink`, add:

```vue
    <RouterLink to="/reports" class="nav-item" :class="{ active: isActive('/reports') }">
      Звіти
    </RouterLink>
```

- [ ] **Step 4: Typecheck / smoke**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: no errors related to new files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ReportListView.vue frontend/src/router/index.ts frontend/src/components/HrSidebar.vue
git commit -m "feat: add HR reports list tab with filters"
```

---

### Task 6: Manual verification

**Files:** none (manual)

- [ ] **Step 1: Start stack** (if not running)

```bash
# from repo root, use your usual docker/postgres +:
cd backend && npm run dev
cd frontend && npm run dev
```

- [ ] **Step 2: Checklist**

1. Login as HR → сайдбар показує «Звіти»; `/reports` підсвічує пункт
2. Без звітів — empty copy
3. Після завершеної співбесіди — рядок з поштою, вакансією, `%`, badge, датою
4. Фільтр вакансії / рекомендації / пошти / дат змінює список
5. «Скинути фільтри» очищає й повертає повний список
6. Клік по пошті або badge відкриває `/report/:id`
7. Backend suite still green:

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

- [ ] **Step 3: Final commit only if manual fixes were needed**

Otherwise done — no empty commit.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Sidebar «Звіти» → `/reports` | Task 5 |
| `ReportListView` table columns | Task 5 |
| Filters: vacancy, recommendation, email, dates | Tasks 3 + 5 |
| `GET /api/reports` + ownership | Tasks 1–2 |
| Query validation 400 | Task 3 |
| Click → existing `/report/:id` | Task 5 |
| `fetchReports` client | Task 4 |
| Backend tests | Tasks 1, 3 |
| No Prisma schema change / no ReportView change | respected |
| Calm Slate tokens in UI | Task 5 styles use `--*` tokens |

**Placeholder scan:** none remaining.  
**Type consistency:** `ReportSummary` / `ReportListFilters` match spec and Tasks 4–5.

# Vacancy Hide from Match — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дозволити HR ховати/показувати вакансію (`hiddenAt`) так, щоб вона зникала з кандидатського match без видалення співбесід і звітів.

**Architecture:** Nullable `Vacancy.hiddenAt` ортогональний до `DRAFT`/`CONFIRMED`. Hide блокується тими ж статусами, що й активні співбесіди кандидата (`AWAITING_CANDIDATE|READY|LIVE` через `ACTIVE_CANDIDATE_INTERVIEW_STATUSES`). Match і створення нових співбесід вимагають `hiddenAt: null`. HR list фільтрує через `?visibility=active|hidden`.

**Tech Stack:** Prisma + Express (`node:test`), Vue 3 + `fetchWithAuth`.

**Spec:** `docs/superpowers/specs/2026-07-22-vacancy-hide-design.md`

## Global Constraints

- Blocking statuses for hide: exactly `AWAITING_CANDIDATE`, `READY`, `LIVE` — reuse `ACTIVE_CANDIDATE_INTERVIEW_STATUSES` from `backend/src/utils/interview-readiness.ts`.
- `ENDED` and legacy interview `DRAFT` do **not** block hide.
- Hide/unhide do **not** delete interviews, reports, applications, match scores, or company profile.
- Hard delete rules unchanged (any linked interview → 409).
- Error code for blocked hide: `ACTIVE_INTERVIEWS_EXIST`; human `error` string (UA): `Неможливо сховати: є активні співбесіди`.
- Error for create-interview on hidden vacancy: HTTP 409, `error` code/message includes `VACANCY_HIDDEN` (body: `{ error: "VACANCY_HIDDEN", message: "Вакансію приховано" }` or single `error: "VACANCY_HIDDEN"` — use `{ error: "VACANCY_HIDDEN" }` for consistency with existing 409 shapes).
- Hide/unhide are idempotent (`200` with current vacancy).
- `GET /vacancies/mine` default `visibility=active` (`hiddenAt: null`); `visibility=hidden` → `hiddenAt: { not: null }`.
- UI copy: tabs **Активні** / **Приховані**; buttons **Приховати** / **Показати**; toast on 409 hide: `Неможливо сховати: є активні співбесіди`.
- Do not introduce `VacancyStatus.HIDDEN`.

---

## File Structure

| File | Role |
|------|------|
| `backend/prisma/schema.prisma` | `Vacancy.hiddenAt DateTime?` |
| `backend/prisma/migrations/20260722180000_vacancy_hidden_at/migration.sql` | ALTER TABLE |
| `backend/src/routes/vacancies.ts` | serialize `hiddenAt`; filter mine; `POST hide` / `POST unhide` |
| `backend/src/routes/vacancies.test.ts` | route tests + fake Prisma extensions |
| `backend/src/services/vacancy-match.ts` | `listMatchableVacancies` requires `hiddenAt: null` |
| `backend/src/services/vacancy-match.test.ts` | assert hidden vacancies excluded |
| `backend/src/routes/interviews.ts` | block create when `hiddenAt != null` |
| `backend/src/routes/interviews.test.ts` | 409 on hidden vacancy |
| `backend/src/routes/hr-applications.ts` | block create-interview when vacancy hidden |
| `backend/src/routes/hr-applications.test.ts` | 409 on hidden vacancy |
| `frontend/src/api/vacancies.ts` | `hiddenAt`, `visibility`, `hideVacancy`, `unhideVacancy` |
| `frontend/src/views/VacancyListView.vue` | tabs + hide/show buttons |
| `frontend/src/components/CreateInterviewModal.vue` | only non-hidden CONFIRMED |

---

### Task 1: Prisma — `hiddenAt` on Vacancy

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260722180000_vacancy_hidden_at/migration.sql`

**Interfaces:**
- Produces: `Vacancy.hiddenAt: DateTime | null` (Prisma client after generate)

- [ ] **Step 1: Add field to schema**

In `model Vacancy` after `status` (or after `updatedAt`), add:

```prisma
  hiddenAt  DateTime?
```

Keep existing `@@index([hrUserId, createdAt(sort: Desc)])` unchanged (YAGNI for new index).

- [ ] **Step 2: Add migration SQL**

Create `backend/prisma/migrations/20260722180000_vacancy_hidden_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Vacancy" ADD COLUMN "hiddenAt" TIMESTAMP(3);
```

- [ ] **Step 3: Generate client**

Run from `backend/`:

```bash
npx prisma generate
```

Expected: success, no schema errors.

- [ ] **Step 4: Apply migration (local)**

```bash
npx prisma migrate deploy
```

Expected: migration applied (or `migrate dev` if that is the local habit — prefer `migrate deploy` if DB already tracked).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260722180000_vacancy_hidden_at/migration.sql
git commit -m "feat(db): add Vacancy.hiddenAt for match visibility"
```

---

### Task 2: Backend — hide / unhide / mine visibility

**Files:**
- Modify: `backend/src/routes/vacancies.ts`
- Modify: `backend/src/routes/vacancies.test.ts`
- Test: `backend/src/routes/vacancies.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_CANDIDATE_INTERVIEW_STATUSES` from `../utils/interview-readiness`
- Produces:
  - Vacancy JSON always includes `hiddenAt: string | null` (ISO from `Date`, or `null`)
  - `GET /api/vacancies/mine?visibility=active|hidden`
  - `POST /api/vacancies/:id/hide` → `{ vacancy }`
  - `POST /api/vacancies/:id/unhide` → `{ vacancy }`

- [ ] **Step 1: Extend fake Prisma and types in tests**

In `vacancies.test.ts`, update `FakeVacancy`:

```ts
type FakeVacancy = {
  id: string;
  hrUserId: string;
  title: string;
  status: string;
  createdAt: Date;
  hiddenAt?: Date | null;
  _interviewCount?: number;
  _interviewStatuses?: string[];
  companyProfile?: FakeCompanyProfile | null;
};
```

Change interview seed so statuses come from `_interviewStatuses` when provided:

```ts
const interviews: { vacancyId: string; status: string }[] = vacancies.flatMap((v) => {
  if (v._interviewStatuses?.length) {
    return v._interviewStatuses.map((status) => ({ vacancyId: v.id, status }));
  }
  return Array.from({ length: v._interviewCount ?? 0 }, () => ({
    vacancyId: v.id,
    status: "ENDED",
  }));
});
```

Update `findMany` to honor visibility filters:

```ts
findMany: async ({
  where,
}: {
  where: {
    hrUserId: string;
    hiddenAt?: null | { not: null };
  };
}) =>
  vacancies
    .filter((v) => {
      if (v.hrUserId !== where.hrUserId) return false;
      const hiddenAt = v.hiddenAt ?? null;
      if (where.hiddenAt === null) return hiddenAt === null;
      if (where.hiddenAt && "not" in where.hiddenAt && where.hiddenAt.not === null) {
        return hiddenAt !== null;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
```

Extend `update` data to allow `hiddenAt: Date | null`.

Add:

```ts
interview: {
  count: async ({ where }: { where: { vacancyId: string } }) =>
    interviews.filter((i) => i.vacancyId === where.vacancyId).length,
  findFirst: async ({
    where,
  }: {
    where: { vacancyId: string; status?: { in: string[] } };
  }) => {
    const allowed = where.status?.in;
    return (
      interviews.find(
        (item) =>
          item.vacancyId === where.vacancyId &&
          (allowed == null || allowed.includes(item.status)),
      ) ?? null
    );
  },
},
```

Ensure create sets `hiddenAt: null`.

- [ ] **Step 2: Write failing tests**

Append to `vacancies.test.ts`:

```ts
test("GET /vacancies/mine?visibility=hidden returns only hidden", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Visible",
      status: "CONFIRMED",
      createdAt: new Date("2026-01-02"),
      hiddenAt: null,
    },
    {
      id: "v2",
      hrUserId: "hr_1",
      title: "Hidden",
      status: "CONFIRMED",
      createdAt: new Date("2026-01-01"),
      hiddenAt: new Date("2026-01-03"),
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const active = await fetch(`http://127.0.0.1:${port}/api/vacancies/mine`);
    assert.equal(active.status, 200);
    const activeBody = await active.json();
    assert.equal(activeBody.vacancies.length, 1);
    assert.equal(activeBody.vacancies[0].id, "v1");
    assert.equal(activeBody.vacancies[0].hiddenAt, null);

    const hidden = await fetch(`http://127.0.0.1:${port}/api/vacancies/mine?visibility=hidden`);
    assert.equal(hidden.status, 200);
    const hiddenBody = await hidden.json();
    assert.equal(hiddenBody.vacancies.length, 1);
    assert.equal(hiddenBody.vacancies[0].id, "v2");
    assert.ok(typeof hiddenBody.vacancies[0].hiddenAt === "string");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /vacancies/:id/hide succeeds when only ENDED interviews", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      hiddenAt: null,
      _interviewStatuses: ["ENDED"],
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1/hide`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.vacancy.hiddenAt);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /vacancies/:id/hide returns 409 ACTIVE_INTERVIEWS_EXIST for LIVE", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      hiddenAt: null,
      _interviewStatuses: ["LIVE"],
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1/hide`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "ACTIVE_INTERVIEWS_EXIST");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /vacancies/:id/unhide clears hiddenAt", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      hiddenAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1/unhide`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vacancy.hiddenAt, null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

Also add a short test that `AWAITING_CANDIDATE` blocks hide (same as LIVE).

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/vacancies.test.ts
```

Expected: new tests fail (404 / missing routes / missing `hiddenAt`).

- [ ] **Step 4: Implement serialization + mine filter + hide/unhide**

In `vacancies.ts`:

```ts
import { ACTIVE_CANDIDATE_INTERVIEW_STATUSES } from "../utils/interview-readiness";

function serializeVacancySummary(item: {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  hiddenAt: Date | null;
}) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    createdAt: item.createdAt,
    hiddenAt: item.hiddenAt ? item.hiddenAt.toISOString() : null,
  };
}
```

Use it in GET mine, POST create, PATCH, GET :id (add `hiddenAt`), hide, unhide.

`GET /vacancies/mine`:

```ts
router.get("/vacancies/mine", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const visibility = req.query.visibility === "hidden" ? "hidden" : "active";
  const vacancies = await prisma.vacancy.findMany({
    where: {
      hrUserId: req.user?.id,
      ...(visibility === "hidden"
        ? { hiddenAt: { not: null } }
        : { hiddenAt: null }),
    },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({
    vacancies: vacancies.map(serializeVacancySummary),
  });
});
```

Register **before** `/:id` routes if path conflict — `hide`/`unhide` are under `/:id/hide` so order after `mine` is fine:

```ts
router.post("/vacancies/:id/hide", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const vacancy = await prisma.vacancy.findUnique({ where: { id: req.params.id } });
  if (!vacancy) {
    res.status(404).json({ error: "Vacancy not found" });
    return;
  }
  if (vacancy.hrUserId !== req.user?.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (vacancy.hiddenAt != null) {
    res.status(200).json({ vacancy: serializeVacancySummary(vacancy) });
    return;
  }
  const blocking = await prisma.interview.findFirst({
    where: {
      vacancyId: vacancy.id,
      status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
    },
    select: { id: true },
  });
  if (blocking) {
    res.status(409).json({
      error: "ACTIVE_INTERVIEWS_EXIST",
      message: "Неможливо сховати: є активні співбесіди",
    });
    return;
  }
  const updated = await prisma.vacancy.update({
    where: { id: vacancy.id },
    data: { hiddenAt: new Date() },
  });
  res.status(200).json({ vacancy: serializeVacancySummary(updated) });
});

router.post("/vacancies/:id/unhide", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const vacancy = await prisma.vacancy.findUnique({ where: { id: req.params.id } });
  if (!vacancy) {
    res.status(404).json({ error: "Vacancy not found" });
    return;
  }
  if (vacancy.hrUserId !== req.user?.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (vacancy.hiddenAt == null) {
    res.status(200).json({ vacancy: serializeVacancySummary(vacancy) });
    return;
  }
  const updated = await prisma.vacancy.update({
    where: { id: vacancy.id },
    data: { hiddenAt: null },
  });
  res.status(200).json({ vacancy: serializeVacancySummary(updated) });
});
```

Ensure create responses include `hiddenAt: null`.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/vacancies.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/vacancies.ts backend/src/routes/vacancies.test.ts
git commit -m "feat(api): hide and unhide vacancies with visibility filter"
```

---

### Task 3: Match pool excludes hidden vacancies

**Files:**
- Modify: `backend/src/services/vacancy-match.ts`
- Modify: `backend/src/services/vacancy-match.test.ts`
- Test: `backend/src/services/vacancy-match.test.ts`

**Interfaces:**
- Consumes: Prisma `vacancy.findMany` where clause
- Produces: `listMatchableVacancies` only rows with `hiddenAt: null`

- [ ] **Step 1: Find existing listMatchableVacancies test setup**

Open `vacancy-match.test.ts` and locate how vacancies are seeded for match listing / ranking. Mirror that pattern for a hidden vacancy fixture.

- [ ] **Step 2: Write failing test**

Add a focused unit test that calls `listMatchableVacancies` with a fake/in-memory prisma (same style as existing tests in that file). Seed one confirmed visible vacancy and one confirmed with `hiddenAt: new Date()`. Assert only the visible id is returned.

If the file uses real Prisma mocks via `findMany` spy, assert the `where` includes `hiddenAt: null` **and** the result excludes hidden — prefer result-based assertion.

Example shape (adapt to existing fake):

```ts
test("listMatchableVacancies excludes hidden vacancies", async () => {
  // arrange: prisma fake returns two CONFIRMED vacancies, one with hiddenAt set
  // act
  const result = await listMatchableVacancies(prisma as never);
  // assert
  assert.equal(result.length, 1);
  assert.equal(result[0].vacancyId, "visible_id");
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
cd backend && node --import tsx --test src/services/vacancy-match.test.ts
```

Expected: new test fails (hidden still included).

- [ ] **Step 4: Implement filter**

In `listMatchableVacancies`:

```ts
  const vacancies = await prisma.vacancy.findMany({
    where: {
      status: "CONFIRMED",
      hiddenAt: null,
      companyProfile: { confirmedAt: { not: null } },
    },
    include: { companyProfile: true },
  });
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/services/vacancy-match.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/vacancy-match.ts backend/src/services/vacancy-match.test.ts
git commit -m "fix(match): exclude hidden vacancies from candidate match pool"
```

---

### Task 4: Block creating interviews for hidden vacancies

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`
- Modify: `backend/src/routes/hr-applications.ts`
- Modify: `backend/src/routes/hr-applications.test.ts`

**Interfaces:**
- Produces: both create paths return `409` `{ error: "VACANCY_HIDDEN" }` when `vacancy.hiddenAt != null`

- [ ] **Step 1: Write failing interview create test**

In `interviews.test.ts`, after confirmed-vacancy fixtures exist, add vacancy with `hiddenAt: new Date()` and:

```ts
test("POST /interviews returns 409 VACANCY_HIDDEN when vacancy is hidden", async () => {
  // seed vacancy CONFIRMED + hiddenAt set, owned by hr
  // POST /api/interviews { vacancyId }
  // assert status 409, body.error === "VACANCY_HIDDEN"
});
```

Extend fake vacancy type with `hiddenAt?: Date | null` if missing.

- [ ] **Step 2: Write failing hr-applications test**

```ts
test("POST /hr/applications/:id/create-interview returns 409 when vacancy hidden", async () => {
  // PENDING application on CONFIRMED vacancy with hiddenAt set
  // POST create-interview
  // assert 409 VACANCY_HIDDEN
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/interviews.test.ts src/routes/hr-applications.test.ts
```

- [ ] **Step 4: Implement gates**

In `interviews.ts` after ownership/confirmed checks:

```ts
    if (vacancy.hiddenAt != null) {
      res.status(409).json({ error: "VACANCY_HIDDEN" });
      return;
    }
```

In `hr-applications.ts` after confirmed check:

```ts
    if (application.vacancy.hiddenAt != null) {
      res.status(409).json({ error: "VACANCY_HIDDEN" });
      return;
    }
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/interviews.test.ts src/routes/hr-applications.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts \
  backend/src/routes/hr-applications.ts backend/src/routes/hr-applications.test.ts
git commit -m "fix(api): block new interviews on hidden vacancies"
```

---

### Task 5: Frontend API + VacancyListView tabs and actions

**Files:**
- Modify: `frontend/src/api/vacancies.ts`
- Modify: `frontend/src/views/VacancyListView.vue`
- Modify: `frontend/src/components/CreateInterviewModal.vue`

**Interfaces:**
- Produces:
  - `VacancySummary.hiddenAt: string | null`
  - `fetchMyVacancies(visibility?: "active" | "hidden")`
  - `hideVacancy(id: string): Promise<VacancySummary>`
  - `unhideVacancy(id: string): Promise<VacancySummary>`

- [ ] **Step 1: Update API client**

```ts
export type VacancySummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  hiddenAt: string | null;
};

export async function fetchMyVacancies(
  visibility: "active" | "hidden" = "active",
): Promise<VacancySummary[]> {
  const params = new URLSearchParams({ visibility });
  const response = await fetchWithAuth(`/api/vacancies/mine?${params}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити список анкет");
  }
  const body = (await response.json()) as { vacancies: VacancySummary[] };
  return body.vacancies;
}

export async function hideVacancy(id: string): Promise<VacancySummary> {
  const response = await fetchWithAuth(`/api/vacancies/${id}/hide`, { method: "POST" });
  if (!response.ok) {
    let body: ErrorBody & { message?: string } = {};
    try {
      body = (await response.json()) as ErrorBody & { message?: string };
    } catch {
      // ignore
    }
    if (response.status === 409 && body.error === "ACTIVE_INTERVIEWS_EXIST") {
      throw new Error(body.message ?? "Неможливо сховати: є активні співбесіди");
    }
    throw await parseError(response, "Не вдалося сховати вакансію");
  }
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}

export async function unhideVacancy(id: string): Promise<VacancySummary> {
  const response = await fetchWithAuth(`/api/vacancies/${id}/unhide`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося показати вакансію");
  }
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}
```

- [ ] **Step 2: Update VacancyListView**

Add visibility tab state and reload:

```ts
import {
  deleteVacancy,
  fetchMyVacancies,
  hideVacancy,
  unhideVacancy,
  type VacancySummary,
} from "../api/vacancies";

const visibility = ref<"active" | "hidden">("active");

async function loadVacancies(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    vacancies.value = await fetchMyVacancies(visibility.value);
    listState.value = "ready";
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити список анкет";
  }
}

async function onHide(vacancy: VacancySummary): Promise<void> {
  actionError.value = null;
  try {
    await hideVacancy(vacancy.id);
    vacancies.value = vacancies.value.filter((item) => item.id !== vacancy.id);
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося сховати вакансію";
  }
}

async function onUnhide(vacancy: VacancySummary): Promise<void> {
  actionError.value = null;
  try {
    await unhideVacancy(vacancy.id);
    vacancies.value = vacancies.value.filter((item) => item.id !== vacancy.id);
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося показати вакансію";
  }
}

function setVisibility(next: "active" | "hidden"): void {
  visibility.value = next;
  void loadVacancies();
}
```

In template, under header (before loading):

```html
    <div class="visibility-tabs" role="tablist" aria-label="Видимість вакансій">
      <button
        type="button"
        role="tab"
        :aria-selected="visibility === 'active'"
        :class="{ active: visibility === 'active' }"
        @click="setVisibility('active')"
      >
        Активні
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="visibility === 'hidden'"
        :class="{ active: visibility === 'hidden' }"
        @click="setVisibility('hidden')"
      >
        Приховані
      </button>
    </div>
```

In actions cell:

```html
              <button
                v-if="visibility === 'active'"
                type="button"
                class="btn-secondary"
                @click="onHide(vacancy)"
              >
                Приховати
              </button>
              <button
                v-else
                type="button"
                class="btn-secondary"
                @click="onUnhide(vacancy)"
              >
                Показати
              </button>
```

Empty-state copy: for hidden tab use «Немає прихованих вакансій.»

Add minimal tab styles consistent with existing buttons (border, active accent) — no new design system.

- [ ] **Step 3: Filter CreateInterviewModal**

```ts
      const vacancies = await fetchMyVacancies("active");
      confirmedVacancies.value = vacancies.filter(
        (v) => v.status === "CONFIRMED" && v.hiddenAt == null,
      );
```

- [ ] **Step 4: Manual smoke (optional but recommended)**

1. Login HR → Vacancies → hide a CONFIRMED with only ENDED / no interviews → moves to Приховані.
2. Candidate match no longer offers it.
3. Unhide → back in Активні and match.
4. With LIVE interview → hide shows error message.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/vacancies.ts \
  frontend/src/views/VacancyListView.vue \
  frontend/src/components/CreateInterviewModal.vue
git commit -m "feat(fe): HR tabs to hide and show vacancies from match"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `hiddenAt` field + migration | 1 |
| Hide blocked by AWAITING/READY/LIVE | 2 |
| Hide OK with ENDED / none | 2 |
| Unhide | 2 |
| `mine?visibility=` | 2 |
| Match excludes hidden | 3 |
| No new interviews when hidden | 4 |
| Existing interviews/reports untouched | 2+4 (no delete paths) |
| HR tabs + buttons | 5 |
| CreateInterviewModal only active | 5 |
| Hard delete unchanged | (no task — leave as-is) |

---

## Self-review notes

- No TBD/placeholder steps.
- Error codes and UA copy match Global Constraints.
- `ACTIVE_CANDIDATE_INTERVIEW_STATUSES` reused — same set as spec.
- `hiddenAt` included in API summary type before UI consumes it (Task 2 → Task 5).
- Fake Prisma in vacancies tests must support `findFirst` + `hiddenAt` updates before hide tests pass.

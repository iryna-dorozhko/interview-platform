# HR Vacancy/Interview Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split HR domain into `Vacancy` (questionnaire / job profile) and `Interview` (candidate session), add global HR sidebar layout, overview home, and separate vacancy/interview lists with create flows.

**Architecture:** New Prisma model `Vacancy` owns `CompanyProfile` and `PrepSessionHr`; `Interview` gains required `vacancyId` and `displayName`, keeps candidate-side artifacts. Prep API moves from `/prep/:interviewId` to `/prep/:vacancyId`. Frontend gets `HrLayout` wrapper, new routes under `/vacancies/*` and `/interviews/*`, modals for creation.

**Tech Stack:** Express + Prisma + node:test (backend), Vue 3 `<script setup>` + TypeScript + vue-router (frontend).

**Spec:** `docs/superpowers/specs/2026-07-08-hr-vacancy-interview-split-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` | `Vacancy` model, FK moves, `Interview` fields |
| `backend/src/seed/hr-vacancy.js` | Seed confirmed test vacancy |
| `backend/src/seed/hr-interview.js` | Seed interview linked to vacancy |
| `backend/src/routes/vacancies.ts` | CRUD `/vacancies/*` |
| `backend/src/routes/vacancies.test.ts` | Vacancy route tests |
| `backend/src/routes/prep.ts` | Prep on `vacancyId`, confirm sets `Vacancy.status` |
| `backend/src/routes/prep.test.ts` | Updated fake Prisma + route paths |
| `backend/src/routes/interviews.ts` | `POST` requires `vacancyId`, extended list fields |
| `backend/src/routes/interviews.test.ts` | Updated interview tests |
| `backend/src/server.ts` | Register vacancies router |
| `frontend/src/layouts/HrLayout.vue` | Header + sidebar shell |
| `frontend/src/components/HrSidebar.vue` | Nav icons |
| `frontend/src/views/HrHomeView.vue` | Overview cards + create buttons |
| `frontend/src/views/VacancyListView.vue` | Vacancy table |
| `frontend/src/views/VacancyPrepView.vue` | Company Agent chat (from `CompanyPrepView`) |
| `frontend/src/views/VacancyDetailView.vue` | Read-only profile view |
| `frontend/src/views/InterviewListView.vue` | Interview table |
| `frontend/src/views/InterviewDetailView.vue` | Stub page |
| `frontend/src/components/CreateVacancyModal.vue` | Title form |
| `frontend/src/components/CreateInterviewModal.vue` | Confirmed vacancy picker |
| `frontend/src/api/vacancies.ts` | Vacancy API client |
| `frontend/src/api/prep.ts` | `vacancyId` URLs, `vacancyStatus` response |
| `frontend/src/api/interviews.ts` | Extended types, `POST { vacancyId }` |
| `frontend/src/router/index.ts` | Nested routes under `HrLayout` |

---

### Task 1: Prisma schema — add `Vacancy`, move HR prep relations

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Replace schema with target models**

Apply these changes to `backend/prisma/schema.prisma`:

1. Add enum after `InterviewStatus`:

```prisma
enum VacancyStatus {
  DRAFT
  CONFIRMED
}
```

2. Add `vacanciesAsHr Vacancy[] @relation("HrVacancies")` to `User` model.

3. Add new model:

```prisma
model Vacancy {
  id        String        @id @default(cuid())
  hrUserId  String
  title     String
  status    VacancyStatus @default(DRAFT)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  hrUser         User            @relation("HrVacancies", fields: [hrUserId], references: [id])
  companyProfile CompanyProfile?
  prepSessionHr  PrepSessionHr?
  interviews     Interview[]

  @@index([hrUserId, createdAt(sort: Desc)])
}
```

4. Update `Interview` — add fields, remove HR prep relations:

```prisma
model Interview {
  id              String          @id @default(cuid())
  hrUserId        String
  vacancyId       String
  candidateUserId String?
  displayName     String
  joinCode        String          @unique @db.Char(6)
  status          InterviewStatus @default(AWAITING_CANDIDATE)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  hrUser           User                  @relation("HrInterviews", fields: [hrUserId], references: [id])
  vacancy          Vacancy               @relation(fields: [vacancyId], references: [id])
  candidateUser    User?                 @relation("CandidateInterviews", fields: [candidateUserId], references: [id])
  candidateProfile CandidateProfile?
  prepSessionCd    PrepSessionCandidate?
  liveSession      LiveSession?
  finalReport      FinalReport?

  @@index([hrUserId, createdAt(sort: Desc)])
  @@index([candidateUserId])
  @@index([vacancyId])
}
```

Remove from `Interview`: `companyProfile`, `prepSessionHr`.

5. Update `CompanyProfile` — rename FK:

```prisma
model CompanyProfile {
  id          String    @id @default(cuid())
  vacancyId   String    @unique
  role        String
  requirements Json
  culture      Json
  expectations Json
  confirmedAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  vacancy      Vacancy   @relation(fields: [vacancyId], references: [id])
}
```

6. Update `PrepSessionHr`:

```prisma
model PrepSessionHr {
  id        String          @id @default(cuid())
  vacancyId String          @unique
  isClosed  Boolean         @default(false)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  vacancy   Vacancy         @relation(fields: [vacancyId], references: [id])
  messages  PrepMessageHr[]
}
```

- [ ] **Step 2: Validate schema**

Run (from `backend/`):

```bash
npm run db:validate
```

Expected: no validation errors.

- [ ] **Step 3: Create migration (reset dev DB if needed)**

Run:

```bash
npm run db:migrate -- --name split_vacancy_interview
```

If migration fails on existing data (FK constraint), reset dev DB:

```bash
docker compose down -v
docker compose up -d postgres
npm run db:migrate -- --name split_vacancy_interview
```

Expected: migration applies cleanly.

- [ ] **Step 4: Generate client**

Run:

```bash
npm run db:generate
```

Expected: Prisma Client regenerated without errors.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/
git commit -m "feat(db): add Vacancy model and split HR prep from Interview"
```

---

### Task 2: Update seed — vacancy + linked interview

**Files:**
- Create: `backend/src/seed/hr-vacancy.js`
- Create: `backend/src/seed/hr-vacancy.test.js`
- Modify: `backend/src/seed/hr-interview.js`
- Modify: `backend/src/seed/hr-interview.test.js`
- Modify: `backend/prisma/seed.js`
- Modify: `backend/package.json` (add `hr-vacancy.test.js` to test script)

- [ ] **Step 1: Write failing seed test for vacancy**

Create `backend/src/seed/hr-vacancy.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED_VACANCY, seedHrVacancy } = require("./hr-vacancy");

test("SEED_VACANCY has fixed test title", () => {
  assert.deepEqual(SEED_VACANCY, { title: "Test Position" });
});

test("seedHrVacancy upserts CONFIRMED vacancy for given HR user", async () => {
  const calls = [];
  const fakePrisma = {
    vacancy: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "vacancy_1", ...args.create };
      },
    },
  };

  const result = await seedHrVacancy(fakePrisma, "user_hr_1");

  assert.equal(result.id, "vacancy_1");
  assert.equal(result.title, "Test Position");
  assert.equal(calls[0].create.hrUserId, "user_hr_1");
  assert.equal(calls[0].create.status, "CONFIRMED");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/seed/hr-vacancy.test.js`
Expected: FAIL — `Cannot find module './hr-vacancy'`.

- [ ] **Step 3: Implement `hr-vacancy.js`**

Create `backend/src/seed/hr-vacancy.js`:

```js
const SEED_VACANCY = {
  title: "Test Position",
};

async function seedHrVacancy(prisma, hrUserId) {
  const existing = await prisma.vacancy.findFirst({
    where: { hrUserId, title: SEED_VACANCY.title },
  });

  if (existing) {
    return { id: existing.id, title: existing.title };
  }

  const vacancy = await prisma.vacancy.create({
    data: {
      hrUserId,
      title: SEED_VACANCY.title,
      status: "CONFIRMED",
    },
  });

  return { id: vacancy.id, title: vacancy.title };
}

module.exports = { SEED_VACANCY, seedHrVacancy };
```

- [ ] **Step 4: Update `hr-interview.js`**

Replace full contents of `backend/src/seed/hr-interview.js`:

```js
const SEED_INTERVIEW = {
  joinCode: "TEST01",
};

async function seedHrInterview(prisma, hrUserId, vacancyId) {
  const interview = await prisma.interview.upsert({
    where: { joinCode: SEED_INTERVIEW.joinCode },
    update: { hrUserId, vacancyId },
    create: {
      hrUserId,
      vacancyId,
      displayName: "Test Position",
      joinCode: SEED_INTERVIEW.joinCode,
      status: "AWAITING_CANDIDATE",
    },
  });

  return { id: interview.id, joinCode: interview.joinCode };
}

module.exports = { SEED_INTERVIEW, seedHrInterview };
```

- [ ] **Step 5: Update `hr-interview.test.js`**

Replace test body:

```js
test("seedHrInterview upserts AWAITING_CANDIDATE interview linked to vacancy", async () => {
  const calls = [];
  const fakePrisma = {
    interview: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "interview_1", ...args.create };
      },
    },
  };

  const result = await seedHrInterview(fakePrisma, "user_hr_1", "vacancy_1");

  assert.equal(result.id, "interview_1");
  assert.equal(result.joinCode, "TEST01");
  assert.equal(calls[0].create.hrUserId, "user_hr_1");
  assert.equal(calls[0].create.vacancyId, "vacancy_1");
  assert.equal(calls[0].create.displayName, "Test Position");
  assert.equal(calls[0].create.status, "AWAITING_CANDIDATE");
});
```

- [ ] **Step 6: Update `prisma/seed.js`**

```js
const { seedHrVacancy } = require("../src/seed/hr-vacancy");
// ...
async function main() {
  const hrUser = await seedHrUser(prisma, { UserRole });
  console.log(`Seeded HR user: ${hrUser.email}`);

  const vacancy = await seedHrVacancy(prisma, hrUser.id);
  console.log(`Seeded test vacancy: id=${vacancy.id} title=${vacancy.title}`);

  const interview = await seedHrInterview(prisma, hrUser.id, vacancy.id);
  console.log(`Seeded test interview: id=${interview.id} joinCode=${interview.joinCode}`);
}
```

- [ ] **Step 7: Add test file to `backend/package.json` test script**

Append `src/seed/hr-vacancy.test.js` after `src/seed/hr-user.test.js`.

- [ ] **Step 8: Run seed tests**

Run: `node --import tsx --test src/seed/hr-vacancy.test.js src/seed/hr-interview.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/seed/ backend/prisma/seed.js backend/package.json
git commit -m "feat(seed): add test vacancy and link seed interview to it"
```

---

### Task 3: Vacancies router — CRUD endpoints

**Files:**
- Create: `backend/src/routes/vacancies.ts`
- Create: `backend/src/routes/vacancies.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing test**

Create `backend/src/routes/vacancies.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createVacanciesRouter } from "./vacancies";

type FakeVacancy = {
  id: string;
  hrUserId: string;
  title: string;
  status: string;
  createdAt: Date;
  _interviewCount?: number;
};

function makeFakePrisma(vacancies: FakeVacancy[] = []) {
  let counter = 0;
  const interviews: { vacancyId: string }[] = vacancies.flatMap((v) =>
    Array.from({ length: v._interviewCount ?? 0 }, () => ({ vacancyId: v.id }))
  );

  return {
    vacancy: {
      findMany: async ({ where }: { where: { hrUserId: string } }) =>
        vacancies
          .filter((v) => v.hrUserId === where.hrUserId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      findUnique: async ({ where }: { where: { id: string } }) =>
        vacancies.find((v) => v.id === where.id) ?? null,
      create: async ({ data }: { data: { hrUserId: string; title: string; status: string } }) => {
        counter += 1;
        const created: FakeVacancy = {
          id: `vac_${counter}`,
          hrUserId: data.hrUserId,
          title: data.title,
          status: data.status,
          createdAt: new Date(),
        };
        vacancies.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Pick<FakeVacancy, "title" | "status">>;
      }) => {
        const vacancy = vacancies.find((v) => v.id === where.id);
        if (!vacancy) throw new Error("not found");
        Object.assign(vacancy, data);
        return vacancy;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = vacancies.findIndex((v) => v.id === where.id);
        if (index === -1) throw new Error("not found");
        return vacancies.splice(index, 1)[0];
      },
    },
    interview: {
      count: async ({ where }: { where: { vacancyId: string } }) =>
        interviews.filter((i) => i.vacancyId === where.vacancyId).length,
    },
    companyProfile: {
      updateMany: async () => ({ count: 1 }),
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
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createVacanciesRouter(() => fakePrisma as never));
  return app;
}

test("POST /vacancies creates DRAFT vacancy with title", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Frontend Developer" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.vacancy.title, "Frontend Developer");
    assert.equal(body.vacancy.status, "DRAFT");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /vacancies/:id returns 409 when interviews exist", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "v1", hrUserId: "hr_1", title: "Dev", status: "CONFIRMED", createdAt: new Date(), _interviewCount: 1 },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`, { method: "DELETE" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.interviewCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("PATCH /vacancies/:id on CONFIRMED resets status to DRAFT", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "v1", hrUserId: "hr_1", title: "Dev", status: "CONFIRMED", createdAt: new Date() },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Senior Dev" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vacancy.status, "DRAFT");
    assert.equal(body.vacancy.title, "Senior Dev");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/routes/vacancies.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `vacancies.ts`**

Create `backend/src/routes/vacancies.ts`:

```ts
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

type CreateBody = { title?: unknown };
type PatchBody = { title?: unknown };

export function createVacanciesRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/vacancies/mine", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const vacancies = await prisma.vacancy.findMany({
      where: { hrUserId: req.user?.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      vacancies: vacancies.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        createdAt: item.createdAt,
      })),
    });
  });

  router.post("/vacancies", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CreateBody;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2) {
      res.status(400).json({ error: "Title must be at least 2 characters" });
      return;
    }

    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.create({
      data: { hrUserId: req.user?.id as string, title, status: "DRAFT" },
    });

    res.status(201).json({
      vacancy: {
        id: vacancy.id,
        title: vacancy.title,
        status: vacancy.status,
        createdAt: vacancy.createdAt,
      },
    });
  });

  router.get("/vacancies/:id", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const vacancy = await prisma.vacancy.findUnique({
      where: { id: req.params.id },
      include: { companyProfile: true },
    });

    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    if (vacancy.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.status(200).json({
      vacancy: {
        id: vacancy.id,
        title: vacancy.title,
        status: vacancy.status,
        createdAt: vacancy.createdAt,
        profile: vacancy.companyProfile
          ? {
              role: vacancy.companyProfile.role,
              requirements: vacancy.companyProfile.requirements,
              culture: vacancy.companyProfile.culture,
              expectations: vacancy.companyProfile.expectations,
              confirmedAt: vacancy.companyProfile.confirmedAt,
            }
          : null,
      },
    });
  });

  router.patch("/vacancies/:id", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as PatchBody;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2) {
      res.status(400).json({ error: "Title must be at least 2 characters" });
      return;
    }

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

    const resetConfirmed = vacancy.status === "CONFIRMED";
    const updated = await prisma.vacancy.update({
      where: { id: vacancy.id },
      data: { title, ...(resetConfirmed ? { status: "DRAFT" } : {}) },
    });

    if (resetConfirmed) {
      await prisma.companyProfile.updateMany({
        where: { vacancyId: vacancy.id },
        data: { confirmedAt: null },
      });
    }

    res.status(200).json({
      vacancy: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        createdAt: updated.createdAt,
      },
    });
  });

  router.delete("/vacancies/:id", async (req: Request, res: Response) => {
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

    const interviewCount = await prisma.interview.count({ where: { vacancyId: vacancy.id } });
    if (interviewCount > 0) {
      res.status(409).json({
        error: "Cannot delete vacancy with linked interviews",
        interviewCount,
      });
      return;
    }

    await prisma.vacancy.delete({ where: { id: vacancy.id } });
    res.status(200).json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Register router in `server.ts`**

Add import and route (after interviews line):

```ts
import { createVacanciesRouter } from "./routes/vacancies";
// ...
app.use("/api", requireAuth, requireHr, createVacanciesRouter(() => prisma));
```

- [ ] **Step 5: Run tests**

Run: `node --import tsx --test src/routes/vacancies.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Add to package.json test script and commit**

```bash
git add backend/src/routes/vacancies.ts backend/src/routes/vacancies.test.ts backend/src/server.ts backend/package.json
git commit -m "feat: add vacancies CRUD API"
```

---

### Task 4: Refactor prep router — `interviewId` → `vacancyId`

**Files:**
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/prep.test.ts`

- [ ] **Step 1: Mechanical rename in `prep.ts`**

For every handler:
1. Rename route param `:interviewId` → `:vacancyId`.
2. Replace `prisma.interview.findUnique` auth check with:

```ts
const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
if (!vacancy) { res.status(404).json({ error: "Vacancy not found" }); return; }
if (vacancy.hrUserId !== req.user?.id) { res.status(403).json({ error: "Forbidden" }); return; }
```

3. Replace all `where: { interviewId }` on `prepSessionHr` / `companyProfile` with `where: { vacancyId }`.
4. Replace `create: { interviewId }` with `create: { vacancyId }`.
5. In **confirm** handler, replace interview status update with:

```ts
await prisma.vacancy.update({
  where: { id: vacancyId },
  data: { status: "CONFIRMED" },
});
```

6. Change confirm response field `interviewStatus` → `vacancyStatus` (value `"CONFIRMED"`).
7. Update 404 error strings: `"Interview not found"` → `"Vacancy not found"`.

- [ ] **Step 2: Update confirm test expectation in `prep.test.ts`**

Find test `"POST /prep/:interviewId/confirm sets confirmedAt and moves interview to AWAITING_CANDIDATE"`.

Rename to use `vacancyId` paths and replace assertions:

```ts
test("POST /prep/:vacancyId/confirm sets confirmedAt and moves vacancy to CONFIRMED", async () => {
  // fake seed uses vacancies instead of interviews for auth
  // ...
  assert.equal(body.vacancyStatus, "CONFIRMED");
});
```

Update `makeFakePrisma` in `prep.test.ts`:
- Add `FakeVacancy` type and `vacancies` array.
- Add `vacancy.findUnique` mirroring old `interview.findUnique`.
- Add `vacancy.update` for confirm.
- Rename `interviewId` → `vacancyId` in `FakeSession`, `FakeProfile`, and all fake methods.
- Replace all fetch URLs `/api/prep/interview_1` → `/api/prep/vacancy_1` (and seed data ids accordingly).

Run global replace in `prep.test.ts`:
- `interviewId` → `vacancyId` (types, fields, URLs)
- `interview_1` → `vacancy_1` (test ids)
- Remove `interview.update` expectations from confirm test; assert `vacancy.update` called instead.

- [ ] **Step 3: Run prep tests**

Run: `node --import tsx --test src/routes/prep.test.ts`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "refactor: move HR prep flow from interviewId to vacancyId"
```

---

### Task 5: Update interviews router — require `vacancyId`, extend list

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`

- [ ] **Step 1: Write failing tests**

Add/replace in `interviews.test.ts`:

```ts
type FakeVacancy = { id: string; hrUserId: string; title: string; status: string };
type FakeInterview = {
  id: string;
  hrUserId: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: Date;
};

function makeFakePrisma(
  interviews: FakeInterview[] = [],
  vacancies: FakeVacancy[] = [],
  createImpl?: CreateImpl
) {
  // interview.findMany — include vacancy join simulation:
  // map interviews adding vacancyTitle from vacancies array
  // vacancy.findUnique for POST validation
  // ...
}

test("POST /interviews requires vacancyId and CONFIRMED vacancy", async () => {
  const fakePrisma = makeFakePrisma([], [
    { id: "v1", hrUserId: "hr_1", title: "Dev", status: "DRAFT" },
  ]);
  // POST { vacancyId: "v1" } → 400 { error: "Vacancy is not confirmed" }
});

test("POST /interviews creates AWAITING_CANDIDATE with displayName from vacancy title", async () => {
  const fakePrisma = makeFakePrisma([], [
    { id: "v1", hrUserId: "hr_1", title: "Frontend Dev", status: "CONFIRMED" },
  ]);
  // POST { vacancyId: "v1" } → 201, displayName === "Frontend Dev", status === "AWAITING_CANDIDATE"
});

test("GET /interviews/mine returns extended fields", async () => {
  // assert keys include vacancyId, vacancyTitle, displayName, reportSummary
});
```

Remove old test `"POST /interviews creates a DRAFT interview"`.

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `node --import tsx --test src/routes/interviews.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Update `interviews.ts`**

```ts
type CreateBody = { vacancyId?: unknown };

router.get("/interviews/mine", async (req, res) => {
  const interviews = await prisma.interview.findMany({
    where: { hrUserId: req.user?.id },
    orderBy: { createdAt: "desc" },
    include: { vacancy: { select: { title: true } } },
  });
  res.status(200).json({
    interviews: interviews.map((item) => ({
      id: item.id,
      vacancyId: item.vacancyId,
      vacancyTitle: item.vacancy.title,
      displayName: item.displayName,
      joinCode: item.joinCode,
      status: item.status,
      createdAt: item.createdAt,
      reportSummary: null,
    })),
  });
});

router.post("/interviews", async (req, res) => {
  const body = (req.body ?? {}) as CreateBody;
  const vacancyId = typeof body.vacancyId === "string" ? body.vacancyId : "";
  if (!vacancyId) {
    res.status(400).json({ error: "vacancyId is required" });
    return;
  }

  const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
  if (!vacancy) {
    res.status(404).json({ error: "Vacancy not found" });
    return;
  }
  if (vacancy.hrUserId !== req.user?.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (vacancy.status !== "CONFIRMED") {
    res.status(400).json({ error: "Vacancy is not confirmed" });
    return;
  }

  // existing join code retry loop, but create with:
  // { hrUserId, vacancyId, displayName: vacancy.title, joinCode, status: "AWAITING_CANDIDATE" }
});
```

- [ ] **Step 4: Run all interview tests**

Run: `node --import tsx --test src/routes/interviews.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full backend suite**

Run (from `backend/`): `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts
git commit -m "feat: interviews require confirmed vacancyId"
```

---

### Task 6: Frontend API clients

**Files:**
- Create: `frontend/src/api/vacancies.ts`
- Modify: `frontend/src/api/prep.ts`
- Modify: `frontend/src/api/interviews.ts`

- [ ] **Step 1: Create `vacancies.ts`**

```ts
import { fetchWithAuth } from "./client";

export type VacancySummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch { /* ignore */ }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchMyVacancies(): Promise<VacancySummary[]> {
  const response = await fetchWithAuth("/api/vacancies/mine");
  if (!response.ok) throw await parseError(response, "Не вдалося завантажити список анкет");
  const body = (await response.json()) as { vacancies: VacancySummary[] };
  return body.vacancies;
}

export async function createVacancy(title: string): Promise<VacancySummary> {
  const response = await fetchWithAuth("/api/vacancies", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw await parseError(response, "Не вдалося створити анкету");
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}

export async function updateVacancyTitle(id: string, title: string): Promise<VacancySummary> {
  const response = await fetchWithAuth(`/api/vacancies/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw await parseError(response, "Не вдалося оновити анкету");
  const body = (await response.json()) as { vacancy: VacancySummary };
  return body.vacancy;
}

export async function deleteVacancy(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/vacancies/${id}`, { method: "DELETE" });
  if (!response.ok) throw await parseError(response, "Не вдалося видалити анкету");
}
```

- [ ] **Step 2: Update `prep.ts`**

Rename all `interviewId` params to `vacancyId` in function signatures and URLs.
Change `confirmPrepProfile` return type:

```ts
export async function confirmPrepProfile(
  vacancyId: string
): Promise<{ profile: CompanyProfile; vacancyStatus: string }> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}/confirm`, { method: "POST" });
  // ...
}
```

- [ ] **Step 3: Update `interviews.ts`**

```ts
export type InterviewSummary = {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: string;
  reportSummary: string | null;
};

export type CreatedInterview = {
  id: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: string;
};

export async function createInterview(vacancyId: string): Promise<CreatedInterview> {
  const response = await fetchWithAuth("/api/interviews", {
    method: "POST",
    body: JSON.stringify({ vacancyId }),
  });
  // ...
}
```

- [ ] **Step 4: Verify types**

Run (from `frontend/`): `npx vue-tsc --noEmit -p tsconfig.app.json`
Expected: errors in views still referencing old APIs (fixed in next tasks).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/vacancies.ts frontend/src/api/prep.ts frontend/src/api/interviews.ts
git commit -m "feat: add vacancy API client and update prep/interview types"
```

---

### Task 7: HR layout and router

**Files:**
- Create: `frontend/src/layouts/HrLayout.vue`
- Create: `frontend/src/components/HrSidebar.vue`
- Modify: `frontend/src/router/index.ts`
- Delete or stop using: `frontend/src/views/HomeView.vue`, `frontend/src/views/CompanyPrepView.vue` (after migration)

- [ ] **Step 1: Create `HrSidebar.vue`**

```vue
<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();

function isActive(prefix: string): boolean {
  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}
</script>

<template>
  <nav class="sidebar" aria-label="HR navigation">
    <RouterLink to="/vacancies" class="nav-item" :class="{ active: isActive('/vacancies') }" title="Профіль вакансії">
      <span class="icon" aria-hidden="true">📋</span>
      <span class="label">Анкети</span>
    </RouterLink>
    <RouterLink to="/interviews" class="nav-item" :class="{ active: isActive('/interviews') }" title="Список співбесід">
      <span class="icon" aria-hidden="true">🎤</span>
      <span class="label">Співбесіди</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid #e5e7eb;
  min-width: 5rem;
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem;
  border-radius: 0.375rem;
  text-decoration: none;
  color: #374151;
  font-size: 0.75rem;
}
.nav-item.active { background: #dbeafe; color: #1d4ed8; }
.icon { font-size: 1.25rem; }
</style>
```

- [ ] **Step 2: Create `HrLayout.vue`**

Move header/user-bar/logout from `HomeView.vue`. Structure:

```vue
<script setup lang="ts">
import { useRouter } from "vue-router";
import HrSidebar from "../components/HrSidebar.vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

function logout(): void {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="hr-shell">
    <header class="header">
      <div>
        <h1>Interview Platform</h1>
        <p class="subtitle">HR — кабінет</p>
      </div>
      <div class="user-bar">
        <span>{{ auth.user?.email }}</span>
        <button type="button" @click="logout">Вийти</button>
      </div>
    </header>
    <div class="body">
      <HrSidebar />
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
```

Add scoped styles: flex column shell, `.body { display: flex; flex: 1; }`, `.content { flex: 1; padding: 1.5rem; max-width: 56rem; }`.

- [ ] **Step 3: Update `router/index.ts`**

```ts
import HrLayout from "../layouts/HrLayout.vue";
import HrHomeView from "../views/HrHomeView.vue";
import VacancyListView from "../views/VacancyListView.vue";
import VacancyDetailView from "../views/VacancyDetailView.vue";
import VacancyPrepView from "../views/VacancyPrepView.vue";
import InterviewListView from "../views/InterviewListView.vue";
import InterviewDetailView from "../views/InterviewDetailView.vue";

// Replace authenticated routes with nested layout:
{
  path: "/",
  component: HrLayout,
  meta: { requiresAuth: true },
  children: [
    { path: "", name: "home", component: HrHomeView },
    { path: "vacancies", name: "vacancies", component: VacancyListView },
    { path: "vacancies/:id", name: "vacancy-detail", component: VacancyDetailView },
    { path: "vacancies/:id/prep", name: "vacancy-prep", component: VacancyPrepView },
    { path: "interviews", name: "interviews", component: InterviewListView },
    { path: "interviews/:id", name: "interview-detail", component: InterviewDetailView },
  ],
},
// Remove old /prep/:interviewId route
// Optional redirect for bookmarks:
{ path: "/prep/:interviewId", redirect: "/vacancies" },
```

- [ ] **Step 4: Commit layout shell (stub views as empty placeholders if needed for tsc)**

```bash
git add frontend/src/layouts/ frontend/src/components/HrSidebar.vue frontend/src/router/index.ts
git commit -m "feat: add HrLayout with global sidebar navigation"
```

---

### Task 8: HR home view + create modals

**Files:**
- Create: `frontend/src/views/HrHomeView.vue`
- Create: `frontend/src/components/CreateVacancyModal.vue`
- Create: `frontend/src/components/CreateInterviewModal.vue`

- [ ] **Step 1: Create `CreateVacancyModal.vue`**

Props: `open: boolean`, emit `close`, emit `created(vacancyId: string)`.
Form: single required input «Назва вакансії» (min 2 chars), submit calls `createVacancy(title)`.

- [ ] **Step 2: Create `CreateInterviewModal.vue`**

On open, `fetchMyVacancies()` and filter `status === "CONFIRMED"`.
If empty — show message «Спочатку створіть і підтвердіть анкету».
Else dropdown + submit calls `createInterview(vacancyId)`, emit `created(interview)`.

- [ ] **Step 3: Create `HrHomeView.vue`**

On mount: parallel `fetchMyVacancies()` + `fetchMyInterviews()`.

Overview cards:
- `vacancies.length` — «Анкет»
- `interviews.length` — «Співбесід»
- `interviews.filter(i => i.status === "AWAITING_CANDIDATE").length` — «Очікують кандидата»

Recent activity: merge vacancies + interviews by `createdAt`, take top 3, show title/displayName + type label.

Buttons open modals. On vacancy created → `router.push({ name: "vacancy-prep", params: { id } })`.
On interview created → show green banner with join code (reuse styles from old `HomeView.vue`).

- [ ] **Step 4: Verify types**

Run: `npx vue-tsc --noEmit -p tsconfig.app.json`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/HrHomeView.vue frontend/src/components/CreateVacancyModal.vue frontend/src/components/CreateInterviewModal.vue
git commit -m "feat: add HR home overview and create modals"
```

---

### Task 9: Vacancy list, detail, and prep views

**Files:**
- Create: `frontend/src/views/VacancyListView.vue`
- Create: `frontend/src/views/VacancyDetailView.vue`
- Create: `frontend/src/views/VacancyPrepView.vue`
- Delete: `frontend/src/views/CompanyPrepView.vue` (after copy)
- Delete: `frontend/src/views/HomeView.vue` (replaced)

- [ ] **Step 1: Create `VacancyListView.vue`**

Table columns: Назва | Дата | Статус | Дії.

Status labels: `DRAFT` → «Чернетка», `CONFIRMED` → «Підтверджена».

Actions per row:
- `DRAFT` → «Пройти анкету» → `/vacancies/:id/prep`
- `CONFIRMED` → «Переглянути» → `/vacancies/:id`
- All → «Редагувати назву» (prompt or inline) → `updateVacancyTitle`
- All → «Видалити» → `deleteVacancy` with confirm dialog; show backend error for 409

- [ ] **Step 2: Copy `CompanyPrepView.vue` → `VacancyPrepView.vue`**

Changes:
- `route.params.interviewId` → `route.params.id` (or `vacancyId` computed)
- All prep API calls use `vacancyId`
- Header: «Анкета: {{ title }}» — load title from `GET /vacancies/:id` or pass via query
- `goHome()` → `router.push({ name: "vacancies" })`
- Remove reference to `interviewStatus` after confirm; optionally show «Анкета підтверджена»

- [ ] **Step 3: Create `VacancyDetailView.vue`**

Load `GET /vacancies/:id`, render profile sections (same `<dl>` as prep profile view).
If `status === DRAFT` and no profile — link to prep.
Button «Редагувати анкету» → prep route.

- [ ] **Step 4: Remove obsolete views**

Delete `frontend/src/views/HomeView.vue` and `frontend/src/views/CompanyPrepView.vue`.

- [ ] **Step 5: Manual check prep flow**

1. Create vacancy → prep chat → finish → confirm.
2. Vacancy list shows «Підтверджена».

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/VacancyListView.vue frontend/src/views/VacancyDetailView.vue frontend/src/views/VacancyPrepView.vue
git rm frontend/src/views/HomeView.vue frontend/src/views/CompanyPrepView.vue
git commit -m "feat: add vacancy list, detail, and prep views"
```

---

### Task 10: Interview list and detail stub

**Files:**
- Create: `frontend/src/views/InterviewListView.vue`
- Create: `frontend/src/views/InterviewDetailView.vue`

- [ ] **Step 1: Create `InterviewListView.vue`**

Table: Назва (`displayName`) | Код | Дата | Статус | Звіт.

Status labels (reuse from old HomeView): `AWAITING_CANDIDATE` → «Очікує кандидата», etc.
Report column: show `—` when `reportSummary` is null.
Row click or «Відкрити» → `/interviews/:id` (disabled-looking button with tooltip «Скоро з'явиться» except navigation to stub).

- [ ] **Step 2: Create `InterviewDetailView.vue`**

Minimal stub:

```vue
<template>
  <main>
    <h1>{{ displayName }}</h1>
    <p>Код: <strong>{{ joinCode }}</strong></p>
    <p class="muted">Жива кімната співбесіди з'явиться пізніше.</p>
    <RouterLink to="/interviews">← До списку</RouterLink>
  </main>
</template>
```

Load interview from list cache or `GET` via extended endpoint (optional: add `GET /interviews/:id` in same task if list navigation needs detail — otherwise pass state via router state on click).

For MVP: add minimal `GET /api/interviews/:id` returning `{ id, displayName, joinCode, status, vacancyTitle }` with ownership check.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/InterviewListView.vue frontend/src/views/InterviewDetailView.vue
git commit -m "feat: add interview list and detail stub view"
```

---

### Task 11: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add section after Day 9**

Document:
- New domain split (Vacancy vs Interview)
- Updated API endpoints table
- HR navigation (sidebar, home overview)
- Full manual test scenario from spec (6 steps)
- Note: `/prep/:interviewId` deprecated → `/vacancies/:id/prep`

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document vacancy/interview split and new HR cabinet"
```

---

### Task 12: End-to-end verification

**Files:** none

- [ ] **Step 1: Full workspace build**

Run (from repo root): `npm run build`
Expected: PASS.

- [ ] **Step 2: Full backend test suite**

Run (from `backend/`): `npm test`
Expected: all PASS.

- [ ] **Step 3: Reseed and manual scenario**

```bash
npm --workspace backend run db:seed
npm run dev
```

Manual checklist:
1. Login `hr@test.com` / `123456` → overview cards visible, sidebar works.
2. Create vacancy → prep → confirm → status «Підтверджена» in `/vacancies`.
3. Create interview from home → pick confirmed vacancy → code banner → row in `/interviews`.
4. Sidebar toggles `/vacancies` ↔ `/interviews`.
5. Delete vacancy with linked interview → error message.
6. Edit confirmed vacancy title → status back to «Чернетка», re-confirm works.

No commit for this task.

---

## Out of scope

- Live interview room (`InterviewDetailView` stub only)
- `reportSummary` content (column shows `—`)
- Candidate join-by-code and auto `displayName` update (Day 10+)
- Pagination, filters, archiving
- Editing interviews after creation

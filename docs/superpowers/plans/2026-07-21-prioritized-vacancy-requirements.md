# Prioritized Vacancy Requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дозволити HR задавати критичні та бажані вимоги вакансії й рахувати match score детермінованою формулою з поясненням для HR.

**Architecture:** `requirements` стає `{ critical, desired }`. LLM оцінює кожну вимогу як `met|unknown|unmet` і дає `contextFit`; бекенд рахує відсоток (75/25 requirements + 80/20 context, cap 69 на `critical:unmet`). Кеш match score версіонується за `confirmedAt` кандидата й вакансії; breakdown копіюється у заявку як snapshot і показується лише HR.

**Tech Stack:** TypeScript, Express, Prisma, Vue 3, node:test, vue-tsc

## Global Constraints

- User-facing тексти — українською.
- Назви категорій у UI: **«Критичні вимоги»** / **«Бажані вимоги»**.
- Cap при `critical: unmet` — **69**.
- `unknown` знижує score, але **не** вмикає cap.
- Breakdown **ніколи** не повертається candidate API.
- Legacy `requirements: string[]` → `{ critical: [], desired: legacy }`.
- Spec: `docs/superpowers/specs/2026-07-21-prioritized-vacancy-requirements-design.md`.
- Поза межами: числові ваги HR, >2 рівнів, hard exclude з видачі, breakdown кандидату, словниковий matcher без LLM.

---

## File Structure

- **Create**
  - `backend/src/utils/vacancy-requirements.ts` — normalize/parse `VacancyRequirements`
  - `backend/src/utils/vacancy-requirements.test.ts`
  - `backend/src/services/match-score.ts` — чиста формула score + breakdown shape
  - `backend/src/services/match-score.test.ts`
  - `backend/prisma/migrations/20260721100000_prioritized_vacancy_requirements/migration.sql`
- **Modify**
  - `backend/prisma/schema.prisma` — `VacancyMatchScore`, `VacancyApplication`
  - `backend/src/agents/prompts/company-agent.uk.ts` — збір critical/desired
  - `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts` — structured requirements
  - `backend/src/agents/company-agent.ts` — parse structured requirements
  - `backend/src/agents/company-agent.test.ts`
  - `backend/src/agents/prompts/vacancy-match.uk.ts` — assessment prompt
  - `backend/src/agents/vacancy-match-agent.ts` — assessment parser + messages
  - `backend/src/agents/vacancy-match-agent.test.ts`
  - `backend/src/services/vacancy-match.ts` — partial cache, formula, breakdown
  - `backend/src/services/vacancy-match.test.ts`
  - `backend/src/routes/prep.ts` — serialize/patch/confirm
  - `backend/src/routes/prep.test.ts`
  - `backend/src/routes/candidate-matches.ts` — snapshot `matchBreakdown` on accept
  - `backend/src/routes/candidate-matches.test.ts`
  - `backend/src/routes/hr-applications.ts` — return breakdown on detail
  - `backend/src/routes/hr-applications.test.ts`
  - `frontend/src/api/prep.ts` — `VacancyRequirements` type
  - `frontend/src/api/hr-applications.ts` — breakdown types
  - `frontend/src/views/VacancyPrepView.vue` — два списки
  - `frontend/src/views/VacancyDetailView.vue` — два списки
  - `frontend/src/views/HrApplicationsView.vue` — breakdown UI
  - `README.md` — секція match / vacancy prep

---

### Task 1: Normalize `VacancyRequirements`

**Files:**
- Create: `backend/src/utils/vacancy-requirements.ts`
- Create: `backend/src/utils/vacancy-requirements.test.ts`
- Modify: `backend/package.json` — додати тест у `scripts.test`

**Interfaces:**
- Produces:
  - `type VacancyRequirements = { critical: string[]; desired: string[] }`
  - `normalizeVacancyRequirements(raw: unknown): VacancyRequirements | null`
  - `assertNonEmptyRequirements(req: VacancyRequirements): boolean`

- [ ] **Step 1: Write failing tests**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVacancyRequirements,
  assertNonEmptyRequirements,
} from "./vacancy-requirements";

test("normalizeVacancyRequirements maps legacy string[] to desired", () => {
  assert.deepEqual(normalizeVacancyRequirements(["Node.js", "TypeScript"]), {
    critical: [],
    desired: ["Node.js", "TypeScript"],
  });
});

test("normalizeVacancyRequirements accepts structured object", () => {
  assert.deepEqual(
    normalizeVacancyRequirements({
      critical: ["  Node.js  ", "TypeScript"],
      desired: ["Docker", "node.js"],
    }),
    { critical: ["Node.js", "TypeScript"], desired: ["Docker"] },
  );
});

test("normalizeVacancyRequirements prefers critical on case-insensitive overlap", () => {
  assert.deepEqual(
    normalizeVacancyRequirements({
      critical: ["React"],
      desired: ["react", "GraphQL"],
    }),
    { critical: ["React"], desired: ["GraphQL"] },
  );
});

test("normalizeVacancyRequirements drops empty strings and rejects invalid shapes", () => {
  assert.deepEqual(normalizeVacancyRequirements({ critical: [""], desired: ["SQL"] }), {
    critical: [],
    desired: ["SQL"],
  });
  assert.equal(normalizeVacancyRequirements(null), null);
  assert.equal(normalizeVacancyRequirements({ critical: "x" }), null);
});

test("assertNonEmptyRequirements requires at least one item", () => {
  assert.equal(assertNonEmptyRequirements({ critical: [], desired: [] }), false);
  assert.equal(assertNonEmptyRequirements({ critical: ["A"], desired: [] }), true);
  assert.equal(assertNonEmptyRequirements({ critical: [], desired: ["B"] }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/utils/vacancy-requirements.test.ts`

Expected: FAIL — module not found / cannot resolve

- [ ] **Step 3: Implement util**

```typescript
export type VacancyRequirements = {
  critical: string[];
  desired: string[];
};

function cleanList(items: unknown): string[] | null {
  if (!Array.isArray(items)) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function normalizeVacancyRequirements(raw: unknown): VacancyRequirements | null {
  if (Array.isArray(raw)) {
    const desired = cleanList(raw);
    if (!desired) return null;
    return { critical: [], desired };
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { critical, desired } = raw as Record<string, unknown>;
  const criticalList = cleanList(critical ?? []);
  const desiredList = cleanList(desired ?? []);
  if (!criticalList || !desiredList) return null;

  const criticalKeys = new Set(criticalList.map((item) => item.toLowerCase()));
  return {
    critical: criticalList,
    desired: desiredList.filter((item) => !criticalKeys.has(item.toLowerCase())),
  };
}

export function assertNonEmptyRequirements(req: VacancyRequirements): boolean {
  return req.critical.length > 0 || req.desired.length > 0;
}
```

Add `src/utils/vacancy-requirements.test.ts` to `backend/package.json` `scripts.test` (after `vacancy-work-conditions.test.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/utils/vacancy-requirements.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/vacancy-requirements.ts backend/src/utils/vacancy-requirements.test.ts backend/package.json
git commit -m "feat: add vacancy requirements normalizer"
```

---

### Task 2: Prisma schema — breakdown + vacancy version

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260721100000_prioritized_vacancy_requirements/migration.sql`

**Interfaces:**
- Produces schema fields:
  - `VacancyMatchScore.breakdown Json`
  - `VacancyMatchScore.rankedForVacancyConfirmedAt DateTime`
  - unique: `[candidateUserId, vacancyId, rankedForConfirmedAt, rankedForVacancyConfirmedAt]`
  - `VacancyApplication.matchBreakdown Json`

- [ ] **Step 1: Update Prisma models**

In `VacancyMatchScore`:

```prisma
model VacancyMatchScore {
  id                          String   @id @default(cuid())
  candidateUserId             String
  vacancyId                   String
  matchScore                  Int
  breakdown                   Json     @default("{}")
  rankedForConfirmedAt        DateTime
  rankedForVacancyConfirmedAt DateTime
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  candidateUser User    @relation("CandidateVacancyMatchScores", fields: [candidateUserId], references: [id])
  vacancy       Vacancy @relation(fields: [vacancyId], references: [id])

  @@unique([candidateUserId, vacancyId, rankedForConfirmedAt, rankedForVacancyConfirmedAt])
  @@index([candidateUserId, rankedForConfirmedAt])
}
```

In `VacancyApplication` add:

```prisma
  matchBreakdown Json @default("{}")
```

- [ ] **Step 2: Write migration SQL**

`backend/prisma/migrations/20260721100000_prioritized_vacancy_requirements/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "VacancyMatchScore" ADD COLUMN "breakdown" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "VacancyMatchScore" ADD COLUMN "rankedForVacancyConfirmedAt" TIMESTAMP(3);

-- Backfill from confirmed company profiles; fallback to rankedForConfirmedAt
UPDATE "VacancyMatchScore" AS vms
SET "rankedForVacancyConfirmedAt" = COALESCE(cp."confirmedAt", vms."rankedForConfirmedAt")
FROM "Vacancy" v
LEFT JOIN "CompanyProfile" cp ON cp."vacancyId" = v.id
WHERE v.id = vms."vacancyId";

ALTER TABLE "VacancyMatchScore" ALTER COLUMN "rankedForVacancyConfirmedAt" SET NOT NULL;

-- DropIndex / unique
DROP INDEX IF EXISTS "VacancyMatchScore_candidateUserId_vacancyId_rankedForConfirmedAt_key";
CREATE UNIQUE INDEX "VacancyMatchScore_candidateUserId_vacancyId_rankedForConfirmedAt_rankedForVacancyConfirmedAt_key"
  ON "VacancyMatchScore"("candidateUserId", "vacancyId", "rankedForConfirmedAt", "rankedForVacancyConfirmedAt");

-- AlterTable applications
ALTER TABLE "VacancyApplication" ADD COLUMN "matchBreakdown" JSONB NOT NULL DEFAULT '{}';
```

(If local unique index name differs, check with `\d "VacancyMatchScore"` / Prisma migration history and adjust DROP INDEX name.)

- [ ] **Step 3: Generate client**

Run: `cd backend && npx prisma generate`

Expected: client regenerates without errors

- [ ] **Step 4: Apply migration (dev DB)**

Run: `cd backend && npx prisma migrate deploy`

Expected: migration applied

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260721100000_prioritized_vacancy_requirements
git commit -m "feat(db): store match breakdown and vacancy score version"
```

---

### Task 3: Company Agent — збір і extraction structured requirements

**Files:**
- Modify: `backend/src/agents/prompts/company-agent.uk.ts`
- Modify: `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts`
- Modify: `backend/src/agents/company-agent.ts`
- Modify: `backend/src/agents/company-agent.test.ts`

**Interfaces:**
- Consumes: `normalizeVacancyRequirements`, `assertNonEmptyRequirements`
- Produces: `ExtractedVacancyProfile.requirements: VacancyRequirements`

- [ ] **Step 1: Write failing extraction tests**

Replace/extend requirements assertions in `company-agent.test.ts`:

```typescript
test("parseVacancyProfileExtraction parses structured critical/desired requirements", () => {
  const raw = JSON.stringify({
    role: "Backend Developer",
    requirements: { critical: ["Node.js"], desired: ["Docker"] },
    expectations: ["Ownership"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: не вказано",
      "Релокація: не вказано",
      "Випробувальний: не вказано",
      "Обладнання: не вказано",
    ],
    compensation: { displayText: "не вказано" },
  });
  const result = parseVacancyProfileExtraction(raw);
  assert.deepEqual(result.requirements, {
    critical: ["Node.js"],
    desired: ["Docker"],
  });
});

test("parseVacancyProfileExtraction rejects empty critical and desired", () => {
  const raw = JSON.stringify({
    role: "Backend Developer",
    requirements: { critical: [], desired: [] },
    expectations: ["Ownership"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: не вказано",
      "Релокація: не вказано",
      "Випробувальний: не вказано",
      "Обладнання: не вказано",
    ],
    compensation: { displayText: "не вказано" },
  });
  assert.throws(() => parseVacancyProfileExtraction(raw));
});
```

Update existing tests that pass `requirements: ["Node.js"]` — extraction should still accept legacy arrays via normalizer **або** fail if prompt only allows object; prefer accepting both through `normalizeVacancyRequirements`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/agents/company-agent.test.ts`

Expected: FAIL on structured requirements shape

- [ ] **Step 3: Update prompts + parser**

In `company-agent.uk.ts` тему 2 замінити на:

```
2. Вимоги — двома окремими кроками:
   a) Критичні вимоги (без них кандидат не вважається повністю відповідним).
   b) Бажані вимоги (підсилюють fit, але не блокують).
   Не підвищуй і не знижуй пріоритет самостійно, якщо HR назвав категорію явно.
```

У READY умові: по темі вимог мають бути конкретні критичні та/або бажані пункти (допускається явна відповідь «критичних немає» + непорожній desired, або навпаки).

In `vacancy-profile-extraction.uk.ts` змінити JSON-приклад і правила:

```
{"role":"...","requirements":{"critical":["..."],"desired":["..."]},"expectations":[...],...}

- "requirements.critical" / "requirements.desired" — масиви коротких рядків українською.
- Хоча б один з двох масивів має містити щонайменше один пункт.
- Не вигадуй пріоритет: якщо HR явно назвав категорію — дотримуйся її.
```

In `company-agent.ts`:

```typescript
import {
  assertNonEmptyRequirements,
  normalizeVacancyRequirements,
  type VacancyRequirements,
} from "../utils/vacancy-requirements";

export interface ExtractedVacancyProfile {
  role: string;
  requirements: VacancyRequirements;
  expectations: string[];
  workConditions: string[];
  compensation: VacancyCompensation;
}

// inside parseVacancyProfileExtraction:
const requirements = normalizeVacancyRequirements(
  (data as Record<string, unknown>).requirements,
);
if (!requirements || !assertNonEmptyRequirements(requirements)) {
  throw new ProfileExtractionError("missing or invalid field: requirements");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/agents/company-agent.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/company-agent.uk.ts backend/src/agents/prompts/vacancy-profile-extraction.uk.ts backend/src/agents/company-agent.ts backend/src/agents/company-agent.test.ts
git commit -m "feat(prep): extract critical and desired vacancy requirements"
```

---

### Task 4: Prep routes — serialize / PATCH / confirm

**Files:**
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/prep.test.ts`

**Interfaces:**
- Consumes: `normalizeVacancyRequirements`, `assertNonEmptyRequirements`
- Produces: API `profile.requirements: { critical, desired }`

- [ ] **Step 1: Write failing route tests**

Update the existing PATCH assertion that expects `requirements: ["5+ років"]` to expect:

```typescript
assert.deepEqual(body.profile.requirements, {
  critical: [],
  desired: ["5+ років"],
});
```

when the stored value is still a legacy array **or** when PATCH sends structured object — prefer sending structured object in that test:

```typescript
body: JSON.stringify({
  role: "Senior QA Engineer",
  requirements: { critical: ["5+ років"], desired: ["Playwright"] },
  expectations: ["автономність"],
  culture: ["прозорість"],
  companyDirection: ["FinTech"],
  policies: ["remote-first"],
  workFormat: ["Remote"],
  onboardingApproach: ["Ментор 1 місяць"],
}),
// ...
assert.deepEqual(body.profile.requirements, {
  critical: ["5+ років"],
  desired: ["Playwright"],
});
```

Add these tests (same express + `makeFakePrisma` setup as nearby PATCH tests):

```typescript
test("GET /prep/:vacancyId serializes legacy requirements as desired", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["відкритість"],
        expectations: ["не вказано"],
        companyDirection: ["EdTech"],
        policies: ["гнучкий графік"],
        workFormat: ["Гібрид"],
        onboardingApproach: ["Buddy 2 тижні"],
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "unused"; } };
  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.profile.requirements, {
      critical: [],
      desired: ["3+ роки"],
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("PATCH /prep/:vacancyId/profile rejects empty critical and desired", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: { critical: ["Node.js"], desired: [] },
        culture: ["відкритість"],
        expectations: ["не вказано"],
        companyDirection: ["EdTech"],
        policies: ["гнучкий графік"],
        workFormat: ["Гібрид"],
        onboardingApproach: ["Buddy 2 тижні"],
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "unused"; } };
  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirements: { critical: [], desired: [] } }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /prep/:vacancyId/confirm rejects empty requirements", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1", status: "DRAFT" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "QA Engineer",
        requirements: { critical: [], desired: [] },
        culture: ["відкритість"],
        expectations: ["не вказано"],
        companyDirection: ["EdTech"],
        policies: ["гнучкий графік"],
        workFormat: ["Гібрид"],
        onboardingApproach: ["Buddy 2 тижні"],
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "unused"; } };
  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/confirm`, {
      method: "POST",
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/routes/prep.test.ts`

Expected: FAIL on structured requirements expectations

- [ ] **Step 3: Implement route changes**

In `serializeVacancyProfile`:

```typescript
import {
  assertNonEmptyRequirements,
  normalizeVacancyRequirements,
} from "../utils/vacancy-requirements";

function serializeVacancyProfile(profile: CompanyProfile) {
  const requirements =
    normalizeVacancyRequirements(profile.requirements) ?? { critical: [], desired: [] };
  return {
    role: profile.role,
    requirements,
    // ...unchanged fields
  };
}
```

In `parseProfilePatch`, замінити обробку `requirements` з `parseStringArray` на:

```typescript
if (hasField("requirements")) {
  const parsed = normalizeVacancyRequirements(body.requirements);
  if (!parsed || !assertNonEmptyRequirements(parsed)) {
    return { ok: false, error: "Invalid requirements" };
  }
  data.requirements = asInputJson(parsed);
}
```

На `POST .../confirm` перед update:

```typescript
const requirements = normalizeVacancyRequirements(profile.requirements);
if (!requirements || !assertNonEmptyRequirements(requirements)) {
  res.status(400).json({ error: "Invalid requirements" });
  return;
}
```

Upsert на finish уже зберігає `extracted.requirements` як object — переконайся `asInputJson(extracted.requirements)`.

Онови всі fixtures у `prep.test.ts`, де очікується `requirements: string[]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/routes/prep.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "feat(api): expose structured vacancy requirements in prep"
```

---

### Task 5: Frontend vacancy prep + detail

**Files:**
- Modify: `frontend/src/api/prep.ts`
- Modify: `frontend/src/views/VacancyPrepView.vue`
- Modify: `frontend/src/views/VacancyDetailView.vue`

**Interfaces:**
- Consumes API `requirements: { critical, desired }`
- Produces UI з двома списками

- [ ] **Step 1: Update API types**

```typescript
export type VacancyRequirements = {
  critical: string[];
  desired: string[];
};

export type CompanyProfile = {
  role: string;
  requirements: VacancyRequirements;
  // ...
};
```

- [ ] **Step 2: Update VacancyPrepView edit/read UI**

Замінити одне поле «Вимоги» на два:

```vue
<label class="field">
  <span class="field-label">Критичні вимоги</span>
  <textarea
    class="field-input"
    rows="3"
    :value="(editableProfile.requirements.critical ?? []).join('\n')"
    @input="onRequirementsInput('critical', $event)"
  />
</label>
<label class="field">
  <span class="field-label">Бажані вимоги</span>
  <textarea
    class="field-input"
    rows="3"
    :value="(editableProfile.requirements.desired ?? []).join('\n')"
    @input="onRequirementsInput('desired', $event)"
  />
</label>
```

Helpers:

```typescript
function onRequirementsInput(kind: "critical" | "desired", event: Event): void {
  if (!editableProfile.value) return;
  const lines = textToArray((event.target as HTMLTextAreaElement).value);
  editableProfile.value.requirements = {
    ...editableProfile.value.requirements,
    [kind]: lines,
  };
}
```

У read-only `dl` показати дві секції. У `syncEditableProfile` гарантувати shape:

```typescript
requirements: {
  critical: next.requirements?.critical ?? [],
  desired: next.requirements?.desired ?? [],
},
```

Прибрати `"requirements"` з `ArrayProfileField`, бо це більше не `string[]`.

- [ ] **Step 3: Update VacancyDetailView**

```vue
<dt>Критичні вимоги</dt>
<dd><ul><li v-for="(item, i) in vacancy.profile.requirements.critical" :key="'c'+i">{{ item }}</li></ul></dd>
<dt>Бажані вимоги</dt>
<dd><ul><li v-for="(item, i) in vacancy.profile.requirements.desired" :key="'d'+i">{{ item }}</li></ul></dd>
```

- [ ] **Step 4: Typecheck frontend**

Run: `cd frontend && npm run lint`

Expected: PASS (no type errors on requirements)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/prep.ts frontend/src/views/VacancyPrepView.vue frontend/src/views/VacancyDetailView.vue
git commit -m "feat(ui): edit critical and desired vacancy requirements"
```

---

### Task 6: Deterministic match score formula

**Files:**
- Create: `backend/src/services/match-score.ts`
- Create: `backend/src/services/match-score.test.ts`
- Modify: `backend/package.json` — додати тест у `scripts.test`

**Interfaces:**
- Produces:
  - `type RequirementStatus = "met" | "unknown" | "unmet"`
  - `type RequirementAssessment = { requirement: string; priority: "critical" | "desired"; status: RequirementStatus; evidence: string }`
  - `type MatchBreakdown = { assessments: RequirementAssessment[]; contextFit: number; criticalFit: number | null; desiredFit: number | null; requirementsFit: number | null; rawScore: number; cappedByCriticalUnmet: boolean; matchScore: number }`
  - `computeMatchScore(assessments, contextFit): MatchBreakdown`

- [ ] **Step 1: Write failing tests**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { computeMatchScore } from "./match-score";

test("computeMatchScore weights critical 75 and desired 25 then blends context 20", () => {
  const result = computeMatchScore(
    [
      { requirement: "A", priority: "critical", status: "met", evidence: "є" },
      { requirement: "B", priority: "critical", status: "met", evidence: "є" },
      { requirement: "C", priority: "critical", status: "unknown", evidence: "немає даних" },
      { requirement: "D", priority: "desired", status: "met", evidence: "є" },
      { requirement: "E", priority: "desired", status: "unmet", evidence: "немає" },
    ],
    80,
  );
  // criticalFit=83.333..., desiredFit=50, requirementsFit=75, raw≈76
  assert.equal(result.matchScore, 76);
  assert.equal(result.cappedByCriticalUnmet, false);
});

test("computeMatchScore caps at 69 when any critical is unmet", () => {
  const result = computeMatchScore(
    [
      { requirement: "Must", priority: "critical", status: "unmet", evidence: "немає" },
      { requirement: "Nice", priority: "desired", status: "met", evidence: "є" },
    ],
    100,
  );
  assert.ok(result.rawScore > 69);
  assert.equal(result.matchScore, 69);
  assert.equal(result.cappedByCriticalUnmet, true);
});

test("computeMatchScore unknown critical does not cap", () => {
  const result = computeMatchScore(
    [{ requirement: "Must", priority: "critical", status: "unknown", evidence: "немає даних" }],
    100,
  );
  assert.equal(result.cappedByCriticalUnmet, false);
  assert.equal(result.matchScore, 60); // requirementsFit=50 → 0.8*50+0.2*100=60
});

test("computeMatchScore uses only present category when other empty", () => {
  const result = computeMatchScore(
    [{ requirement: "Nice", priority: "desired", status: "met", evidence: "є" }],
    50,
  );
  assert.equal(result.requirementsFit, 100);
  assert.equal(result.matchScore, 90);
});

test("computeMatchScore with no requirements uses contextFit only", () => {
  const result = computeMatchScore([], 77);
  assert.equal(result.matchScore, 77);
  assert.equal(result.requirementsFit, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/services/match-score.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement formula**

```typescript
export type RequirementStatus = "met" | "unknown" | "unmet";

export type RequirementAssessment = {
  requirement: string;
  priority: "critical" | "desired";
  status: RequirementStatus;
  evidence: string;
};

export type MatchBreakdown = {
  assessments: RequirementAssessment[];
  contextFit: number;
  criticalFit: number | null;
  desiredFit: number | null;
  requirementsFit: number | null;
  rawScore: number;
  cappedByCriticalUnmet: boolean;
  matchScore: number;
};

const STATUS_POINTS: Record<RequirementStatus, number> = {
  met: 100,
  unknown: 50,
  unmet: 0,
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeMatchScore(
  assessments: RequirementAssessment[],
  contextFit: number,
): MatchBreakdown {
  const critical = assessments.filter((item) => item.priority === "critical");
  const desired = assessments.filter((item) => item.priority === "desired");
  const criticalFit = average(critical.map((item) => STATUS_POINTS[item.status]));
  const desiredFit = average(desired.map((item) => STATUS_POINTS[item.status]));

  let requirementsFit: number | null = null;
  if (criticalFit != null && desiredFit != null) {
    requirementsFit = 0.75 * criticalFit + 0.25 * desiredFit;
  } else if (criticalFit != null) {
    requirementsFit = criticalFit;
  } else if (desiredFit != null) {
    requirementsFit = desiredFit;
  }

  const rawScore =
    requirementsFit == null ? contextFit : 0.8 * requirementsFit + 0.2 * contextFit;
  const cappedByCriticalUnmet = critical.some((item) => item.status === "unmet");
  const matchScore = clampScore(cappedByCriticalUnmet ? Math.min(rawScore, 69) : rawScore);

  return {
    assessments,
    contextFit,
    criticalFit,
    desiredFit,
    requirementsFit,
    rawScore,
    cappedByCriticalUnmet,
    matchScore,
  };
}
```

Додати тест у `package.json` `scripts.test`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/services/match-score.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/match-score.ts backend/src/services/match-score.test.ts backend/package.json
git commit -m "feat: add deterministic prioritized match score formula"
```

---

### Task 7: Vacancy match agent — per-requirement assessments

**Files:**
- Modify: `backend/src/agents/prompts/vacancy-match.uk.ts`
- Modify: `backend/src/agents/vacancy-match-agent.ts`
- Modify: `backend/src/agents/vacancy-match-agent.test.ts`

**Interfaces:**
- Consumes: `VacancyRequirements`, `RequirementAssessment`
- Produces:
  - `parseVacancyMatchAssessments(raw, vacancies) → Array<{ vacancyId; assessments; contextFit }>`
  - `rankVacanciesWithLlm` повертає assessments (не готовий matchScore)
  - Keep `parseVacancyMatchScores` **або** замінити — у цьому плані **замінити** на assessment flow

- [ ] **Step 1: Write failing parser tests**

```typescript
test("parseVacancyMatchAssessments accepts full coverage and contextFit", () => {
  const raw = JSON.stringify({
    results: [
      {
        vacancyId: "v1",
        contextFit: 80,
        assessments: [
          {
            requirement: "Node.js",
            priority: "critical",
            status: "met",
            evidence: "Вказано Node.js у skills",
          },
          {
            requirement: "Docker",
            priority: "desired",
            status: "unknown",
            evidence: "Не згадується",
          },
        ],
      },
    ],
  });
  const parsed = parseVacancyMatchAssessments(raw, [
    {
      vacancyId: "v1",
      title: "BE",
      role: "BE",
      requirements: { critical: ["Node.js"], desired: ["Docker"] },
      culture: [],
      expectations: [],
    },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.contextFit, 80);
  assert.equal(parsed[0]?.assessments.length, 2);
});

test("parseVacancyMatchAssessments rejects missing requirement or invalid status", () => {
  assert.throws(() =>
    parseVacancyMatchAssessments(
      JSON.stringify({
        results: [
          {
            vacancyId: "v1",
            contextFit: 50,
            assessments: [
              {
                requirement: "Node.js",
                priority: "critical",
                status: "maybe",
                evidence: "x",
              },
            ],
          },
        ],
      }),
      [
        {
          vacancyId: "v1",
          title: "BE",
          role: "BE",
          requirements: { critical: ["Node.js"], desired: [] },
          culture: [],
          expectations: [],
        },
      ],
    ),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/agents/vacancy-match-agent.test.ts`

Expected: FAIL — `parseVacancyMatchAssessments` missing

- [ ] **Step 3: Update prompt + types + parser**

`VacancyMatchInput.requirements` → `VacancyRequirements`.

Новий system prompt (`VACANCY_MATCH_SYSTEM_PROMPT_UK`):

```
Ти HR-аналітик. Отримуєш профіль кандидата та вакансії з critical/desired вимогами.

Для КОЖНОЇ вимоги кожної вакансії поверни status:
- met — є достатній доказ у профілі
- unknown — даних недостатньо
- unmet — є явна невідповідність

Також оціни contextFit 0–100 (роль, досвід, цілі, очікування, культура) БЕЗ повторної оцінки окремих вимог.
evidence — коротке фактичне пояснення українською; не вигадуй фактів.

Поверни СТРОГО JSON:
{"results":[{"vacancyId":"...","contextFit":0,"assessments":[{"requirement":"...","priority":"critical","status":"met","evidence":"..."}]}]}

Правила:
- assessments має містити рівно всі critical+desired вимоги вакансії, без доданих
- priority має збігатися з вхідним списком
- status лише met|unknown|unmet
- evidence — непустий рядок
```

Реалізуй `parseVacancyMatchAssessments`: для кожної вакансії звір set вимог; дублікати / зайві / відсутні / bad status / empty evidence / non-finite contextFit → throw `VacancyMatchExtractionError`.

`rankVacanciesWithLlm` повертає assessment results; score рахує сервіс.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/agents/vacancy-match-agent.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/vacancy-match.uk.ts backend/src/agents/vacancy-match-agent.ts backend/src/agents/vacancy-match-agent.test.ts
git commit -m "feat(match): request per-requirement LLM assessments"
```

---

### Task 8: Match service — partial cache + formula

**Files:**
- Modify: `backend/src/services/vacancy-match.ts`
- Modify: `backend/src/services/vacancy-match.test.ts`

**Interfaces:**
- Consumes: `rankVacanciesWithLlm` assessments, `computeMatchScore`, `normalizeVacancyRequirements`
- Produces: offers з `matchScore`; internal breakdown stored in DB; partial re-rank

- [ ] **Step 1: Write failing service tests**

Оновити fixtures: `requirements: { critical: ["TS"], desired: [] }`, `confirmedAt` на companyProfile, matchScores з `breakdown` і `rankedForVacancyConfirmedAt`.

```typescript
test("ensureMatchScores ranks only vacancies missing current cache versions", async () => {
  const vacancyConfirmedAt = confirmedAt;
  let completeCalls = 0;
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      vacancies: [
        {
          id: "v1",
          title: "Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            requirements: { critical: ["Node.js"], desired: [] },
            culture: [],
            expectations: [],
            confirmedAt: vacancyConfirmedAt,
          },
        },
        {
          id: "v2",
          title: "Platform",
          status: "CONFIRMED",
          companyProfile: {
            role: "Platform",
            requirements: { critical: ["Go"], desired: ["K8s"] },
            culture: [],
            expectations: [],
            confirmedAt: vacancyConfirmedAt,
          },
        },
      ],
      matchScores: [
        {
          id: "s1",
          candidateUserId: "cd_1",
          vacancyId: "v1",
          matchScore: 90,
          breakdown: { matchScore: 90, cappedByCriticalUnmet: false },
          rankedForConfirmedAt: confirmedAt,
          rankedForVacancyConfirmedAt: vacancyConfirmedAt,
        },
      ],
    }),
  );
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async (messages) => {
      completeCalls += 1;
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      assert.match(user, /v2/);
      assert.doesNotMatch(user, /"vacancyId": "v1"/);
      return JSON.stringify({
        results: [
          {
            vacancyId: "v2",
            contextFit: 80,
            assessments: [
              {
                requirement: "Go",
                priority: "critical",
                status: "met",
                evidence: "Є Go у skills",
              },
              {
                requirement: "K8s",
                priority: "desired",
                status: "unknown",
                evidence: "Не згадується",
              },
            ],
          },
        ],
      });
    },
  };

  const offers = await ensureMatchScores(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.equal(completeCalls, 1);
  assert.equal(offers.length, 2);
  assert.ok(offers.some((item) => item.vacancyId === "v2"));
});

test("ensureMatchScores applies critical unmet cap via computeMatchScore", async () => {
  const vacancyConfirmedAt = confirmedAt;
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      vacancies: [
        {
          id: "v1",
          title: "Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            requirements: { critical: ["Rust"], desired: ["Docker"] },
            culture: [],
            expectations: [],
            confirmedAt: vacancyConfirmedAt,
          },
        },
      ],
    }),
  );
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () =>
      JSON.stringify({
        results: [
          {
            vacancyId: "v1",
            contextFit: 100,
            assessments: [
              {
                requirement: "Rust",
                priority: "critical",
                status: "unmet",
                evidence: "Немає Rust",
              },
              {
                requirement: "Docker",
                priority: "desired",
                status: "met",
                evidence: "Є Docker",
              },
            ],
          },
        ],
      }),
  };

  const offers = await ensureMatchScores(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.equal(offers[0]?.matchScore, 69);
  assert.equal(fakePrisma.__matchScores[0]?.breakdown.cappedByCriticalUnmet, true);
  assert.ok(fakePrisma.__matchScores[0]?.rankedForVacancyConfirmedAt);
});
```

Оновити `makeFakePrisma` / `createMany`, щоб зберігати `breakdown` і `rankedForVacancyConfirmedAt`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`

Expected: FAIL on partial cache / breakdown fields

- [ ] **Step 3: Implement service changes**

Ключові зміни в `ensureMatchScores`:

1. `listMatchableVacancies` нормалізує `requirements` через `normalizeVacancyRequirements` (skip vacancy якщо null/empty).
2. Читати всі cached rows для `candidateUserId` + `rankedForConfirmedAt = profile.confirmedAt`.
3. Для кожної vacancy з `companyProfile.confirmedAt`:
   - hit, якщо є row з тим самим `rankedForVacancyConfirmedAt`
   - інакше додати до `toRank`
4. Якщо `toRank.length === 0` — повернути offers з cached.
5. Інакше `rankVacanciesWithLlm(llm, profile, toRank)` → для кожного result `computeMatchScore` → `createMany` з `breakdown`, `rankedForVacancyConfirmedAt`.
6. Злити cached + new; `attachDisplaysToOffers`.

Розшир внутрішній тип offer (опційно) `breakdown?: MatchBreakdown` для accept route; **не** віддавай breakdown у candidate serializers.

Виправ fake prisma у тесті під нові поля.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/vacancy-match.ts backend/src/services/vacancy-match.test.ts
git commit -m "feat(match): score with priorities and partial vacancy cache"
```

---

### Task 9: Application snapshot + HR breakdown API

**Files:**
- Modify: `backend/src/routes/candidate-matches.ts`
- Modify: `backend/src/routes/candidate-matches.test.ts`
- Modify: `backend/src/routes/hr-applications.ts`
- Modify: `backend/src/routes/hr-applications.test.ts`

**Interfaces:**
- Produces:
  - accept створює `matchBreakdown` snapshot
  - `GET /hr/applications/:id` повертає `matchBreakdown`
  - candidate responses **без** breakdown

- [ ] **Step 1: Write failing tests**

In `candidate-matches.test.ts` (reuse `confirmedSeed` / accept fixtures; extend application create to capture `matchBreakdown`):

```typescript
test("GET /candidate/matches offers omit breakdown", async () => {
  // existing top offers request
  const body = await response.json();
  assert.equal(body.offers[0]?.breakdown, undefined);
  assert.deepEqual(Object.keys(body.offers[0]).sort(), [
    "matchScore",
    "salaryDisplay",
    "title",
    "vacancyId",
    "workFormatDisplay",
  ]);
});

test("POST /candidate/matches/:vacancyId/accept stores matchBreakdown snapshot", async () => {
  // seed matchScores with breakdown object for vacancy
  // after accept:
  assert.equal(response.status, 200);
  assert.ok(fakePrisma.__applications[0]?.matchBreakdown);
  assert.equal(fakePrisma.__applications[0]?.matchBreakdown.matchScore, 90);
  const body = await response.json();
  assert.equal(body.application.breakdown, undefined);
  assert.equal(body.application.matchBreakdown, undefined);
});
```

In `hr-applications.test.ts`:

```typescript
test("GET /hr/applications/:id includes matchBreakdown for owning HR", async () => {
  const breakdown = {
    assessments: [
      {
        requirement: "React",
        priority: "critical",
        status: "met",
        evidence: "Є в skills",
      },
    ],
    contextFit: 80,
    criticalFit: 100,
    desiredFit: null,
    requirementsFit: 100,
    rawScore: 96,
    cappedByCriticalUnmet: false,
    matchScore: 96,
  };
  const { prisma } = makeFakePrisma({
    vacancies: [{ id: "v1", hrUserId: "hr_1", title: "Frontend", status: "CONFIRMED" }],
    users: [{ id: "cd_1", email: "cd@test.com", role: "CANDIDATE" }],
    applications: [
      {
        id: "app_1",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        matchScore: 96,
        matchBreakdown: breakdown,
        candidateSummary: "Strong FE",
        status: "PENDING",
        interviewId: null,
        createdAt: new Date(),
      },
    ],
  });
  const app = makeApp(prisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hr/applications/app_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.application.matchBreakdown, breakdown);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

Оновити fake application type / `create` у тестах, щоб підтримувати `matchBreakdown`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && npm test -- src/routes/candidate-matches.test.ts src/routes/hr-applications.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement**

На accept: знайти актуальний `VacancyMatchScore` (або використати breakdown з ensure result) і записати:

```typescript
matchBreakdown: asInputJson(breakdown),
```

`ensureMatchScores` / offer lookup має повертати breakdown внутрішньо — найпростіше додати до `CandidateMatchOffer`:

```typescript
export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
  salaryDisplay: string | null;
  workFormatDisplay: string | null;
  breakdown?: MatchBreakdown;
};
```

У `applicationPayload` / offer serializers **не** включати `breakdown`.

У `hr-applications.ts` detail response:

```typescript
matchBreakdown: application.matchBreakdown,
```

Серіалізуй JSON as-is (вже MatchBreakdown shape). List endpoint без breakdown (YAGNI).

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && npm test -- src/routes/candidate-matches.test.ts src/routes/hr-applications.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-matches.ts backend/src/routes/candidate-matches.test.ts backend/src/routes/hr-applications.ts backend/src/routes/hr-applications.test.ts backend/src/services/vacancy-match.ts
git commit -m "feat(api): snapshot match breakdown for HR application details"
```

---

### Task 10: HR applications UI — breakdown

**Files:**
- Modify: `frontend/src/api/hr-applications.ts`
- Modify: `frontend/src/views/HrApplicationsView.vue`

**Interfaces:**
- Consumes `matchBreakdown` from detail API
- Produces статуси українською + cap banner

- [ ] **Step 1: Extend API types**

```typescript
export type RequirementAssessment = {
  requirement: string;
  priority: "critical" | "desired";
  status: "met" | "unknown" | "unmet";
  evidence: string;
};

export type MatchBreakdown = {
  assessments: RequirementAssessment[];
  contextFit: number;
  criticalFit: number | null;
  desiredFit: number | null;
  requirementsFit: number | null;
  rawScore: number;
  cappedByCriticalUnmet: boolean;
  matchScore: number;
};

export type HrApplicationDetail = HrApplicationSummary & {
  candidate: { fullName: string | null; email: string | null };
  matchBreakdown: MatchBreakdown | null;
};
```

- [ ] **Step 2: Render breakdown in detail panel**

Після блоку summary:

```vue
<div v-if="detail.matchBreakdown" class="breakdown-block">
  <h4>Розбір відповідності</h4>
  <p v-if="detail.matchBreakdown.cappedByCriticalUnmet" class="cap-banner" role="status">
    Оцінку обмежено до 69%, бо є критична вимога зі статусом «Не відповідає».
  </p>

  <h5>Критичні вимоги</h5>
  <ul>
    <li
      v-for="(item, i) in criticalAssessments"
      :key="'c'+i"
    >
      <strong>{{ statusLabelUk(item.status) }}</strong> — {{ item.requirement }}:
      {{ item.evidence }}
    </li>
  </ul>

  <h5>Бажані вимоги</h5>
  <ul>
    <li
      v-for="(item, i) in desiredAssessments"
      :key="'d'+i"
    >
      <strong>{{ statusLabelUk(item.status) }}</strong> — {{ item.requirement }}:
      {{ item.evidence }}
    </li>
  </ul>
</div>
```

```typescript
function statusLabelUk(status: string): string {
  if (status === "met") return "Відповідає";
  if (status === "unknown") return "Не підтверджено";
  return "Не відповідає";
}

const criticalAssessments = computed(() =>
  detail.value?.matchBreakdown?.assessments.filter((a) => a.priority === "critical") ?? [],
);
const desiredAssessments = computed(() =>
  detail.value?.matchBreakdown?.assessments.filter((a) => a.priority === "desired") ?? [],
);
```

Додай мінімальні стилі для `.cap-banner` (наприклад soft warning background з наявних CSS tokens).

- [ ] **Step 3: Frontend lint**

Run: `cd frontend && npm run lint`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/hr-applications.ts frontend/src/views/HrApplicationsView.vue
git commit -m "feat(ui): show prioritized match breakdown for HR"
```

---

### Task 11: README + full verification

**Files:**
- Modify: `README.md` (секції vacancy prep / vacancy match & applications)
- Modify: будь-які застарілі приклади `requirements: ["..."]` у релевантних README-блоках match/prep

- [ ] **Step 1: Update README**

Документуй:

- `requirements: { critical, desired }`
- формулу match (коротко) і cap 69
- що candidate бачить лише %, HR — breakdown у деталях заявки
- legacy `string[]` → desired

- [ ] **Step 2: Run full backend tests**

Run: `cd backend && npm test`

Expected: all PASS

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document prioritized vacancy requirements matching"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Structured `{critical,desired}` + legacy → desired | 1, 3, 4 |
| Agent збирає два списки; HR редагує перед confirm | 3, 4, 5 |
| LLM assessments + contextFit; code owns % | 6, 7, 8 |
| Weights 75/25, 80/20, unknown=50, cap 69 | 6 |
| Partial cache by candidate+vacancy confirmedAt | 2, 8 |
| Application snapshot breakdown | 2, 9 |
| HR-only breakdown UI | 9, 10 |
| Empty both lists invalid | 1, 3, 4 |
| Candidate API without breakdown | 8, 9 |
| README + verification | 11 |

## Self-review notes

- Немає TBD/placeholder кроків.
- Типи `VacancyRequirements`, `RequirementAssessment`, `MatchBreakdown` узгоджені між Tasks 1/6/7/9/10.
- `parseVacancyMatchScores` замінюється assessment flow у Task 7; сервіс більше не очікує готовий `matchScore` від LLM.
- Unique index name у SQL може відрізнятися локально — Step 2 Task 2 вимагає перевірити фактичну назву перед DROP.

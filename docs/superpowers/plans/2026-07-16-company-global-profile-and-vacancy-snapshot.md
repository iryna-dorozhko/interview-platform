# Company Global Profile and Vacancy Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR один раз заповнює універсальний «Профіль компанії» через окремий чат; ці відповіді snapshot-копіюються в профіль кожної вакансії; вакансійний чат збирає лише `role`, `requirements`, `expectations`; перед підтвердженням вакансії всі 8 полів редагуються локально.

**Architecture:** Два незалежні контури — `company-prep` (1 на HR, `HrCompanyProfile`) і `prep/:vacancyId` (1 на вакансія, `CompanyProfile`). Жорсткий gate: без `HrCompanyProfile.confirmedAt` вакансійний prep недоступний. На `finish` вакансії універсальні поля копіюються з підтвердженого `HrCompanyProfile` (snapshot, без live sync).

**Tech Stack:** Express + TypeScript, Prisma (PostgreSQL), Vue 3 + Vue Router, наявний `LlmProvider`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-16-company-global-profile-and-vacancy-snapshot-design.md`

## Global Constraints

- Мова UI/промптів/помилок для HR: **українська**
- Scope профілю компанії: **1 на HR-користувача** (`hrUserId @unique`)
- Універсальні поля: `culture`, `companyDirection`, `policies`, `workFormat`, `onboardingApproach`
- Вакансійні поля: `role`, `requirements`, `expectations`
- Snapshot: зміни `HrCompanyProfile` **не** оновлюють існуючі `CompanyProfile` вакансій
- Gate: `409 { error: "Company profile is not confirmed" }` без підтвердженого глобального профілю
- Sidebar: пункт **«Профіль компанії»** → `/company-profile`

---

## File Structure

| File | Відповідальність |
|------|------------------|
| `backend/prisma/schema.prisma` | Нові моделі + розширення `CompanyProfile` |
| `backend/prisma/migrations/.../` | SQL-міграція |
| `backend/src/agents/prompts/company-profile-agent.uk.ts` | System prompt для універсального чату |
| `backend/src/agents/prompts/hr-company-profile-extraction.uk.ts` | Extraction prompt (5 полів) |
| `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts` | Extraction prompt (3 поля) — rename/split від поточного |
| `backend/src/agents/prompts/company-agent.uk.ts` | Скорочення до 3 вакансійних тем |
| `backend/src/agents/company-profile-agent.ts` | `buildCompanyProfileAgentMessages`, `parseHrCompanyProfileExtraction` |
| `backend/src/agents/company-profile-agent.test.ts` | Unit-тести universal agent |
| `backend/src/agents/company-agent.ts` | Оновлення `ExtractedProfile` / `parseProfileExtraction` (3 поля) |
| `backend/src/agents/company-agent.test.ts` | Оновлення тестів vacancy extraction |
| `backend/src/routes/company-prep.ts` | CRUD чату глобального профілю |
| `backend/src/routes/company-prep.test.ts` | HTTP-тести company-prep |
| `backend/src/routes/prep.ts` | Gate, snapshot, `PATCH profile`, `missingCompanyProfile` |
| `backend/src/routes/prep.test.ts` | Оновлення/нові тести vacancy prep |
| `backend/src/server.ts` | Mount `createCompanyPrepRouter` |
| `frontend/src/api/company-prep.ts` | API-клієнт глобального профілю |
| `frontend/src/api/prep.ts` | Розширені типи + `updatePrepProfile` |
| `frontend/src/components/HrSidebar.vue` | Пункт «Профіль компанії» |
| `frontend/src/router/index.ts` | Роут `company-profile` |
| `frontend/src/views/CompanyProfilePrepView.vue` | Чат + прев'ю глобального профілю |
| `frontend/src/views/VacancyPrepView.vue` | Gate + editable 8-field profile |

---

### Task 1: Prisma schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_hr_company_profile/migration.sql`

**Interfaces:**
- Produces: Prisma models `HrCompanyProfile`, `PrepSessionCompany`, `PrepMessageCompany`; extended `CompanyProfile` with nullable snapshot fields

- [ ] **Step 1: Add models to schema**

```prisma
model HrCompanyProfile {
  id                 String    @id @default(cuid())
  hrUserId           String    @unique
  culture            Json
  companyDirection   Json
  policies           Json
  workFormat         Json
  onboardingApproach Json
  confirmedAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  hrUser             User      @relation("HrCompanyProfiles", fields: [hrUserId], references: [id])
}

model PrepSessionCompany {
  id        String               @id @default(cuid())
  hrUserId  String               @unique
  isClosed  Boolean              @default(false)
  createdAt DateTime             @default(now())
  updatedAt DateTime             @updatedAt
  hrUser    User                 @relation("HrCompanyPrepSessions", fields: [hrUserId], references: [id])
  messages  PrepMessageCompany[]
}

model PrepMessageCompany {
  id         String           @id @default(cuid())
  sessionId  String
  authorType PrepHrAuthorType
  content    String
  createdAt  DateTime         @default(now())
  session    PrepSessionCompany @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}
```

Extend `User`:

```prisma
hrCompanyProfile   HrCompanyProfile?   @relation("HrCompanyProfiles")
prepSessionCompany PrepSessionCompany? @relation("HrCompanyPrepSessions")
```

Extend `CompanyProfile`:

```prisma
companyDirection   Json?
policies           Json?
workFormat         Json?
onboardingApproach Json?
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd backend && npx prisma migrate dev --name hr_company_profile
npx prisma generate
```

Expected: migration applied, client regenerated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(db): add HR company profile and company prep session models"
```

---

### Task 2: Company Profile Agent (universal fields)

**Files:**
- Create: `backend/src/agents/prompts/company-profile-agent.uk.ts`
- Create: `backend/src/agents/prompts/hr-company-profile-extraction.uk.ts`
- Create: `backend/src/agents/company-profile-agent.ts`
- Create: `backend/src/agents/company-profile-agent.test.ts`
- Modify: `backend/package.json` (додати `company-profile-agent.test.ts` у script `test`)

**Interfaces:**
- Produces: `buildCompanyProfileAgentMessages(history: PrepHistoryItem[]): ChatMessage[]`
- Produces: `buildHrCompanyProfileExtractionMessages(history: PrepHistoryItem[]): ChatMessage[]`
- Produces: `parseHrCompanyProfileExtraction(rawText: string): HrCompanyProfileExtracted` where:

```typescript
export interface HrCompanyProfileExtracted {
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
}
```

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/agents/company-profile-agent.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyProfileAgentMessages,
  buildHrCompanyProfileExtractionMessages,
  parseHrCompanyProfileExtraction,
} from "./company-profile-agent";
import { COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-profile-agent.uk";

test("buildCompanyProfileAgentMessages uses company profile system prompt", () => {
  const messages = buildCompanyProfileAgentMessages([]);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, COMPANY_PROFILE_AGENT_SYSTEM_PROMPT_UK);
  assert.equal(messages[1].role, "user");
});

test("parseHrCompanyProfileExtraction parses all five universal fields", () => {
  const raw = JSON.stringify({
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
    onboardingApproach: ["Buddy 2 тижні"],
  });
  assert.deepEqual(parseHrCompanyProfileExtraction(raw), {
    culture: ["Відкритість"],
    companyDirection: ["EdTech"],
    policies: ["Remote-first"],
    workFormat: ["Гібрид"],
    onboardingApproach: ["Buddy 2 тижні"],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/company-profile-agent.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement agent module**

`company-profile-agent.ts` — mirror `company-agent.ts` structure:
- reuse `PrepHistoryItem`, `parseAgentReply` from `./agent-reply`
- `buildCompanyProfileAgentMessages` — same placeholder-user-turn logic as vacancy agent
- `parseHrCompanyProfileExtraction` — validate all 5 array fields (reuse `ProfileExtractionError` pattern)

Prompts (українською):
- `company-profile-agent.uk.ts` — 5 тем, одне питання за раз, `READY:true/false`
- `hr-company-profile-extraction.uk.ts` — JSON з 5 полями

- [ ] **Step 4: Run tests**

Run: `npm --workspace backend test -- src/agents/company-profile-agent.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/company-profile-agent.ts backend/src/agents/company-profile-agent.test.ts backend/src/agents/prompts/company-profile-agent.uk.ts backend/src/agents/prompts/hr-company-profile-extraction.uk.ts backend/package.json
git commit -m "feat(agents): add company profile agent for universal HR fields"
```

---

### Task 3: Vacancy Company Agent — 3 fields only

**Files:**
- Modify: `backend/src/agents/prompts/company-agent.uk.ts`
- Create: `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts`
- Modify: `backend/src/agents/company-agent.ts`
- Modify: `backend/src/agents/company-agent.test.ts`
- Delete or stop importing: `backend/src/agents/prompts/company-profile-extraction.uk.ts` (rename to vacancy-specific)

**Interfaces:**
- Produces: `ExtractedVacancyProfile { role: string; requirements: string[]; expectations: string[] }`
- Produces: `parseVacancyProfileExtraction(rawText: string): ExtractedVacancyProfile`
- Consumes: `buildProfileExtractionMessages` updated to use vacancy extraction prompt

- [ ] **Step 1: Update failing tests**

Change `parseProfileExtraction` tests to expect only 3 fields:

```typescript
test("parseVacancyProfileExtraction parses vacancy-only fields", () => {
  const raw = JSON.stringify({
    role: "Middle Backend Developer",
    requirements: ["Node.js"],
    expectations: ["Перший реліз за місяць"],
  });
  const result = parseVacancyProfileExtraction(raw);
  assert.deepEqual(result, {
    role: "Middle Backend Developer",
    requirements: ["Node.js"],
    expectations: ["Перший реліз за місяць"],
  });
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npm --workspace backend test -- src/agents/company-agent.test.ts`

- [ ] **Step 3: Implement**

- `company-agent.uk.ts` — залишити лише теми: посада, вимоги, очікування для цієї ролі
- `vacancy-profile-extraction.uk.ts` — JSON `{ role, requirements, expectations }`
- Rename export: `parseProfileExtraction` → `parseVacancyProfileExtraction` (update all imports in `prep.ts`, tests)

- [ ] **Step 4: Run tests — verify pass**

Run: `npm --workspace backend test -- src/agents/company-agent.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(agents): limit vacancy company agent to role/requirements/expectations"
```

---

### Task 4: Company Prep router

**Files:**
- Create: `backend/src/routes/company-prep.ts`
- Create: `backend/src/routes/company-prep.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `createCompanyPrepRouter(getPrisma, getProvider): Router`
- Endpoints: `GET /company-prep`, `POST /company-prep/message`, `POST /company-prep/finish`, `POST /company-prep/confirm`, `DELETE /company-prep`
- Profile DTO:

```typescript
type HrCompanyProfileDto = {
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
  confirmedAt: string | null;
};
```

- [ ] **Step 1: Write failing HTTP tests**

Mirror `prep.test.ts` fake-Prisma pattern. Key cases:

```typescript
test("POST /company-prep/message creates session and returns agent reply", async () => { /* ... */ });
test("POST /company-prep/finish upserts HrCompanyProfile and closes session", async () => { /* ... */ });
test("POST /company-prep/confirm sets confirmedAt", async () => { /* ... */ });
test("DELETE /company-prep returns 409 when profile confirmed", async () => { /* ... */ });
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npm --workspace backend test -- src/routes/company-prep.test.ts`

- [ ] **Step 3: Implement router**

Copy structure from `prep.ts`, keyed by `req.user.id` instead of `vacancyId`:
- `PrepSessionCompany` upsert on message
- `finish` → LLM extraction → `hrCompanyProfile.upsert` → close session
- `confirm` → set `confirmedAt`
- `DELETE` → block if confirmed; else delete messages, session, profile

- [ ] **Step 4: Mount in server.ts**

```typescript
import { createCompanyPrepRouter } from "./routes/company-prep";
// ...
app.use("/api", requireAuth, requireHr, createCompanyPrepRouter(() => prisma, getLlmProvider));
```

- [ ] **Step 5: Run tests — verify pass**

Run: `npm --workspace backend test -- src/routes/company-prep.test.ts`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(api): add company-prep routes for HR global profile chat"
```

---

### Task 5: Vacancy prep — gate, snapshot, PATCH

**Files:**
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/prep.test.ts`

**Interfaces:**
- Consumes: confirmed `HrCompanyProfile` from Task 1
- Consumes: `parseVacancyProfileExtraction` from Task 3
- Produces: helper `assertConfirmedHrCompanyProfile(req, res, prisma): Promise<HrCompanyProfile | null>`
- Produces: `PATCH /prep/:vacancyId/profile` handler
- Produces: `GET` response field `missingCompanyProfile: boolean`
- Produces: extended profile DTO with 8 fields

- [ ] **Step 1: Write failing tests**

```typescript
test("POST /prep/:vacancyId/message returns 409 when company profile not confirmed", async () => {
  // no HrCompanyProfile.confirmedAt
  const res = await request(app).post("/api/prep/vac_1/message").set("Authorization", token);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "Company profile is not confirmed");
});

test("POST /prep/:vacancyId/finish snapshots universal fields from HrCompanyProfile", async () => {
  // seed confirmed HrCompanyProfile + vacancy session
  // assert CompanyProfile has culture, companyDirection, policies, workFormat, onboardingApproach from HR profile
});

test("PATCH /prep/:vacancyId/profile updates all fields before confirm", async () => { /* ... */ });
test("PATCH /prep/:vacancyId/profile returns 409 after confirm", async () => { /* ... */ });
test("GET /prep/:vacancyId returns missingCompanyProfile true when HR profile not confirmed", async () => { /* ... */ });
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npm --workspace backend test -- src/routes/prep.test.ts`

- [ ] **Step 3: Implement changes in prep.ts**

1. Add gate helper; call at start of `message`, `finish`, `confirm`
2. `GET` — query `hrCompanyProfile` by `req.user.id`, set `missingCompanyProfile`
3. `finish` — after vacancy extraction, read `HrCompanyProfile`, merge snapshot fields into upsert
4. Add `PATCH /prep/:vacancyId/profile`:
   - validate body fields
   - reject if `profile.confirmedAt`
   - partial update allowed (merge provided fields)
5. Extend GET/finish/confirm/PATCH responses with 8-field profile shape

Shared serializer:

```typescript
function serializeVacancyProfile(profile: CompanyProfile) {
  return {
    role: profile.role,
    requirements: profile.requirements,
    expectations: profile.expectations,
    culture: profile.culture,
    companyDirection: profile.companyDirection ?? [],
    policies: profile.policies ?? [],
    workFormat: profile.workFormat ?? [],
    onboardingApproach: profile.onboardingApproach ?? [],
    confirmedAt: profile.confirmedAt,
  };
}
```

- [ ] **Step 4: Run full backend tests**

Run: `npm --workspace backend test`

Expected: all pass (update existing prep tests to seed confirmed `HrCompanyProfile` where needed)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(prep): gate vacancy prep on confirmed company profile and snapshot universal fields"
```

---

### Task 6: Frontend API clients

**Files:**
- Create: `frontend/src/api/company-prep.ts`
- Modify: `frontend/src/api/prep.ts`

**Interfaces:**
- Produces: `fetchCompanyPrepState()`, `sendCompanyPrepMessage()`, `finishCompanyPrepChat()`, `confirmCompanyPrepProfile()`, `deleteCompanyPrepChat()`
- Produces: extended `CompanyProfile` type with 8 fields
- Produces: `updatePrepProfile(vacancyId, payload): Promise<{ profile: CompanyProfile }>`

- [ ] **Step 1: Create company-prep.ts**

Mirror `prep.ts` structure, base path `/api/company-prep`:

```typescript
export type HrCompanyProfile = {
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
  confirmedAt: string | null;
};
```

- [ ] **Step 2: Extend prep.ts**

```typescript
export type CompanyProfile = {
  role: string;
  requirements: string[];
  expectations: string[];
  culture: string[];
  companyDirection: string[];
  policies: string[];
  workFormat: string[];
  onboardingApproach: string[];
  confirmedAt: string | null;
};

export type PrepState = {
  messages: PrepMessage[];
  isClosed: boolean;
  profile: CompanyProfile | null;
  missingCompanyProfile: boolean;
};

export async function updatePrepProfile(
  vacancyId: string,
  payload: Partial<Omit<CompanyProfile, "confirmedAt">>
): Promise<{ profile: CompanyProfile }> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  // ...
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(frontend): add company-prep API client and extend vacancy profile types"
```

---

### Task 7: Sidebar and router

**Files:**
- Modify: `frontend/src/components/HrSidebar.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: Add sidebar link**

```vue
<RouterLink
  to="/company-profile"
  class="nav-item"
  :class="{ active: isActive('/company-profile') }"
>
  Профіль компанії
</RouterLink>
```

Insert after «Головна», before «Анкети».

- [ ] **Step 2: Add route**

```typescript
import CompanyProfilePrepView from "../views/CompanyProfilePrepView.vue";

// inside HrLayout children:
{
  path: "company-profile",
  name: "company-profile",
  component: CompanyProfilePrepView,
},
```

- [ ] **Step 3: Manual check**

Run frontend, log in as HR, verify sidebar shows «Профіль компанії» and navigates to `/company-profile`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): add company profile route and sidebar navigation"
```

---

### Task 8: CompanyProfilePrepView

**Files:**
- Create: `frontend/src/views/CompanyProfilePrepView.vue`

**Interfaces:**
- Consumes: `frontend/src/api/company-prep.ts` from Task 6

- [ ] **Step 1: Create view**

Clone `VacancyPrepView.vue` structure with these deltas:
- Title: «Профіль компанії»
- No vacancy title fetch
- API calls use `company-prep` client
- Profile preview shows 5 universal fields with Ukrainian labels:
  - Культура, Напрям компанії, Політики, Формат роботи, Онбординг
- Confirm dialog text: «Профіль компанії буде зафіксовано…»
- After confirm: read-only + «✓ Профіль компанії підтверджено»
- Back button: «← До списку анкет» → `{ name: 'vacancies' }`

- [ ] **Step 2: Manual flow test**

1. Open `/company-profile`
2. Chat greeting appears
3. Finish → preview 5 fields
4. Confirm → read-only state

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ui): add CompanyProfilePrepView for universal HR questionnaire"
```

---

### Task 9: VacancyPrepView — gate and editable profile

**Files:**
- Modify: `frontend/src/views/VacancyPrepView.vue`

- [ ] **Step 1: Gate UI when missingCompanyProfile**

After loading prep state:

```vue
<section v-if="missingCompanyProfile" class="gate-banner">
  <p>Спочатку заповніть і підтвердіть профіль компанії.</p>
  <RouterLink to="/company-profile" class="btn-primary">Перейти до профілю компанії</RouterLink>
</section>
```

Do not call `triggerGreeting()` when `missingCompanyProfile === true`.

- [ ] **Step 2: Editable profile form (8 fields)**

Replace read-only `<dl>` in profile view with editable form when `!profile.confirmedAt`:

```typescript
const editableProfile = ref<CompanyProfile | null>(null);
const saving = ref(false);

async function onSaveProfileEdits(): Promise<void> {
  if (!editableProfile.value) return;
  saving.value = true;
  try {
    const { profile: updated } = await updatePrepProfile(vacancyId.value, {
      role: editableProfile.value.role,
      requirements: editableProfile.value.requirements,
      expectations: editableProfile.value.expectations,
      culture: editableProfile.value.culture,
      companyDirection: editableProfile.value.companyDirection,
      policies: editableProfile.value.policies,
      workFormat: editableProfile.value.workFormat,
      onboardingApproach: editableProfile.value.onboardingApproach,
    });
    profile.value = updated;
    editableProfile.value = { ...updated };
  } finally {
    saving.value = false;
  }
}
```

Use simple `<textarea>` for `role`, newline-separated lists or dynamic `<input>` rows for arrays (match existing UI patterns — keep minimal).

Section labels (українською):
- Посада, Вимоги, Очікування (вакансійні)
- Культура, Напрям компанії, Політики, Формат роботи, Онбординг (snapshot, editable locally)

Buttons: «Зберегти зміни», «Підтвердити профіль».

- [ ] **Step 3: Manual end-to-end test**

1. Without company profile → gate banner + CTA
2. Complete company profile confirm
3. Open vacancy prep → chat works
4. Finish vacancy → edit universal + vacancy fields → save → confirm
5. Profile becomes read-only

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): gate vacancy prep and add editable full profile before confirm"
```

---

### Task 10: Spec doc sync and final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-company-global-profile-and-vacancy-snapshot-design.md` (sidebar section already present — commit if unstaged)

- [ ] **Step 1: Run full backend test suite**

Run: `npm --workspace backend test`

Expected: PASS

- [ ] **Step 2: Run typecheck/build**

Run:
```bash
npm --workspace backend run build
npm --workspace frontend run build
```

Expected: no TypeScript errors

- [ ] **Step 3: Commit any remaining spec/docs**

```bash
git add docs/superpowers/specs/2026-07-16-company-global-profile-and-vacancy-snapshot-design.md
git commit -m "docs: finalize company global profile design spec with sidebar nav"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|---|---|
| `HrCompanyProfile` 1:1 HR | Task 1 |
| `PrepSessionCompany` / `PrepMessageCompany` | Task 1, 4 |
| Snapshot fields on `CompanyProfile` | Task 1, 5 |
| `/api/company-prep` CRUD | Task 4 |
| Gate 409 on vacancy prep | Task 5 |
| `missingCompanyProfile` on GET | Task 5, 9 |
| Snapshot on vacancy finish | Task 5 |
| `PATCH /prep/:vacancyId/profile` | Task 5, 6, 9 |
| Universal agent (5 fields) | Task 2 |
| Vacancy agent (3 fields) | Task 3 |
| Sidebar «Профіль компанії» | Task 7 |
| `CompanyProfilePrepView` | Task 8 |
| Editable 8-field vacancy profile | Task 9 |

## Out of Scope (do not implement)

- Re-editing confirmed global company profile
- Live inheritance to existing vacancies
- Multi-tenant companies per HR

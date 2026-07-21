# HR and Candidate Chat and Vacancies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-width HR vacancy prep chat, company name in profile and candidate matches, candidate «Доступні вакансії» tab, Company Agent live-chat label «Компанія (АІ)», and taller shared live chat.

**Architecture:** CSS-align `VacancyPrepView` with candidate prep; store `companyName` on `HrCompanyProfile` and enrich candidate match offers from that live source; wire the existing `/candidate/matches` page into the sidebar; change only the centralized `AGENT_COMPANY` display label; raise shared `LiveChatPanel` height via viewport CSS.

**Tech Stack:** Vue 3, Express, Prisma/PostgreSQL, Vitest/node:test for backend.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-hr-candidate-chat-and-vacancies-design.md`
- Company name source of truth: `HrCompanyProfile.companyName` (nullable string); do not copy into `Vacancy` or vacancy `CompanyProfile`.
- Confirmed company profiles must remain fully editable (remove PATCH lock on confirmed profiles).
- New confirm requires non-empty trimmed `companyName`; UI fallback for null name: `Компанія`.
- Live-chat author type stays `AGENT_COMPANY`; only UI label becomes exactly `Компанія (АІ)`.
- Candidate tab label and page title: exactly `Доступні вакансії`.
- Prep chat height formula: `calc(100vh - 14rem)` + `min-height: 20rem`.
- Live chat height formula: `calc(100vh - 16rem)` + `min-height: 20rem`.
- Do **not** create git commits unless the user explicitly asks later.
- Follow TDD for backend behavioral changes; frontend has no unit test runner — verify with build.
- Work in the current workspace; do not touch unrelated WIP files (`hr-applications*`, arbiter, `useInterviewRoom.ts` logic, etc.).

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/views/VacancyPrepView.vue` | Full-width HR vacancy prep chat CSS |
| `backend/prisma/schema.prisma` | Add nullable `companyName` |
| `backend/prisma/migrations/<ts>_add_hr_company_name/migration.sql` | DB migration |
| `backend/src/agents/company-profile-agent.ts` | Parse `companyName` |
| `backend/src/agents/prompts/*.uk.ts` | Ask for / extract company name |
| `backend/src/routes/company-prep.ts` | DTO, patch, confirm, finish upsert; allow edit after confirm |
| `frontend/src/api/company-prep.ts` | Type + patch payload |
| `frontend/src/views/CompanyProfilePrepView.vue` | Editable name field even when confirmed |
| `backend/src/services/vacancy-match.ts` | Enrich offers with `companyName` |
| `backend/src/routes/candidate-matches.ts` | Include `companyName` in payload |
| `frontend/src/api/candidate-matches.ts` | Type + 403 questionnaire handling |
| `frontend/src/views/CandidateMatchesView.vue` | Title, company name, questionnaire gate UX |
| `frontend/src/components/CandidateSidebar.vue` | New nav item |
| `frontend/src/utils/live-message-styles.ts` | Agent label |
| `frontend/src/components/LiveChatPanel.vue` | Live chat height |

---

### Task 1: Full-width HR vacancy prep chat

**Files:**
- Modify: `frontend/src/views/VacancyPrepView.vue` (scoped styles only)

**Interfaces:**
- Consumes: existing candidate prep CSS pattern from `CandidatePrepView.vue` / `CompanyProfilePrepView.vue`
- Produces: full-width vacancy prep chat matching candidate prep sizing

- [ ] **Step 1: Update `.page` and `.messages` styles**

Replace:

```css
.page {
  max-width: 40rem;
}
```

with:

```css
.page {
  width: 100%;
  min-width: 0;
}
```

Replace:

```css
.messages {
  max-height: 24rem;
  overflow-y: auto;
```

with:

```css
.messages {
  max-height: calc(100vh - 14rem);
  min-height: 20rem;
  overflow-y: auto;
```

Do not change script/template logic.

- [ ] **Step 2: Verify**

Run: `npm run build --workspace=frontend`
Expected: build succeeds.

Visually confirm `/vacancies/:id/prep` chat uses full content width and taller message pane.

- [ ] **Step 3: Report (no commit)**

Write report to `.superpowers/sdd/task-1-report.md`. Do not commit.

---

### Task 2: Company name in profile and candidate matches

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_hr_company_name/migration.sql`
- Modify: `backend/src/agents/company-profile-agent.ts`
- Modify: `backend/src/agents/company-profile-agent.test.ts`
- Modify: `backend/src/agents/prompts/company-profile-agent.uk.ts`
- Modify: `backend/src/agents/prompts/hr-company-profile-extraction.uk.ts`
- Modify: `backend/src/routes/company-prep.ts`
- Modify: `backend/src/routes/company-prep.test.ts`
- Modify: `backend/src/services/vacancy-match.ts`
- Modify: `backend/src/services/vacancy-match.test.ts`
- Modify: `backend/src/routes/candidate-matches.ts` (if payload helper needs explicit field)
- Modify: `backend/src/routes/candidate-matches.test.ts`
- Modify: `frontend/src/api/company-prep.ts`
- Modify: `frontend/src/views/CompanyProfilePrepView.vue`
- Modify: `frontend/src/api/candidate-matches.ts`
- Modify: `frontend/src/views/CandidateMatchesView.vue` (company name display only; tab/title handled in Task 3)

**Interfaces:**
- Consumes: existing company-prep and vacancy-match flows
- Produces:
  - `HrCompanyProfile.companyName: string | null`
  - `HrCompanyProfileDto.companyName: string | null`
  - `CandidateMatchOffer.companyName: string | null`
  - PATCH accepts optional `companyName: string` (trimmed non-empty when provided)
  - Confirm rejects blank/null `companyName` with `400` and error like `Company name is required`

- [ ] **Step 1: Write failing backend tests first (TDD)**

In `company-profile-agent.test.ts`, assert extraction parses `companyName` and rejects missing/blank.

In `company-prep.test.ts`:
- DTO includes `companyName`
- Confirm without name → 400
- PATCH on confirmed profile succeeds (no longer 409)
- Finish upsert persists `companyName`

In `vacancy-match.test.ts` / `candidate-matches.test.ts`:
- Offers include `companyName` from `hrUser.hrCompanyProfile`
- Null profile name yields `companyName: null`
- Update exact `Object.keys(offer)` assertions to include `companyName`

- [ ] **Step 2: Run tests and confirm RED**

Run focused suites (project’s usual backend test command for those files).
Expected: failures for missing field / still-locked PATCH / missing keys.

- [ ] **Step 3: Schema + migration**

Add to `HrCompanyProfile` in `schema.prisma`:

```prisma
companyName String?
```

Create migration SQL:

```sql
ALTER TABLE "HrCompanyProfile" ADD COLUMN "companyName" TEXT;
```

Apply with the repo’s normal Prisma migrate/generate flow.

- [ ] **Step 4: Implement agent + prompts + company-prep API**

- Extend `HrCompanyProfileExtracted` with `companyName: string`.
- Parse with a non-empty trimmed string helper; reject missing/blank.
- Update extraction JSON contract and company-profile agent prompt to collect the official company name early.
- Extend DTO/`toProfileDto`/finish upsert/`parseProfilePatch`.
- On confirm: if `!profile.companyName?.trim()` → `400 { error: "Company name is required" }`.
- Remove the `if (profile.confirmedAt) { 409... }` block from PATCH `/company-prep/profile` only (keep confirm-already-confirmed and delete-reset locks).

- [ ] **Step 5: Implement match enrichment**

Update `CandidateMatchOffer` and enrichment so `attachDisplaysToOffers` loads:

```ts
include: {
  companyProfile: true,
  hrUser: { include: { hrCompanyProfile: true } },
}
```

Set `companyName: vacancy.hrUser.hrCompanyProfile?.companyName ?? null`.
Ensure `toCandidateOfferPayload` / `offersPayload` pass the field through.

- [ ] **Step 6: Frontend profile + match display**

- Add `companyName: string | null` to frontend types.
- In `CompanyProfilePrepView.vue`: keep form editable when profile exists even if `confirmedAt` is set; add a single-line input for company name; include it in PATCH; show it in read-only sections if any remain.
- In `CandidateMatchesView.vue`: above or beside vacancy title render `item.companyName?.trim() || 'Компанія'`.

Do not rename page title or add sidebar in this task.

- [ ] **Step 7: Verify GREEN**

Run company-profile, company-prep, vacancy-match, candidate-matches tests.
Run: `npm run build --workspace=frontend`
Expected: all green / build OK.

- [ ] **Step 8: Report (no commit)**

Write `.superpowers/sdd/task-2-report.md`. Do not commit.

---

### Task 3: Candidate tab «Доступні вакансії»

**Files:**
- Modify: `frontend/src/components/CandidateSidebar.vue`
- Modify: `frontend/src/views/CandidateMatchesView.vue`
- Modify: `frontend/src/api/candidate-matches.ts` (403 → typed/questionnaire error if needed)

**Interfaces:**
- Consumes: existing route `candidate-matches` (`/candidate/matches`) and Task 2 company-name UI if present
- Produces: sidebar item + page title `Доступні вакансії`; actionable unconfirmed-questionnaire state

- [ ] **Step 1: Add sidebar link**

In `CandidateSidebar.vue`, after «Моя анкета» and before «Співбесіда», insert:

```vue
    <RouterLink
      to="/candidate/matches"
      class="nav-item"
      :class="{ active: isActive('/candidate/matches') }"
    >
      Доступні вакансії
    </RouterLink>
```

- [ ] **Step 2: Rename page title**

Change `Підбір вакансій` → `Доступні вакансії`.

- [ ] **Step 3: Questionnaire gate UX**

When `GET /api/candidate/matches/next` returns 403 with questionnaire-not-confirmed semantics, set a dedicated view state (e.g. `needsQuestionnaire`) showing:

> Підтвердьте анкету, щоб переглядати доступні вакансії.

and a `RouterLink` to `/candidate/profile`.
Prefer detecting `response.status === 403` in `fetchNextMatch` (throw a small typed error or attach status) rather than brittle string matching alone.

- [ ] **Step 4: Verify**

Run: `npm run build --workspace=frontend`
Expected: success. Manually confirm sidebar order and active state on `/candidate/matches`.

- [ ] **Step 5: Report (no commit)**

Write `.superpowers/sdd/task-3-report.md`. Do not commit.

---

### Task 4: Company Agent live-chat label

**Files:**
- Modify: `frontend/src/utils/live-message-styles.ts`

**Interfaces:**
- Consumes: `LiveChatPanel` → `labelFor(authorType)`
- Produces: `AGENT_COMPANY` display label exactly `Компанія (АІ)`

- [ ] **Step 1: Change label**

```ts
  AGENT_COMPANY: {
    label: "Компанія (АІ)",
```

Do not change thinking text, AgentStatusPanel, report transcript, schema, or sockets.

- [ ] **Step 2: Verify**

Run: `npm run build --workspace=frontend`
Expected: success.

- [ ] **Step 3: Report (no commit)**

Write `.superpowers/sdd/task-4-report.md`. Do not commit.

---

### Task 5: Taller shared live chat

**Files:**
- Modify: `frontend/src/components/LiveChatPanel.vue` (scoped `.messages` only)

**Interfaces:**
- Consumes: shared by HR and candidate interview rooms via `InterviewRoomContent`
- Produces: taller message pane for both roles

- [ ] **Step 1: Update height CSS**

Replace:

```css
.messages {
  max-height: 24rem;
  overflow-y: auto;
```

with:

```css
.messages {
  max-height: calc(100vh - 16rem);
  min-height: 20rem;
  overflow-y: auto;
```

- [ ] **Step 2: Verify**

Run: `npm run build --workspace=frontend`
Expected: success. Confirm both HR and candidate interview rooms inherit the taller chat.

- [ ] **Step 3: Report (no commit)**

Write `.superpowers/sdd/task-5-report.md`. Do not commit.

---

## Self-Review

1. Spec coverage: items 1–5 each map to Tasks 1–5; editable confirmed profile + nullable migration + fallback covered in Task 2; questionnaire UX in Task 3.
2. No TBD/placeholder steps.
3. Types consistent: `companyName: string | null` through DTO, match offer, and frontend types.

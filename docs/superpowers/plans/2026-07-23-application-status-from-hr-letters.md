# Application Status from HR Letters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When HR sends a response letter (pre-interview decline from Applications, or post-report decision letter), update the linked `VacancyApplication` status and unlock matching for the declined vacancy.

**Architecture:** Extend `VacancyApplicationStatus` with `ACCEPTED` and `ADDITIONAL_MEETING`. Add decline draft/send on HR applications (LLM letter → Dialog `DECISION_LETTER` without `InterviewDecision`). On `POST /reports/:id/decisions`, sync linked application status by decision type and upsert `VacancyOfferDecision(REJECTED)` so the vacancy leaves the match pool. Shared helper keeps both flows consistent.

**Tech Stack:** Express + Prisma + `node:test` + tsx (backend), Vue 3 + TypeScript (frontend), existing `LlmProvider` / `decision-letter` patterns, Socket.IO `emitDialogMessage`.

**Spec:** `docs/superpowers/specs/2026-07-23-application-status-from-hr-letters-design.md`

## Global Constraints

- UI and letter copy: Ukrainian.
- Pre-interview decline only from `PENDING` → `DECLINED_BY_HR` via letter (no status change without letter).
- Post-interview mapping: `REJECT`→`DECLINED_BY_HR`, `ACCEPT`→`ACCEPTED`, `ADDITIONAL_MEETING`→`ADDITIONAL_MEETING`.
- Match lock remains `PENDING`-only; terminal HR statuses upsert `VacancyOfferDecision(REJECTED)` for that vacancy.
- Pre-interview letter: `DECISION_LETTER` **without** `InterviewDecision` / `decisionId`.
- No email; no auto-create follow-up interview; no candidate application history screen.
- TDD for backend; frontend verify with `npm run build`.
- Do not touch unrelated WIP (cursor-acp, orchestrator, playwright dumps, Day 15 reports, etc.).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Add `ACCEPTED`, `ADDITIONAL_MEETING` to `VacancyApplicationStatus` |
| `backend/prisma/migrations/<ts>_application_status_hr_letters/migration.sql` | Enum migration |
| `backend/src/services/application-hr-decision.ts` | Map decision→status; update application + upsert offer reject |
| `backend/src/services/application-hr-decision.test.ts` | Unit tests for mapper + apply helper |
| `backend/src/agents/prompts/application-decline-letter.uk.ts` | System prompt for pre-interview decline letter |
| `backend/src/agents/application-decline-letter-agent.ts` | Build messages + generate decline letter |
| `backend/src/agents/application-decline-letter-agent.test.ts` | Unit tests |
| `backend/src/routes/hr-applications.ts` | `decline/draft`, `decline`; inject LLM + io |
| `backend/src/routes/hr-applications.test.ts` | Route tests for decline + offer upsert |
| `backend/src/routes/reports.ts` | Sync application on decision send |
| `backend/src/routes/reports.test.ts` | Tests for status sync / rewrite / no-application |
| `backend/src/server.ts` | Pass `getLlmProvider` + `() => io` into HR applications router |
| `backend/package.json` | Register new test files in `test` script if needed |
| `frontend/src/api/hr-applications.ts` | `draftApplicationDecline`, `sendApplicationDecline` |
| `frontend/src/api/candidate-matches.ts` | Extend `ActiveApplication.status` union |
| `frontend/src/views/HrApplicationsView.vue` | Status labels + decline modal |

---

### Task 1: Prisma enum — `ACCEPTED` + `ADDITIONAL_MEETING`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_application_status_hr_letters/migration.sql` (via migrate)

**Interfaces:**
- Consumes: existing `VacancyApplicationStatus`
- Produces: enum values usable as `"ACCEPTED" | "ADDITIONAL_MEETING"` in Prisma client

- [ ] **Step 1: Update enum in schema**

In `backend/prisma/schema.prisma`, change:

```prisma
enum VacancyApplicationStatus {
  PENDING
  CONVERTED
  WITHDRAWN
  DECLINED_BY_HR
  ACCEPTED
  ADDITIONAL_MEETING
}
```

- [ ] **Step 2: Create migration**

```bash
cd backend && npx prisma migrate dev --name application_status_hr_letters
```

Expected: migration SQL adds enum values; `prisma generate` succeeds.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add ACCEPTED and ADDITIONAL_MEETING application statuses"
```

---

### Task 2: Shared helper — map + apply HR terminal status

**Files:**
- Create: `backend/src/services/application-hr-decision.ts`
- Create: `backend/src/services/application-hr-decision.test.ts`
- Modify: `backend/package.json` — append test path to `test` script if not globbed

**Interfaces:**
- Consumes: Prisma transaction client with `vacancyApplication.update` / `updateMany` and `vacancyOfferDecision.upsert`
- Produces:

```typescript
export type InterviewDecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

export type TerminalApplicationStatus =
  | "DECLINED_BY_HR"
  | "ACCEPTED"
  | "ADDITIONAL_MEETING";

export function applicationStatusFromDecisionType(
  type: InterviewDecisionType,
): TerminalApplicationStatus;

/** Updates application status and upserts VacancyOfferDecision(REJECTED). */
export async function applyTerminalApplicationStatus(
  tx: {
    vacancyApplication: {
      update: (args: {
        where: { id: string };
        data: { status: TerminalApplicationStatus };
      }) => Promise<unknown>;
    };
    vacancyOfferDecision: {
      upsert: (args: {
        where: {
          candidateUserId_vacancyId: {
            candidateUserId: string;
            vacancyId: string;
          };
        };
        create: {
          candidateUserId: string;
          vacancyId: string;
          decision: "REJECTED";
        };
        update: { decision: "REJECTED" };
      }) => Promise<unknown>;
    };
  },
  input: {
    applicationId: string;
    candidateUserId: string;
    vacancyId: string;
    status: TerminalApplicationStatus;
  },
): Promise<void>;
```

- [ ] **Step 1: Write failing unit tests**

```typescript
// backend/src/services/application-hr-decision.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  applicationStatusFromDecisionType,
  applyTerminalApplicationStatus,
} from "./application-hr-decision";

test("applicationStatusFromDecisionType maps all decision types", () => {
  assert.equal(applicationStatusFromDecisionType("REJECT"), "DECLINED_BY_HR");
  assert.equal(applicationStatusFromDecisionType("ACCEPT"), "ACCEPTED");
  assert.equal(
    applicationStatusFromDecisionType("ADDITIONAL_MEETING"),
    "ADDITIONAL_MEETING",
  );
});

test("applyTerminalApplicationStatus updates application and upserts offer reject", async () => {
  const calls: string[] = [];
  const tx = {
    vacancyApplication: {
      update: async (args: {
        where: { id: string };
        data: { status: string };
      }) => {
        calls.push(`app:${args.where.id}:${args.data.status}`);
        return {};
      },
    },
    vacancyOfferDecision: {
      upsert: async (args: {
        where: {
          candidateUserId_vacancyId: { candidateUserId: string; vacancyId: string };
        };
        create: { decision: string };
      }) => {
        calls.push(
          `offer:${args.where.candidateUserId_vacancyId.candidateUserId}:${args.where.candidateUserId_vacancyId.vacancyId}:${args.create.decision}`,
        );
        return {};
      },
    },
  };

  await applyTerminalApplicationStatus(tx, {
    applicationId: "app_1",
    candidateUserId: "cd_1",
    vacancyId: "v1",
    status: "DECLINED_BY_HR",
  });

  assert.deepEqual(calls, [
    "app:app_1:DECLINED_BY_HR",
    "offer:cd_1:v1:REJECTED",
  ]);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && node --import tsx --test src/services/application-hr-decision.test.ts
```

Expected: module not found / FAIL.

- [ ] **Step 3: Implement helper**

```typescript
// backend/src/services/application-hr-decision.ts
export type InterviewDecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";
export type TerminalApplicationStatus =
  | "DECLINED_BY_HR"
  | "ACCEPTED"
  | "ADDITIONAL_MEETING";

export function applicationStatusFromDecisionType(
  type: InterviewDecisionType,
): TerminalApplicationStatus {
  if (type === "ACCEPT") return "ACCEPTED";
  if (type === "ADDITIONAL_MEETING") return "ADDITIONAL_MEETING";
  return "DECLINED_BY_HR";
}

export async function applyTerminalApplicationStatus(
  tx: /* as in Interfaces */,
  input: {
    applicationId: string;
    candidateUserId: string;
    vacancyId: string;
    status: TerminalApplicationStatus;
  },
): Promise<void> {
  await tx.vacancyApplication.update({
    where: { id: input.applicationId },
    data: { status: input.status },
  });
  await tx.vacancyOfferDecision.upsert({
    where: {
      candidateUserId_vacancyId: {
        candidateUserId: input.candidateUserId,
        vacancyId: input.vacancyId,
      },
    },
    create: {
      candidateUserId: input.candidateUserId,
      vacancyId: input.vacancyId,
      decision: "REJECTED",
    },
    update: { decision: "REJECTED" },
  });
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/services/application-hr-decision.test.ts
```

- [ ] **Step 5: Register test in `backend/package.json` `test` script (next to other `src/services/` tests) and commit**

```bash
git add backend/src/services/application-hr-decision.ts \
  backend/src/services/application-hr-decision.test.ts \
  backend/package.json
git commit -m "feat: shared helper for terminal application HR status"
```

---

### Task 3: Application decline letter agent

**Files:**
- Create: `backend/src/agents/prompts/application-decline-letter.uk.ts`
- Create: `backend/src/agents/application-decline-letter-agent.ts`
- Create: `backend/src/agents/application-decline-letter-agent.test.ts`
- Modify: `backend/package.json` — register test

**Interfaces:**
- Consumes: `LlmProvider`, reuse `normalizeDecisionLetter` from `./decision-letter-agent` (export it if not already exported — it already is)
- Produces:

```typescript
export type ApplicationDeclineLetterContext = {
  vacancyTitle: string;
  candidateSummary: string;
  matchScore: number;
};

export function buildApplicationDeclineLetterMessages(
  ctx: ApplicationDeclineLetterContext,
): ChatMessage[];

export async function generateApplicationDeclineLetter(
  provider: LlmProvider,
  ctx: ApplicationDeclineLetterContext,
): Promise<string>;
```

- [ ] **Step 1: Write failing tests**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { buildApplicationDeclineLetterMessages } from "./application-decline-letter-agent";

test("buildApplicationDeclineLetterMessages includes vacancy and summary", () => {
  const messages = buildApplicationDeclineLetterMessages({
    vacancyTitle: "Backend Engineer",
    candidateSummary: "Досвід з Node, мало Nest.",
    matchScore: 72,
  });
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[1]?.content ?? "", /Backend Engineer/);
  assert.match(messages[1]?.content ?? "", /Досвід з Node/);
  assert.match(messages[1]?.content ?? "", /72/);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && node --import tsx --test src/agents/application-decline-letter-agent.test.ts
```

- [ ] **Step 3: Implement prompt + agent**

Prompt rules (Ukrainian): polite decline of application **before** interview; no invented feedback beyond provided summary; plain text only; invite questions in the dialog if needed.

```typescript
export async function generateApplicationDeclineLetter(provider, ctx) {
  const messages = buildApplicationDeclineLetterMessages(ctx);
  const raw = await provider.complete(messages);
  return normalizeDecisionLetter(raw);
}
```

- [ ] **Step 4: Run — expect PASS; register in package.json; commit**

```bash
git add backend/src/agents/prompts/application-decline-letter.uk.ts \
  backend/src/agents/application-decline-letter-agent.ts \
  backend/src/agents/application-decline-letter-agent.test.ts \
  backend/package.json
git commit -m "feat: add application decline letter LLM agent"
```

---

### Task 4: HR applications — decline draft + send

**Files:**
- Modify: `backend/src/routes/hr-applications.ts`
- Modify: `backend/src/routes/hr-applications.test.ts`
- Modify: `backend/src/server.ts` — wire LLM + io

**Interfaces:**
- Consumes: `generateApplicationDeclineLetter`, `applyTerminalApplicationStatus`, `emitDialogMessage`
- Change factory to:

```typescript
export function createHrApplicationsRouter(
  getPrisma: () => PrismaClient,
  getLlmProvider: () => LlmProvider,
  getIo: () => Server,
): Router
```

- Produces HTTP:
  - `POST /api/hr/applications/:id/decline/draft` → `200 { body }` / `404` / `409` (not PENDING) / `502`
  - `POST /api/hr/applications/:id/decline` body `{ letterBody }` → `201 { application: { id, status }, dialogId }` / `400` / `404` / `409`

Send transaction (mirror reports decisions, without `InterviewDecision`):

1. Load application + vacancy; authorize HR owner; require `status === "PENDING"`
2. `$transaction`:
   - find-or-create `Dialog` for `(hrUserId, candidateUserId)`
   - create `DialogMessage` `{ kind: "DECISION_LETTER", body: letterBody, decisionId: null }`
   - `applyTerminalApplicationStatus(..., status: "DECLINED_BY_HR")`
   - `dialog.update` `{ updatedAt, candidateHiddenAt: null }`
3. `emitDialogMessage` with `kind: "DECISION_LETTER"` and **no** `decision` field (or `decision: undefined`)
4. Return `201`

- [ ] **Step 1: Extend fake prisma in tests** with `dialog`, `dialogMessage`, `vacancyOfferDecision.upsert`, `$transaction`, and expose `__dialogs` / `__messages` / `__offerDecisions` (copy patterns from `reports.test.ts` + existing offer decision fakes in `candidate-matches.test.ts`).

- [ ] **Step 2: Write failing route tests**

```typescript
test("POST /hr/applications/:id/decline/draft returns letter body", async () => {
  // seed PENDING application owned by hr_1
  // fakeLlm returns "Шановний кандидате, ..."
  // expect 200 { body: "..." }
});

test("POST /hr/applications/:id/decline sets DECLINED_BY_HR, posts DECISION_LETTER, upserts offer", async () => {
  // expect 201, application.status DECLINED_BY_HR
  // __messages[0].kind === "DECISION_LETTER", decisionId == null
  // offer decision REJECTED for candidate+vacancy
});

test("POST /hr/applications/:id/decline returns 409 when not PENDING", async () => {});

test("POST /hr/applications/:id/decline returns 400 for empty letterBody", async () => {});

test("POST /hr/applications/:id/decline/draft returns 502 when LLM throws", async () => {});
```

Update `makeApp` / router construction to pass fake LLM and a stub io (`{ to: () => ({ emit: () => {} }) }`).

- [ ] **Step 3: Run targeted tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/hr-applications.test.ts
```

- [ ] **Step 4: Implement routes + server wiring**

```typescript
// server.ts
app.use(
  "/api",
  requireAuth,
  requireHr,
  createHrApplicationsRouter(() => prisma, getLlmProvider, () => io),
);
```

Implement draft/send as described in Interfaces.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/hr-applications.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/hr-applications.ts \
  backend/src/routes/hr-applications.test.ts \
  backend/src/server.ts
git commit -m "feat: HR decline application with letter to dialogs"
```

---

### Task 5: Sync application status on report decision send

**Files:**
- Modify: `backend/src/routes/reports.ts` — inside `POST /reports/:id/decisions` transaction
- Modify: `backend/src/routes/reports.test.ts`

**Interfaces:**
- Consumes: `applicationStatusFromDecisionType`, `applyTerminalApplicationStatus`
- Produces: same HTTP as today; side effect updates linked `VacancyApplication` when `interviewId` matches

Inside the existing `$transaction`, after dialog message + decision link:

```typescript
const linked = await tx.vacancyApplication.findFirst({
  where: { interviewId: report.interviewId },
});
if (linked) {
  await applyTerminalApplicationStatus(tx, {
    applicationId: linked.id,
    candidateUserId: linked.candidateUserId,
    vacancyId: linked.vacancyId,
    status: applicationStatusFromDecisionType(type),
  });
}
```

Extend fake prisma with `vacancyApplication.findFirst` / `update` and `vacancyOfferDecision.upsert` as needed for new tests.

- [ ] **Step 1: Write failing tests**

```typescript
test("POST /reports/:id/decisions REJECT updates linked application to DECLINED_BY_HR", async () => {
  // seed application with interviewId = sampleReport.interviewId, status CONVERTED
  // send REJECT decision
  // expect application.status === "DECLINED_BY_HR"
  // expect offer upsert REJECTED
});

test("POST /reports/:id/decisions ACCEPT updates linked application to ACCEPTED", async () => {});

test("POST /reports/:id/decisions second decision overwrites application status", async () => {
  // first ACCEPT → ACCEPTED; second REJECT → DECLINED_BY_HR
});

test("POST /reports/:id/decisions without linked application still 201", async () => {
  // no vacancyApplication row — existing assertions still pass
});
```

- [ ] **Step 2: Run — expect FAIL on new assertions**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

- [ ] **Step 3: Implement sync in transaction**

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts
git commit -m "feat: sync vacancy application status from interview decisions"
```

---

### Task 6: Frontend API + status labels + decline modal

**Files:**
- Modify: `frontend/src/api/hr-applications.ts`
- Modify: `frontend/src/api/candidate-matches.ts` — status union
- Modify: `frontend/src/views/HrApplicationsView.vue`

**Interfaces:**
- Produces:

```typescript
export async function draftApplicationDecline(id: string): Promise<{ body: string }>;
export async function sendApplicationDecline(
  id: string,
  letterBody: string,
): Promise<{ application: { id: string; status: string }; dialogId: string }>;
```

`ActiveApplication.status` union add `"ACCEPTED" | "ADDITIONAL_MEETING"`.

UI (mirror `ReportView` modal pattern):

- `STATUS_LABELS`:
  - `ACCEPTED`: «Прийнято»
  - `ADDITIONAL_MEETING`: «Потрібна додаткова зустріч»
  - existing labels unchanged
- For `PENDING` detail: button «Відхилити» next to create-interview form
- Modal states: loading / edit / error / sent; textarea; «Надіслати»
- On success: update local `detail` + list row to `DECLINED_BY_HR`; link to `/dialogs/:dialogId`

- [ ] **Step 1: Add API client functions** (exact fetch paths `/api/hr/applications/${id}/decline/draft` and `.../decline`)

- [ ] **Step 2: Update `HrApplicationsView.vue` labels + decline modal + handlers**

- [ ] **Step 3: Extend candidate-matches status type**

- [ ] **Step 4: Build frontend**

```bash
cd frontend && npm run build
```

Expected: success, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/hr-applications.ts \
  frontend/src/api/candidate-matches.ts \
  frontend/src/views/HrApplicationsView.vue
git commit -m "feat(fe): decline application letter modal and status labels"
```

---

### Task 7: Smoke verification

**Files:** none (manual / test run)

- [ ] **Step 1: Run backend tests for touched suites**

```bash
cd backend && node --import tsx --test \
  src/services/application-hr-decision.test.ts \
  src/agents/application-decline-letter-agent.test.ts \
  src/routes/hr-applications.test.ts \
  src/routes/reports.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Confirm frontend build still green**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: No further commit unless fixes were needed; if fixes, commit with message describing the fix**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Enum `ACCEPTED`, `ADDITIONAL_MEETING` | 1 |
| Map decision types → statuses | 2, 5 |
| Upsert `VacancyOfferDecision(REJECTED)` on terminal | 2, 4, 5 |
| Pre-interview draft/send decline + `DECISION_LETTER` without `InterviewDecision` | 3, 4 |
| Only `PENDING` can decline | 4 |
| Post-report sync + overwrite on re-decision | 5 |
| No-op when no linked application | 5 |
| HR UI labels + decline modal | 6 |
| Candidate unlock via non-`PENDING` + offer reject | 2, 4, 5 (existing active-application query) |
| Out of scope: email, follow-up interview, history screen | — not implemented |

## Self-review notes

- No TBD placeholders; signatures match across tasks (`applyTerminalApplicationStatus`, decline routes).
- `createHrApplicationsRouter` arity change is called out in Task 4 for `server.ts` and tests.
- Pre-interview letters intentionally omit `decision` on socket payload (no `InterviewDecision`).

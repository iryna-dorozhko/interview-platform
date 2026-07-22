# HR Decision Letters + Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After reviewing a `FinalReport`, HR can Accept / Reject / request Additional Meeting via an editable LLM letter sent into a human-only HR↔candidate dialog; both cabinets get a «Діалоги» tab.

**Architecture:** Prisma models `Dialog`, `DialogMessage`, `InterviewDecision`. Report endpoints generate a draft letter (LLM) and persist a decision that find-or-creates a `Dialog` and posts a `DECISION_LETTER` message. A separate dialogs router (auth for both roles) lists threads and accepts plain `USER` messages over REST. No Socket.IO, no email, no auto-created follow-up interview.

**Tech Stack:** Express + Prisma + `node:test` + tsx (backend), Vue 3 + Vue Router + TypeScript (frontend), existing `LlmProvider` factory.

**Spec:** `docs/superpowers/specs/2026-07-22-hr-decision-dialogs-design.md`

## Global Constraints

- UI and letter copy: Ukrainian.
- Decision types exactly: `ACCEPT` | `REJECT` | `ADDITIONAL_MEETING`.
- Message kinds exactly: `USER` | `DECISION_LETTER`.
- One `Dialog` per `(hrUserId, candidateUserId)` unique pair.
- Draft/decision require `Interview.candidateUserId`; if null → `400`.
- Additional meeting must **not** create an `Interview`.
- No email, Socket.IO, or unread-notification system in this plan.
- Follow TDD for backend; frontend has no unit test runner — verify with `npm run build` in `frontend/`.
- Register new backend test files in `backend/package.json` `test` script.
- Do not touch unrelated WIP (prep retry, playwright dumps, Day 14 reports, etc.).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Enums + `Dialog` + `DialogMessage` + `InterviewDecision` + User relations |
| `backend/prisma/migrations/<ts>_hr_decision_dialogs/migration.sql` | Migration |
| `backend/src/agents/prompts/decision-letter.uk.ts` | UK system prompt |
| `backend/src/agents/decision-letter-agent.ts` | Build messages + normalize plain-text letter |
| `backend/src/agents/decision-letter-agent.test.ts` | Unit tests for agent helpers |
| `backend/src/routes/reports.ts` | Extend GET; add draft + decisions; inject LLM |
| `backend/src/routes/reports.test.ts` | Tests for draft/decision + latestDecision |
| `backend/src/routes/dialogs.ts` | list/create/get/post messages |
| `backend/src/routes/dialogs.test.ts` | Dialogs authz + CRUD tests |
| `backend/src/server.ts` | Wire routers + LLM into reports |
| `frontend/src/api/reports.ts` | Draft/send decision + `latestDecision` type |
| `frontend/src/api/dialogs.ts` | Dialogs API client |
| `frontend/src/views/ReportView.vue` | Decision buttons + modal |
| `frontend/src/views/DialogListView.vue` | Shared list (HR + candidate) |
| `frontend/src/views/DialogThreadView.vue` | Shared thread + composer |
| `frontend/src/components/HrSidebar.vue` | Nav «Діалоги» |
| `frontend/src/components/CandidateSidebar.vue` | Nav «Діалоги» |
| `frontend/src/router/index.ts` | `/dialogs`, `/dialogs/:id`, `/candidate/dialogs`, `/candidate/dialogs/:id` |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_hr_decision_dialogs/migration.sql` (via `prisma migrate`)

**Interfaces:**
- Consumes: existing `User`, `Interview`, `FinalReport`
- Produces: Prisma models/enums usable as `InterviewDecisionType`, `DialogMessageKind`, `prisma.dialog`, `prisma.dialogMessage`, `prisma.interviewDecision`

- [ ] **Step 1: Add enums and models to `schema.prisma`**

After existing enums (near `HrNotificationType`), add:

```prisma
enum InterviewDecisionType {
  ACCEPT
  REJECT
  ADDITIONAL_MEETING
}

enum DialogMessageKind {
  USER
  DECISION_LETTER
}
```

On `User`, add relations:

```prisma
  dialogsAsHr        Dialog[]          @relation("HrDialogs")
  dialogsAsCandidate Dialog[]          @relation("CandidateDialogs")
  dialogMessages     DialogMessage[]   @relation("DialogMessageSender")
  interviewDecisions InterviewDecision[] @relation("HrInterviewDecisions")
```

On `Interview`, add:

```prisma
  decisions InterviewDecision[]
```

On `FinalReport`, add:

```prisma
  decisions InterviewDecision[]
```

Append new models:

```prisma
model Dialog {
  id              String          @id @default(cuid())
  hrUserId        String
  candidateUserId String
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  hrUser          User            @relation("HrDialogs", fields: [hrUserId], references: [id])
  candidateUser   User            @relation("CandidateDialogs", fields: [candidateUserId], references: [id])
  messages        DialogMessage[]

  @@unique([hrUserId, candidateUserId])
  @@index([hrUserId, updatedAt(sort: Desc)])
  @@index([candidateUserId, updatedAt(sort: Desc)])
}

model InterviewDecision {
  id              String                @id @default(cuid())
  interviewId     String
  finalReportId   String
  decidedByUserId String
  type            InterviewDecisionType
  letterBody      String
  dialogMessageId String?               @unique
  createdAt       DateTime              @default(now())

  interview     Interview      @relation(fields: [interviewId], references: [id])
  finalReport   FinalReport    @relation(fields: [finalReportId], references: [id])
  decidedBy     User           @relation("HrInterviewDecisions", fields: [decidedByUserId], references: [id])
  dialogMessage DialogMessage? @relation("DecisionLetterLink", fields: [dialogMessageId], references: [id])
  letterMessages DialogMessage[] @relation("MessageDecision")

  @@index([interviewId, createdAt(sort: Desc)])
  @@index([finalReportId])
}

model DialogMessage {
  id           String            @id @default(cuid())
  dialogId     String
  senderUserId String
  body         String
  kind         DialogMessageKind
  decisionId   String?
  createdAt    DateTime          @default(now())

  dialog   Dialog             @relation(fields: [dialogId], references: [id])
  sender   User               @relation("DialogMessageSender", fields: [senderUserId], references: [id])
  decision InterviewDecision? @relation("MessageDecision", fields: [decisionId], references: [id])
  linkedDecision InterviewDecision? @relation("DecisionLetterLink")

  @@index([dialogId, createdAt])
  @@index([decisionId])
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name hr_decision_dialogs
```

Expected: migration applied, client generated, no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add InterviewDecision, Dialog, DialogMessage"
```

---

### Task 2: Decision-letter LLM agent

**Files:**
- Create: `backend/src/agents/prompts/decision-letter.uk.ts`
- Create: `backend/src/agents/decision-letter-agent.ts`
- Create: `backend/src/agents/decision-letter-agent.test.ts`
- Modify: `backend/package.json` (`test` script — append `src/agents/decision-letter-agent.test.ts`)

**Interfaces:**
- Consumes: `LlmProvider.complete(messages, options?)`, report/vacancy/profile context
- Produces:
  - `export type DecisionLetterType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING"`
  - `export type DecisionLetterContext = { type; vacancyTitle; reportMarkdown; recommendation; matchScore; strengths: string[]; risks: string[]; companyProfileJson: string; candidateProfileJson: string }`
  - `export function buildDecisionLetterMessages(ctx: DecisionLetterContext): ChatMessage[]`
  - `export function normalizeDecisionLetter(raw: string): string` — strip fences/trim; throw if empty
  - `export async function generateDecisionLetter(provider: LlmProvider, ctx: DecisionLetterContext): Promise<string>`

- [ ] **Step 1: Write failing tests**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionLetterMessages,
  normalizeDecisionLetter,
} from "./decision-letter-agent";

test("buildDecisionLetterMessages includes type and vacancy", () => {
  const messages = buildDecisionLetterMessages({
    type: "REJECT",
    vacancyTitle: "Backend Engineer",
    reportMarkdown: "## Підсумок\nСлабко",
    recommendation: "REJECT",
    matchScore: 40,
    strengths: ["Комунікація"],
    risks: ["Немає досвіду Nest"],
    companyProfileJson: "{}",
    candidateProfileJson: "{}",
  });
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[1]?.content ?? "", /REJECT/);
  assert.match(messages[1]?.content ?? "", /Backend Engineer/);
});

test("normalizeDecisionLetter strips fences and rejects empty", () => {
  assert.equal(normalizeDecisionLetter("```\nПривіт\n```"), "Привіт");
  assert.throws(() => normalizeDecisionLetter("   "));
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && node --import tsx --test src/agents/decision-letter-agent.test.ts
```

Expected: module not found / FAIL.

- [ ] **Step 3: Implement prompt + agent**

`decision-letter.uk.ts` — system prompt that:
- writes a personal letter in Ukrainian for the given decision type;
- uses only provided report/profile facts;
- for `ADDITIONAL_MEETING`: explain need for clarification, do **not** invent a date/time, invite to agree details in the dialog;
- returns **plain text only** (no JSON, no markdown fences).

`decision-letter-agent.ts` — implement the interfaces above; `generateDecisionLetter` calls `provider.complete(messages)` then `normalizeDecisionLetter`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/agents/decision-letter-agent.test.ts
```

- [ ] **Step 5: Register in package.json test script and commit**

```bash
git add backend/src/agents/prompts/decision-letter.uk.ts \
  backend/src/agents/decision-letter-agent.ts \
  backend/src/agents/decision-letter-agent.test.ts \
  backend/package.json
git commit -m "feat: add decision-letter LLM agent"
```

---

### Task 3: Report decision endpoints + `latestDecision` on GET

**Files:**
- Modify: `backend/src/routes/reports.ts`
- Modify: `backend/src/routes/reports.test.ts`
- Modify: `backend/src/server.ts` — `createReportsRouter(() => prisma, getLlmProvider)`

**Interfaces:**
- Consumes: `generateDecisionLetter`, Prisma models from Task 1
- Produces HTTP:
  - `GET /api/reports/:id` → existing fields + `latestDecision: { id, type, createdAt } | null`
  - `POST /api/reports/:id/decisions/draft` body `{ type }` → `200 { type, body }` or `400`/`403`/`404`/`502`
  - `POST /api/reports/:id/decisions` body `{ type, letterBody }` → `201 { decision: { id, type, createdAt }, dialogId }`

**Shared helpers inside `reports.ts`:**

```typescript
const DECISION_TYPES = new Set(["ACCEPT", "REJECT", "ADDITIONAL_MEETING"]);

type DecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

function parseDecisionType(raw: unknown): DecisionType | null {
  return typeof raw === "string" && DECISION_TYPES.has(raw)
    ? (raw as DecisionType)
    : null;
}
```

Change factory signature:

```typescript
export function createReportsRouter(
  getPrisma: () => PrismaClient,
  getLlmProvider: () => LlmProvider,
): Router
```

- [ ] **Step 1: Write failing route tests (extend `reports.test.ts`)**

Cover at minimum:

1. `GET /reports/:id` returns `latestDecision: null` when none; returns latest when two exist.
2. `POST .../decisions/draft` with mock LLM returns `{ type, body }`.
3. draft without `candidateUserId` → `400`.
4. draft wrong HR → `403`.
5. `POST .../decisions` creates decision + dialog + `DECISION_LETTER` message; second decision reuses same `dialogId` and adds second message.
6. empty `letterBody` → `400`.
7. LLM throw on draft → `502`.

Use a fake prisma that tracks `interviewDecision`, `dialog`, `dialogMessage` arrays (mirror style of existing `makeFakePrisma` in the file). Fake LLM:

```typescript
const fakeLlm = {
  complete: async () => "Шановний кандидате, …",
};
```

Wire router as:

```typescript
app.use("/api", withUser(hr), createReportsRouter(() => fakePrisma as never, () => fakeLlm as never));
```

- [ ] **Step 2: Run targeted tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

- [ ] **Step 3: Implement handlers**

**GET `/reports/:id`:** include latest decision:

```typescript
const latest = await prisma.interviewDecision.findFirst({
  where: { interviewId: report.interviewId },
  orderBy: { createdAt: "desc" },
  select: { id: true, type: true, createdAt: true },
});
// attach latestDecision: latest
```

**POST `/reports/:id/decisions/draft`:**
1. Load report with `interview: { hrUserId, candidateUserId, vacancy, companyProfile via vacancy, candidateProfile }`
2. Authz: same as GET (`403` if not owner, `404` if missing)
3. If `!interview.candidateUserId` → `400 { error: "Candidate user required" }`
4. Parse `type`; invalid → `400`
5. `try { body = await generateDecisionLetter(...) } catch { 502 { error: "Failed to generate letter" } }`
6. `200 { type, body }`

**POST `/reports/:id/decisions`:**
1. Same load + authz + candidate check
2. Validate `type` + non-empty trimmed `letterBody`
3. Transaction:

```typescript
const result = await prisma.$transaction(async (tx) => {
  const decision = await tx.interviewDecision.create({
    data: {
      interviewId: report.interviewId,
      finalReportId: report.id,
      decidedByUserId: hrUserId,
      type,
      letterBody: letterBody.trim(),
    },
  });

  const existing = await tx.dialog.findUnique({
    where: {
      hrUserId_candidateUserId: {
        hrUserId,
        candidateUserId: report.interview.candidateUserId!,
      },
    },
  });

  const dialog =
    existing ??
    (await tx.dialog.create({
      data: {
        hrUserId,
        candidateUserId: report.interview.candidateUserId!,
      },
    }));

  const message = await tx.dialogMessage.create({
    data: {
      dialogId: dialog.id,
      senderUserId: hrUserId,
      body: letterBody.trim(),
      kind: "DECISION_LETTER",
      decisionId: decision.id,
    },
  });

  await tx.interviewDecision.update({
    where: { id: decision.id },
    data: { dialogMessageId: message.id },
  });

  await tx.dialog.update({
    where: { id: dialog.id },
    data: { updatedAt: new Date() },
  });

  return { decision, dialogId: dialog.id };
});
```

4. `201` with `{ decision: { id, type, createdAt }, dialogId }`

Do **not** create any `Interview` here.

- [ ] **Step 4: Update `server.ts`**

```typescript
app.use("/api", requireAuth, requireHr, createReportsRouter(() => prisma, getLlmProvider));
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts backend/src/server.ts
git commit -m "feat: HR decision draft and send on reports"
```

---

### Task 4: Dialogs REST API

**Files:**
- Create: `backend/src/routes/dialogs.ts`
- Create: `backend/src/routes/dialogs.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json` (append `src/routes/dialogs.test.ts` to `test`)

**Interfaces:**
- Consumes: Prisma `Dialog` / `DialogMessage`; `req.user` with `id` + `role`
- Produces:
  - `GET /api/dialogs` → `{ dialogs: Array<{ id, peer: { id, email }, lastMessage: { body, createdAt, kind } | null, updatedAt }> }`
  - `POST /api/dialogs` (HR only) `{ candidateUserId }` → `201` created or `200` existing `{ dialog: { id, hrUserId, candidateUserId } }`
  - `GET /api/dialogs/:id` → `{ dialog, messages: [...] }`
  - `POST /api/dialogs/:id/messages` `{ body }` → `201 { message }`

Mount with **both** roles:

```typescript
app.use("/api", requireAuth, createDialogsRouter(() => prisma));
```

(Place **before** or after HR-only routers; path `/dialogs` must not be shadowed.)

- [ ] **Step 1: Write failing tests**

Cases:

1. HR lists only own dialogs; candidate lists only own.
2. HR `POST /dialogs` with candidate who has an interview with that HR → creates; second call → `200` same id.
3. HR `POST /dialogs` with unrelated candidate → `400` or `403` (`Candidate not eligible`).
4. Candidate `POST /dialogs` → `403`.
5. Participant can `GET` thread and `POST` message (`kind: USER`).
6. Non-participant `GET`/`POST` → `404`.
7. Empty message body → `400`.

Eligible check for create:

```typescript
const eligible = await prisma.interview.findFirst({
  where: { hrUserId: req.user!.id, candidateUserId },
  select: { id: true },
});
// also accept VacancyApplication where vacancy.hrUserId === hr && candidateUserId
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

- [ ] **Step 3: Implement `createDialogsRouter`**

Key list query sketch:

```typescript
const where =
  req.user!.role === "HR"
    ? { hrUserId: req.user!.id }
    : { candidateUserId: req.user!.id };

const dialogs = await prisma.dialog.findMany({
  where,
  orderBy: { updatedAt: "desc" },
  include: {
    hrUser: { select: { id: true, email: true } },
    candidateUser: { select: { id: true, email: true } },
    messages: {
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { body: true, createdAt: true, kind: true },
    },
  },
});
```

Map `peer` to the other party. Truncate preview body to ~120 chars in the mapper if desired.

On `POST /:id/messages`: verify membership; trim body; create `USER` message; bump `dialog.updatedAt`.

Include on messages for thread GET:

```typescript
{
  id, senderUserId, body, kind, createdAt,
  decision: { type: true } // so UI can label DECISION_LETTER
}
```

(Use `include: { decision: { select: { type: true } } }`.)

- [ ] **Step 4: Wire server + run tests PASS**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/dialogs.ts backend/src/routes/dialogs.test.ts \
  backend/src/server.ts backend/package.json
git commit -m "feat: add HR/candidate dialogs REST API"
```

---

### Task 5: Frontend API clients

**Files:**
- Modify: `frontend/src/api/reports.ts`
- Create: `frontend/src/api/dialogs.ts`

**Interfaces:**
- Produces functions matching Task 3–4 response shapes

- [ ] **Step 1: Extend `reports.ts`**

```typescript
export type InterviewDecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

export type LatestDecision = {
  id: string;
  type: InterviewDecisionType;
  createdAt: string;
};

// Add to FinalReport:
latestDecision: LatestDecision | null;

export async function draftDecisionLetter(
  reportId: string,
  type: InterviewDecisionType,
): Promise<{ type: InterviewDecisionType; body: string }> {
  const response = await fetchWithAuth(`/api/reports/${reportId}/decisions/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  if (!response.ok) throw await parseError(response, "Не вдалося згенерувати лист");
  return (await response.json()) as { type: InterviewDecisionType; body: string };
}

export async function sendDecision(
  reportId: string,
  type: InterviewDecisionType,
  letterBody: string,
): Promise<{ decision: LatestDecision; dialogId: string }> {
  const response = await fetchWithAuth(`/api/reports/${reportId}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, letterBody }),
  });
  if (!response.ok) throw await parseError(response, "Не вдалося надіслати рішення");
  return (await response.json()) as {
    decision: LatestDecision;
    dialogId: string;
  };
}
```

Check `fetchWithAuth` signature in `frontend/src/api/client.ts` — pass the same options style other POSTs use.

- [ ] **Step 2: Create `dialogs.ts`**

```typescript
import { fetchWithAuth } from "./client";

export type DialogMessageKind = "USER" | "DECISION_LETTER";
export type InterviewDecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

export type DialogListItem = {
  id: string;
  peer: { id: string; email: string };
  lastMessage: { body: string; createdAt: string; kind: DialogMessageKind } | null;
  updatedAt: string;
};

export type DialogMessage = {
  id: string;
  senderUserId: string;
  body: string;
  kind: DialogMessageKind;
  createdAt: string;
  decisionType: InterviewDecisionType | null;
};

export async function fetchDialogs(): Promise<DialogListItem[]> { /* GET /api/dialogs */ }
export async function createDialog(candidateUserId: string): Promise<{ id: string }> { /* POST */ }
export async function fetchDialog(id: string): Promise<{
  dialog: { id: string; hrUserId: string; candidateUserId: string; peer: { id: string; email: string } };
  messages: DialogMessage[];
}> { /* GET /api/dialogs/:id — map decision?.type → decisionType */ }
export async function sendDialogMessage(id: string, body: string): Promise<DialogMessage> { /* POST */ }
```

Map backend `decision: { type }` → `decisionType` in the client for simpler Vue templates.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/reports.ts frontend/src/api/dialogs.ts
git commit -m "feat(fe): API clients for decisions and dialogs"
```

---

### Task 6: ReportView decision UI

**Files:**
- Modify: `frontend/src/views/ReportView.vue`

**Interfaces:**
- Consumes: `draftDecisionLetter`, `sendDecision`, `report.latestDecision`
- Produces: UX for three buttons → modal → send → link to dialog

- [ ] **Step 1: Add decision state + handlers in `<script setup>`**

```typescript
import { draftDecisionLetter, sendDecision, type InterviewDecisionType } from "../api/reports";

const DECISION_LABELS: Record<InterviewDecisionType, string> = {
  ACCEPT: "Прийняти",
  REJECT: "Відхилити",
  ADDITIONAL_MEETING: "Додаткова зустріч",
};

const modalOpen = ref(false);
const modalType = ref<InterviewDecisionType | null>(null);
const draftBody = ref("");
const modalState = ref<"loading" | "edit" | "error" | "sent">("loading");
const modalError = ref<string | null>(null);
const sentDialogId = ref<string | null>(null);

async function openDecision(type: InterviewDecisionType): Promise<void> {
  modalType.value = type;
  modalOpen.value = true;
  modalState.value = "loading";
  modalError.value = null;
  draftBody.value = "";
  sentDialogId.value = null;
  try {
    const draft = await draftDecisionLetter(reportId.value, type);
    draftBody.value = draft.body;
    modalState.value = "edit";
  } catch (error) {
    modalState.value = "error";
    modalError.value =
      error instanceof Error ? error.message : "Не вдалося згенерувати лист";
  }
}

async function submitDecision(): Promise<void> {
  if (!modalType.value) return;
  modalState.value = "loading";
  try {
    const result = await sendDecision(reportId.value, modalType.value, draftBody.value);
    sentDialogId.value = result.dialogId;
    if (report.value) report.value.latestDecision = result.decision;
    modalState.value = "sent";
  } catch (error) {
    modalState.value = "edit";
    modalError.value =
      error instanceof Error ? error.message : "Не вдалося надіслати";
  }
}
```

- [ ] **Step 2: Template — decision block + modal**

Place after summary/recommendation cards, before strengths/risks (or after markdown — prefer **before** markdown so actions are visible):

- Show current decision label if `report.latestDecision`
- Three buttons calling `openDecision`
- Modal overlay: loading text / textarea + Надіслати + Скасувати / error / success with `RouterLink :to="'/dialogs/' + sentDialogId"`

Keep styles consistent with existing report page tokens (`--border`, buttons like other HR views).

Dialog route for HR is `/dialogs/:id` (Task 7).

- [ ] **Step 3: Frontend build**

```bash
cd frontend && npm run build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ReportView.vue
git commit -m "feat(fe): decision letters on report page"
```

---

### Task 7: Dialogs tab (list + thread) for HR and Candidate

**Files:**
- Create: `frontend/src/views/DialogListView.vue`
- Create: `frontend/src/views/DialogThreadView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/components/HrSidebar.vue`
- Modify: `frontend/src/components/CandidateSidebar.vue`

**Interfaces:**
- Consumes: `fetchDialogs`, `createDialog`, `fetchDialog`, `sendDialogMessage`
- For HR «Новий діалог»: load candidates from existing interviews API (`fetchInterviews` / whatever `InterviewListView` uses) — unique `candidateUserId` + email; call `createDialog` then navigate

- [ ] **Step 1: Router**

Under HR layout children:

```typescript
{ path: "dialogs", name: "hr-dialogs", component: DialogListView },
{ path: "dialogs/:id", name: "hr-dialog", component: DialogThreadView },
```

Under candidate layout children:

```typescript
{ path: "dialogs", name: "candidate-dialogs", component: DialogListView },
{ path: "dialogs/:id", name: "candidate-dialog", component: DialogThreadView },
```

Same components; derive base path from `route.path.startsWith('/candidate')` → `/candidate/dialogs` vs `/dialogs`.

- [ ] **Step 2: `DialogListView.vue`**

- On mount: `fetchDialogs()`
- List rows → navigate to `${base}/${id}`
- If HR (`!isCandidate`): button «Новий діалог» opens simple select/modal of eligible candidates (from interviews with `candidateUserId`), then `createDialog` → push thread route
- Empty state: «Поки немає діалогів»

- [ ] **Step 3: `DialogThreadView.vue`**

- Load `fetchDialog(id)`
- Render messages; own messages aligned end (compare `senderUserId` to `auth` user id from existing auth helper/store — follow pattern in other views, e.g. how live room knows current user)
- `DECISION_LETTER`: show badge from `decisionType` (Прийнято / Відхилено / Додаткова зустріч)
- Composer: textarea + «Надіслати» → `sendDialogMessage` → append to local list
- Back link to list

- [ ] **Step 4: Sidebars**

HR — after Звіти:

```vue
<RouterLink to="/dialogs" class="nav-item" :class="{ active: isActive('/dialogs') }">
  Діалоги
</RouterLink>
```

Candidate — add similarly to `/candidate/dialogs`.

- [ ] **Step 5: Build**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/DialogListView.vue frontend/src/views/DialogThreadView.vue \
  frontend/src/router/index.ts \
  frontend/src/components/HrSidebar.vue frontend/src/components/CandidateSidebar.vue
git commit -m "feat(fe): dialogs tab for HR and candidate"
```

---

### Task 8: Verification sweep

**Files:** none new (run commands only)

- [ ] **Step 1: Backend full test suite**

```bash
cd backend && npm test
```

Expected: all green (including new agent + reports + dialogs).

- [ ] **Step 2: Frontend build**

```bash
cd frontend && npm run build
```

Expected: success.

- [ ] **Step 3: Manual smoke (if servers available)**

1. HR opens ended report → Accept → edit → send → opens dialog, letter visible.
2. Change to Reject → second letter in same dialog.
3. Additional meeting → letter only; no new interview row.
4. Candidate login → Діалоги → reply.
5. HR creates dialog manually from list.

- [ ] **Step 4: Final commit only if smoke left uncommitted fixes**

```bash
git status
# commit any leftover fixes with a clear message
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Models Dialog / DialogMessage / InterviewDecision | 1 |
| LLM draft letter UK | 2 |
| POST draft + POST decision + history | 3 |
| latest decision on report UI | 3 + 6 |
| Dialogs CRUD REST both roles | 4 |
| Manual create dialog (eligible candidates) | 4 + 7 |
| ReportView modal edit/send | 6 |
| Sidebar + list/thread both cabinets | 7 |
| No auto follow-up interview / no email / no socket | enforced in 3–4, out of scope |
| Backend tests | 2–4, 8 |
| Frontend smoke/build | 6–8 |

No intentional placeholders left. Types `InterviewDecisionType` / `DialogMessageKind` are consistent across tasks.
`)
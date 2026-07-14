# Candidate Dual-Channel Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR can invite a candidate via copyable code/link/message and optional in-cabinet `Invitation` (email), with optional `scheduledAt`, `/join?code=` deep link, and Accept/Decline on CandidateHome — without SMTP or touching AI/reports.

**Architecture:** Add Prisma `Invitation` + `Interview.scheduledAt`. HR create/patch endpoints manage invitations; candidate list/accept/decline reuse `canCandidateJoinInterview` / `maybeTransitionToReady`. Join cancels pending invitations. Frontend builds invite text/link locally; new public `/join` route redirects through candidate login.

**Tech Stack:** Express + Prisma + `node:test` (backend), Vue 3 + Vue Router + TypeScript (frontend). No SMTP.

**Spec:** `docs/superpowers/specs/2026-07-14-candidate-invitation-dual-channel-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | `InvitationStatus`, `Invitation`, `Interview.scheduledAt` |
| `backend/prisma/migrations/*` | Migration for new fields/table |
| `backend/src/utils/invitation.ts` | `normalizeEmail`, `cancelPendingInvitations`, `assertInviteableEmail` |
| `backend/src/utils/invitation.test.ts` | Unit tests for helpers |
| `backend/src/routes/interviews.ts` | Extend create/list/detail; PATCH schedule; PATCH invitation |
| `backend/src/routes/interviews.test.ts` | Fake prisma + invitation/schedule tests |
| `backend/src/routes/candidate-invitations.ts` | GET list, POST accept, POST decline |
| `backend/src/routes/candidate-invitations.test.ts` | Candidate invitation API tests |
| `backend/src/routes/candidate-interview.ts` | Cancel PENDING on successful join |
| `backend/src/routes/candidate-interview.test.ts` | Join cancels invitation |
| `backend/src/server.ts` | Mount candidate invitations router |
| `frontend/src/utils/invite-message.ts` | `buildInviteLink`, `buildInviteMessage` |
| `frontend/src/api/interviews.ts` | Types + create/patch helpers |
| `frontend/src/api/candidate-invitations.ts` | list/accept/decline |
| `frontend/src/components/CreateInterviewModal.vue` | email, schedule, copy buttons |
| `frontend/src/components/InviteCopyActions.vue` | Reusable copy code/link/text |
| `frontend/src/views/InterviewDetailView.vue` | Copy + email + schedule editors |
| `frontend/src/views/CandidateHomeView.vue` | Invitations section |
| `frontend/src/views/JoinInterviewView.vue` | `/join?code=` flow |
| `frontend/src/views/CandidateLoginView.vue` | Preserve redirect (already has); pass to register link |
| `frontend/src/views/CandidateRegisterView.vue` | `redirect` query after register |
| `frontend/src/router/index.ts` | Route `join` |
| `README.md` | Short invitation section |
| `backend/package.json` | Add new test files to `test` script |

---

### Task 1: Prisma schema — `Invitation` + `scheduledAt`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration via `npm --workspace backend run db:migrate`

- [ ] **Step 1: Update schema**

In `backend/prisma/schema.prisma`:

1. Add enum after `Recommendation`:

```prisma
enum InvitationStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
}
```

2. On `Interview`, add:

```prisma
  scheduledAt      DateTime?
  invitations      Invitation[]
```

3. Add model (before or after `FinalReport`):

```prisma
model Invitation {
  id          String           @id @default(cuid())
  interviewId String
  email       String
  status      InvitationStatus @default(PENDING)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  interview   Interview        @relation(fields: [interviewId], references: [id], onDelete: Cascade)

  @@index([email, status])
  @@index([interviewId, status])
}
```

4. On `Interview` delete path in `interviews.ts`: cascade handles invitations — no manual delete needed if `onDelete: Cascade`.

- [ ] **Step 2: Migrate**

Run:

```bash
cd /Users/iruna/interview-platform-1/backend && npx prisma migrate dev --name invitation_and_scheduled_at
```

Expected: migration applied, client generated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add Invitation model and Interview.scheduledAt"
```

---

### Task 2: Invitation helpers (TDD)

**Files:**
- Create: `backend/src/utils/invitation.ts`
- Create: `backend/src/utils/invitation.test.ts`
- Modify: `backend/package.json` (`test` script — append `src/utils/invitation.test.ts`)

- [ ] **Step 1: Write failing tests**

Create `backend/src/utils/invitation.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, isValidEmailFormat } from "./invitation";

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Anna@Mail.COM "), "anna@mail.com");
});

test("isValidEmailFormat accepts simple emails", () => {
  assert.equal(isValidEmailFormat("a@b.co"), true);
  assert.equal(isValidEmailFormat("not-an-email"), false);
  assert.equal(isValidEmailFormat(""), false);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/iruna/interview-platform-1/backend && node --import tsx --test src/utils/invitation.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement helpers**

Create `backend/src/utils/invitation.ts`:

```typescript
import type { PrismaClient, Prisma } from "@prisma/client";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lightweight format check — not full RFC. */
export function isValidEmailFormat(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export type InviteEmailCheck =
  | { ok: true; email: string }
  | { ok: false; error: string; status: 400 };

export async function assertInviteableEmail(
  prisma: PrismaClient | Prisma.TransactionClient,
  rawEmail: string,
): Promise<InviteEmailCheck> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmailFormat(email)) {
    return { ok: false, error: "Invalid email", status: 400 };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.role !== "CANDIDATE") {
    return { ok: false, error: "Email belongs to a non-candidate user", status: 400 };
  }
  return { ok: true, email };
}

export async function cancelPendingInvitations(
  prisma: PrismaClient | Prisma.TransactionClient,
  interviewId: string,
): Promise<void> {
  await prisma.invitation.updateMany({
    where: { interviewId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}
```

- [ ] **Step 4: Run tests — PASS; add to package.json test script**

Append `src/utils/invitation.test.ts` after `joinCode.test.ts` in `backend/package.json` `test` script.

```bash
node --import tsx --test src/utils/invitation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/invitation.ts backend/src/utils/invitation.test.ts backend/package.json
git commit -m "feat: add invitation email helpers"
```

---

### Task 3: Extend `POST /interviews` — email + scheduledAt

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`

- [ ] **Step 1: Extend fake prisma + add failing tests**

In `interviews.test.ts`:

1. Extend `FakeInterview` with `scheduledAt: Date | null` and `candidateUserId?: string | null`.
2. Extend `CreateInput.data` with optional `scheduledAt?: Date | null`.
3. On create, persist `scheduledAt` from input.
4. Add `user.findUnique` and `invitation` (`create`, `findFirst`, `updateMany`, `create` in array store).
5. Add `$transaction` that runs callback with same fake client.

Add tests (pattern like existing `postInterview`):

```typescript
test("POST /interviews without email returns invitation null and null scheduledAt", async () => {
  // assert body.interview.invitation === null
  // assert body.interview.scheduledAt === null
});

test("POST /interviews with candidateEmail creates PENDING invitation", async () => {
  // body: { vacancyId, candidateEmail: "Anna@Mail.com" }
  // assert invitation.email === "anna@mail.com", status PENDING
});

test("POST /interviews with scheduledAt stores ISO date", async () => {
  // scheduledAt: "2026-07-15T14:00:00.000Z"
});

test("POST /interviews rejects invalid email with 400", async () => { /* ... */ });

test("POST /interviews rejects HR email with 400", async () => {
  // seed user role HR with that email in fakePrisma.user
});
```

Update helper:

```typescript
async function postInterview(
  port: number,
  vacancyId: string,
  extra: { candidateEmail?: string; scheduledAt?: string } = {},
) {
  return fetch(`http://127.0.0.1:${port}/api/interviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vacancyId, ...extra }),
  });
}
```

- [ ] **Step 2: Run targeted tests — FAIL**

```bash
cd /Users/iruna/interview-platform-1/backend && node --import tsx --test src/routes/interviews.test.ts
```

Expected: new tests FAIL (response missing fields / ignore email).

- [ ] **Step 3: Implement create changes**

In `interviews.ts`:

```typescript
import {
  assertInviteableEmail,
  cancelPendingInvitations,
} from "../utils/invitation";

type CreateBody = {
  vacancyId?: unknown;
  candidateEmail?: unknown;
  scheduledAt?: unknown;
};

function parseOptionalScheduledAt(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}

function serializeInvitation(
  inv: { id: string; email: string; status: string } | null | undefined,
) {
  if (!inv) return null;
  return { id: inv.id, email: inv.email, status: inv.status };
}
```

Rewrite create success path to use `$transaction`:

1. Parse `candidateEmail` (optional string) and `scheduledAt`.
2. If email provided → `assertInviteableEmail`; on failure return status/error.
3. If scheduledAt `"invalid"` → `400 { error: "Invalid scheduledAt" }`.
4. Create interview with `scheduledAt`.
5. If email → `invitation.create({ interviewId, email, status: "PENDING" })`.
6. Response include `scheduledAt: interview.scheduledAt?.toISOString() ?? null`, `invitation: serializeInvitation(...)`.

Also update GET mine/detail responses in the same task or Task 5 — **do list/detail serialization here too** so types stay consistent:

- Include pending invitation: `invitations: { where: { status: "PENDING" }, take: 1 }` or `findFirst`.
- Add `scheduledAt` and `invitation` to mapped JSON.

- [ ] **Step 4: Run interviews tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts
git commit -m "feat: create interview with optional invitation and scheduledAt"
```

---

### Task 4: `PATCH /interviews/:id` (schedule) and `PATCH /interviews/:id/invitation`

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
test("PATCH /interviews/:id updates scheduledAt", async () => { /* 200 */ });
test("PATCH /interviews/:id rejects ENDED with 409", async () => { /* ... */ });
test("PATCH /interviews/:id/invitation sets PENDING email", async () => { /* ... */ });
test("PATCH /interviews/:id/invitation replaces previous PENDING", async () => {
  // old → CANCELLED, new PENDING
});
test("PATCH /interviews/:id/invitation with null cancels PENDING", async () => { /* ... */ });
test("PATCH invitation when candidate already joined returns 409", async () => { /* ... */ });
```

Fake needs `interview.update`, `invitation.updateMany`/`create`/`findFirst`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

Register **before** `DELETE /interviews/:id` and `/end` where needed (Express order: more specific `/invitation` before generic if both use `:id`).

```typescript
router.patch("/interviews/:id/invitation", async (req, res) => {
  // ownership; status AWAITING_CANDIDATE or READY; !candidateUserId
  // body.candidateEmail: string | null
  // null → cancelPendingInvitations
  // string → assertInviteableEmail, cancelPending, create PENDING
});

router.patch("/interviews/:id", async (req, res) => {
  // only scheduledAt key in MVP
  // status must be AWAITING_CANDIDATE | READY
});
```

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat: add HR PATCH invitation and scheduledAt"
```

---

### Task 5: Candidate invitations API

**Files:**
- Create: `backend/src/routes/candidate-invitations.ts`
- Create: `backend/src/routes/candidate-invitations.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Failing tests**

Create `candidate-invitations.test.ts` mirroring `candidate-interview.test.ts` (express + withUser CANDIDATE + fake prisma).

```typescript
test("GET /candidate/invitations returns PENDING for matching email", async () => {});
test("GET /candidate/invitations ignores other emails and non-PENDING", async () => {});
test("POST accept binds candidate and sets ACCEPTED", async () => {});
test("POST accept returns 409 when questionnaire not confirmed", async () => {
  // same error as join — wire canCandidateJoinInterview
});
test("POST decline sets DECLINED", async () => {});
test("POST accept of another user invitation returns 404", async () => {});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement router**

`backend/src/routes/candidate-invitations.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  canCandidateJoinInterview,
  maybeTransitionToReady,
} from "../utils/interview-readiness";
import { cancelPendingInvitations, normalizeEmail } from "../utils/invitation";

export function createCandidateInvitationsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/invitations", async (req, res) => {
    const email = normalizeEmail(req.user!.email);
    const list = await getPrisma().invitation.findMany({
      where: { email, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { interview: { select: { id: true, displayName: true, scheduledAt: true } } },
    });
    res.json({
      invitations: list.map((i) => ({
        id: i.id,
        interviewId: i.interview.id,
        displayName: i.interview.displayName,
        scheduledAt: i.interview.scheduledAt?.toISOString() ?? null,
        status: i.status,
      })),
    });
  });

  router.post("/invitations/:id/accept", async (req, res) => {
    // find invitation; email match + PENDING else 404
    // load interview; canCandidateJoinInterview
    // transaction: update candidateUserId if needed; invitation ACCEPTED; cancel other pending
    // maybeTransitionToReady
    // return { interview: { id, displayName, status, ... } } same shape as join
  });

  router.post("/invitations/:id/decline", async (req, res) => {
    // PENDING + email match → DECLINED; 200 { invitation: { id, status: "DECLINED" } }
  });

  return router;
}
```

In `server.ts` (alongside candidate interview):

```typescript
app.use("/api/candidate", requireAuth, requireCandidate, createCandidateInvitationsRouter(() => prisma));
```

Check how `createCandidateInterviewRouter` is mounted — if it already has auth middleware outside, match that pattern exactly from `server.ts`.

- [ ] **Step 4: Tests PASS; register in package.json test script; commit**

```bash
git commit -m "feat: add candidate invitations list accept decline API"
```

---

### Task 6: Join cancels PENDING invitations

**Files:**
- Modify: `backend/src/routes/candidate-interview.ts`
- Modify: `backend/src/routes/candidate-interview.test.ts`

- [ ] **Step 1: Failing test**

```typescript
test("POST /candidate/interview/join cancels PENDING invitation", async () => {
  // seed interview + PENDING invitation
  // join successfully
  // assert invitation.status === "CANCELLED"
});
```

Extend fake prisma with `invitation.updateMany`.

- [ ] **Step 2: Implement**

After successful bind in join handler:

```typescript
await cancelPendingInvitations(prisma, interview.id);
```

Call even on idempotent re-join (safe no-op if none pending).

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "feat: cancel pending invitation when candidate joins by code"
```

---

### Task 7: Frontend invite helpers + API clients

**Files:**
- Create: `frontend/src/utils/invite-message.ts`
- Modify: `frontend/src/api/interviews.ts`
- Create: `frontend/src/api/candidate-invitations.ts`

- [ ] **Step 1: Invite message helpers**

```typescript
export function buildInviteLink(origin: string, joinCode: string): string {
  const code = joinCode.trim().toUpperCase();
  return `${origin.replace(/\/$/, "")}/join?code=${encodeURIComponent(code)}`;
}

export function formatScheduledAtUk(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function buildInviteMessage(input: {
  displayName: string;
  joinCode: string;
  origin: string;
  scheduledAt?: string | null;
}): string {
  const link = buildInviteLink(input.origin, input.joinCode);
  const time = formatScheduledAtUk(input.scheduledAt ?? null);
  const lines = [
    `Вас запрошено на співбесіду «${input.displayName}».`,
    `Код: ${input.joinCode}`,
    `Посилання: ${link}`,
  ];
  if (time) lines.push(`Час: ${time}`);
  return lines.join("\n");
}
```

- [ ] **Step 2: Extend `interviews.ts`**

```typescript
export type InterviewInvitation = {
  id: string;
  email: string;
  status: string;
};

export type InterviewSummary = {
  // existing fields...
  scheduledAt: string | null;
  invitation: InterviewInvitation | null;
};

export type CreatedInterview = {
  id: string;
  vacancyId: string;
  displayName: string;
  joinCode: string;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  invitation: InterviewInvitation | null;
};

export async function createInterview(
  vacancyId: string,
  options?: { candidateEmail?: string; scheduledAt?: string | null },
): Promise<CreatedInterview> {
  const response = await fetchWithAuth("/api/interviews", {
    method: "POST",
    body: JSON.stringify({
      vacancyId,
      ...(options?.candidateEmail ? { candidateEmail: options.candidateEmail } : {}),
      ...(options?.scheduledAt !== undefined
        ? { scheduledAt: options.scheduledAt }
        : {}),
    }),
  });
  // ...
}

export async function updateInterviewSchedule(
  id: string,
  scheduledAt: string | null,
): Promise<InterviewDetail> { /* PATCH /api/interviews/:id */ }

export async function updateInterviewInvitation(
  id: string,
  candidateEmail: string | null,
): Promise<{ invitation: InterviewInvitation | null }> {
  /* PATCH /api/interviews/:id/invitation */
}
```

- [ ] **Step 3: `candidate-invitations.ts`**

```typescript
export type CandidateInvitation = {
  id: string;
  interviewId: string;
  displayName: string;
  scheduledAt: string | null;
  status: string;
};

export async function fetchMyInvitations(): Promise<CandidateInvitation[]> { /* GET */ }
export async function acceptInvitation(id: string): Promise<CandidateInterview> { /* POST accept — reuse CandidateInterview type from candidate-interview.ts */ }
export async function declineInvitation(id: string): Promise<void> { /* POST decline */ }
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add frontend invitation API clients and invite message helpers"
```

---

### Task 8: `InviteCopyActions` + `CreateInterviewModal`

**Files:**
- Create: `frontend/src/components/InviteCopyActions.vue`
- Modify: `frontend/src/components/CreateInterviewModal.vue`

- [ ] **Step 1: `InviteCopyActions.vue`**

Props: `joinCode`, `displayName`, `scheduledAt: string | null`.

Buttons (UK): «Скопіювати код», «Скопіювати посилання», «Скопіювати текст запрошення».

Use `navigator.clipboard.writeText`; on failure set local `copyError` «Не вдалося скопіювати». Brief success hint optional (`copied: 'code' | 'link' | 'text' | null`).

`origin` = `window.location.origin`.

- [ ] **Step 2: Update create modal form**

- Fields: vacancy select (existing) + optional email input + optional `datetime-local` for schedule.
- Convert datetime-local → ISO via `new Date(value).toISOString()` before POST (document timezone = browser local).
- `createInterview(selectedVacancyId, { candidateEmail, scheduledAt })`.

- [ ] **Step 3: Success step UI**

Replace single code display with:

- join code (large)
- formatted scheduledAt if present
- `<InviteCopyActions ... />`
- if `createdInterview.invitation`: «Запрошення: {email} · очікує»
- Close / Далі unchanged

- [ ] **Step 4: `npm --workspace frontend run lint` PASS; commit**

```bash
git commit -m "feat: HR create modal invite copy actions and optional email"
```

---

### Task 9: `InterviewDetailView` — copy, email, schedule

**Files:**
- Modify: `frontend/src/views/InterviewDetailView.vue`

- [ ] **Step 1: UI blocks**

Below meta:

1. `<InviteCopyActions>` when interview loaded.
2. Schedule editor: `datetime-local` + Save → `updateInterviewSchedule`.
3. Invitation block if `!candidate` / status allows:
   - if `invitation`: show email + «Замінити» / «Скасувати»
   - else: email input + «Запросити»
   - call `updateInterviewInvitation`

Reload interview after mutations.

Show `scheduledAt` formatted with `formatScheduledAtUk`.

- [ ] **Step 2: lint + commit**

```bash
git commit -m "feat: manage invitation and schedule on interview detail"
```

---

### Task 10: CandidateHome invitations

**Files:**
- Modify: `frontend/src/views/CandidateHomeView.vue`

- [ ] **Step 1: Load invitations in `loadDashboard`**

```typescript
import {
  fetchMyInvitations,
  acceptInvitation,
  declineInvitation,
  type CandidateInvitation,
} from "../api/candidate-invitations";
import { formatScheduledAtUk } from "../utils/invite-message";

const invitations = ref<CandidateInvitation[]>([]);
// in loadDashboard: invitations.value = await fetchMyInvitations();
```

- [ ] **Step 2: Template section «Запрошення»**

For each invitation: displayName, optional time, buttons Прийняти / Відхилити.

Accept:

- Call `acceptInvitation`; on success mirror `onJoined` (set interview, banner, reload).
- Map 409 errors like join modal (reuse messages from `JoinInterviewModal` / `candidate-interview.ts`).

Decline: confirm optional; call API; remove from list.

Keep existing join modal CTA.

- [ ] **Step 3: lint + commit**

```bash
git commit -m "feat: show Accept/Decline invitations on candidate home"
```

---

### Task 11: `/join` route + auth redirect

**Files:**
- Create: `frontend/src/views/JoinInterviewView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/views/CandidateLoginView.vue` (register link with redirect)
- Modify: `frontend/src/views/CandidateRegisterView.vue`

- [ ] **Step 1: Add route (public)**

In `router/index.ts` (top-level, no auth meta):

```typescript
{
  path: "/join",
  name: "join",
  component: () => import("../views/JoinInterviewView.vue"),
},
```

- [ ] **Step 2: `JoinInterviewView.vue` logic**

On mount:

1. Read `code` from query (string); if missing → show «Код не вказано».
2. If `!auth.token` → `router.replace({ name: 'candidate-login', query: { redirect: `/join?code=${code}` } })`.
3. If `auth.user.role === 'HR'` → show «Увійдіть як кандидат» + link to candidate login with same redirect (do not auto-join).
4. If CANDIDATE → `joinInterviewByCode(code)`; success → `candidate-home` with optional query `joined=1` or use store/banner via sessionStorage; failure → show error + link to home / manual join.

- [ ] **Step 3: Register preserves redirect**

`CandidateLoginView`: change register `RouterLink` to include `redirect` query when present.

`CandidateRegisterView`: read `route.query.redirect`, after success `push(sanitizeRedirect(...))` (copy sanitize helper or share tiny util).

- [ ] **Step 4: lint + commit**

```bash
git commit -m "feat: add /join deep link with login redirect and auto-join"
```

---

### Task 12: README + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add short section** (after Day 8 Create Interview Quick Start or Day 14 join)

Title e.g. `### Candidate invitation (dual channel)`.

Cover:

- External: copy code / `/join?code=` / invite text (no SMTP)
- Cabinet: optional `candidateEmail` → `Invitation` PENDING; Accept/Decline
- Optional `scheduledAt`
- Endpoints list (POST interviews extras, PATCH invitation/schedule, GET/accept/decline invitations)
- Manual checklist: create with email; copy text; register new user; see invitation; accept; join-by-link cancels pending

- [ ] **Step 2: Run full verification**

```bash
cd /Users/iruna/interview-platform-1/backend && npm test
cd /Users/iruna/interview-platform-1/frontend && npm run build
```

Expected: all tests PASS; frontend build PASS.

Fix any failures before claiming done.

- [ ] **Step 3: Commit README**

```bash
git commit -m "docs: add dual-channel candidate invitation quick start"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `Invitation` model + statuses | 1 |
| `scheduledAt` on Interview | 1, 3, 4 |
| Optional email on create | 3, 8 |
| Copy code/link/text (no SMTP) | 7, 8, 9 |
| `/join?code=` login → auto-join | 11 |
| Manual code entry kept | 10 (existing modal) |
| Pending for unknown email → appears after register | 5 + 11 register redirect |
| Accept = join rules | 5 |
| Decline → DECLINED, meeting live | 5 |
| Join cancels PENDING | 6 |
| Max one PENDING / replace on detail | 4, 9 |
| HR PATCH email + schedule | 4, 9 |
| Tests | 2–6, 12 |
| README | 12 |
| No AI / reports changes | — (do not touch) |

## Placeholder / consistency notes

- Email field name: always `candidateEmail` in API bodies; stored/normalized as `Invitation.email`.
- Invitation list path: `/api/candidate/invitations` under same auth mount as other candidate routes.
- Frontend has no unit test runner — verify helpers via TypeScript build; backend owns behavioral tests.

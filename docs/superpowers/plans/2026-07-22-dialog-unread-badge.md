# Dialog Unread Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show unread message counts on the «Діалоги» nav tab (HR + candidate) and on each row in the dialog list; opening a thread marks messages as read.

**Architecture:** Add `hrLastReadAt` / `candidateLastReadAt` cursors on `Dialog`. Unread = messages from the other party with `createdAt > lastReadAt` (or all foreign messages if cursor is `null`). Extend `GET /dialogs` with per-dialog `unreadCount`; add `GET /dialogs/unread-count` and `POST /dialogs/:id/read`. Frontend polls the total every 45s via a shared composable and shows pill badges in sidebars and the list.

**Tech Stack:** Express + Prisma + `node:test` + tsx (backend), Vue 3 + Vue Router + TypeScript (frontend).

**Spec:** `docs/superpowers/specs/2026-07-22-dialog-unread-badge-design.md`

## Global Constraints

- UI copy: Ukrainian.
- Count **messages**, not dialogs.
- Mark-as-read only when opening a thread (`POST .../read`), not when opening the list.
- Badge on sidebar **and** per-dialog list row.
- Polling interval: **45 seconds**; polling errors must not break navigation.
- Sidebar badge display: if count > 99 show `99+`.
- Own messages never count as unread; `DECISION_LETTER` counts for the recipient.
- No Socket.IO, email, push, or per-message receipts.
- Follow TDD for backend route changes.
- Frontend unit tests via `node --import tsx --test` (register new files in `frontend/package.json` `test` script); also `npm run build` in `frontend/`.
- Do not touch unrelated WIP (`.playwright-mcp/`, Day 14 reports, prep/VacancyPrep unrelated edits, etc.).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Add `hrLastReadAt`, `candidateLastReadAt` on `Dialog` |
| `backend/prisma/migrations/<ts>_dialog_unread_cursors/migration.sql` | Migration |
| `backend/src/routes/dialogs.ts` | Unread helpers; extend list; add unread-count + read |
| `backend/src/routes/dialogs.test.ts` | Fake Prisma + unread/mark-read/total tests |
| `frontend/src/api/dialogs.ts` | `unreadCount` type + `fetchDialogUnreadCount` + `markDialogRead` |
| `frontend/src/composables/useDialogUnread.ts` | Shared total + polling + `formatUnreadBadge` |
| `frontend/src/composables/useDialogUnread.test.ts` | Unit tests for badge format + refresh/mark wiring |
| `frontend/src/layouts/HrLayout.vue` | Start/stop unread polling |
| `frontend/src/layouts/CandidateLayout.vue` | Start/stop unread polling |
| `frontend/src/components/HrSidebar.vue` | Nav badge |
| `frontend/src/components/CandidateSidebar.vue` | Nav badge |
| `frontend/src/views/DialogListView.vue` | Per-row badge |
| `frontend/src/views/DialogThreadView.vue` | Call mark-read after successful load |
| `frontend/package.json` | Register `useDialogUnread.test.ts` in `test` script |

---

### Task 1: Prisma cursors + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_dialog_unread_cursors/migration.sql` (via `prisma migrate`)

**Interfaces:**
- Consumes: existing `Dialog` model
- Produces: `Dialog.hrLastReadAt: DateTime?`, `Dialog.candidateLastReadAt: DateTime?`

- [ ] **Step 1: Update `Dialog` in `schema.prisma`**

Inside `model Dialog`, add after `updatedAt`:

```prisma
  hrLastReadAt        DateTime?
  candidateLastReadAt DateTime?
```

- [ ] **Step 2: Create and apply migration**

Run from `backend/`:

```bash
npx prisma migrate dev --name dialog_unread_cursors
```

Expected: migration folder created; client generated; migrate succeeds against local DB.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/*_dialog_unread_cursors/
git commit -m "feat(db): add dialog unread read cursors"
```

---

### Task 2: Unread helpers + `GET /dialogs` returns `unreadCount`

**Files:**
- Modify: `backend/src/routes/dialogs.ts`
- Modify: `backend/src/routes/dialogs.test.ts`
- Test: `backend/src/routes/dialogs.test.ts`

**Interfaces:**
- Consumes: `Dialog.hrLastReadAt`, `Dialog.candidateLastReadAt`, `prisma.dialogMessage.count`
- Produces: list items include `unreadCount: number`; helpers `lastReadAtForUser`, `countUnreadMessages`

- [ ] **Step 1: Extend fake Prisma + write failing tests**

In `dialogs.test.ts`:

1. Add to `FakeDialog`:

```typescript
  hrLastReadAt: Date | null;
  candidateLastReadAt: Date | null;
```

2. Set both to `null` in every existing seed dialog / `create` path.

3. Extend `dialog.update` to also apply `hrLastReadAt` / `candidateLastReadAt` when present in `data`.

4. Add `dialogMessage.count`:

```typescript
count: async ({
  where,
}: {
  where: {
    dialogId: string;
    senderUserId?: { not: string };
    createdAt?: { gt: Date };
  };
}) => {
  return messages.filter((m) => {
    if (m.dialogId !== where.dialogId) return false;
    if (where.senderUserId?.not != null && m.senderUserId === where.senderUserId.not) {
      return false;
    }
    if (where.createdAt?.gt != null && !(m.createdAt > where.createdAt.gt)) {
      return false;
    }
    return true;
  }).length;
},
```

5. Add tests (after existing list tests):

```typescript
test("GET /dialogs includes unreadCount for foreign messages only", async () => {
  const { server, port } = await startServer(
    { role: "HR", id: "hr_1" },
    {
      users: [
        { id: "hr_1", email: "hr@test.com", role: "HR" },
        { id: "cand_1", email: "cand@test.com", role: "CANDIDATE" },
      ],
      dialogs: [
        {
          id: "dlg_1",
          hrUserId: "hr_1",
          candidateUserId: "cand_1",
          createdAt: new Date("2026-07-14T10:00:00.000Z"),
          updatedAt: new Date("2026-07-14T12:00:00.000Z"),
          hrLastReadAt: null,
          candidateLastReadAt: null,
        },
      ],
      messages: [
        {
          id: "msg_own",
          dialogId: "dlg_1",
          senderUserId: "hr_1",
          body: "from hr",
          kind: "USER",
          decisionId: null,
          createdAt: new Date("2026-07-14T11:00:00.000Z"),
        },
        {
          id: "msg_1",
          dialogId: "dlg_1",
          senderUserId: "cand_1",
          body: "hi",
          kind: "USER",
          decisionId: null,
          createdAt: new Date("2026-07-14T11:30:00.000Z"),
        },
        {
          id: "msg_2",
          dialogId: "dlg_1",
          senderUserId: "cand_1",
          body: "again",
          kind: "USER",
          decisionId: null,
          createdAt: new Date("2026-07-14T11:45:00.000Z"),
        },
      ],
    },
  );
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      dialogs: Array<{ id: string; unreadCount: number }>;
    };
    assert.equal(body.dialogs[0]?.unreadCount, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("GET /dialogs unreadCount respects hrLastReadAt cursor", async () => {
  const { server, port } = await startServer(
    { role: "HR", id: "hr_1" },
    {
      users: [
        { id: "hr_1", email: "hr@test.com", role: "HR" },
        { id: "cand_1", email: "cand@test.com", role: "CANDIDATE" },
      ],
      dialogs: [
        {
          id: "dlg_1",
          hrUserId: "hr_1",
          candidateUserId: "cand_1",
          createdAt: new Date("2026-07-14T10:00:00.000Z"),
          updatedAt: new Date("2026-07-14T12:00:00.000Z"),
          hrLastReadAt: new Date("2026-07-14T11:40:00.000Z"),
          candidateLastReadAt: null,
        },
      ],
      messages: [
        {
          id: "msg_old",
          dialogId: "dlg_1",
          senderUserId: "cand_1",
          body: "old",
          kind: "USER",
          decisionId: null,
          createdAt: new Date("2026-07-14T11:30:00.000Z"),
        },
        {
          id: "msg_new",
          dialogId: "dlg_1",
          senderUserId: "cand_1",
          body: "new",
          kind: "USER",
          decisionId: null,
          createdAt: new Date("2026-07-14T11:50:00.000Z"),
        },
      ],
    },
  );
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    const body = (await response.json()) as {
      dialogs: Array<{ unreadCount: number }>;
    };
    assert.equal(body.dialogs[0]?.unreadCount, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
```

Adapt seed shapes to match whatever helpers (`baseDialog`, etc.) already exist — keep fields consistent.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: FAIL because `unreadCount` is missing from list response (or assertion fails).

- [ ] **Step 3: Implement helpers + list unreadCount**

In `dialogs.ts`, add:

```typescript
function lastReadAtForUser(
  dialog: { hrUserId: string; hrLastReadAt: Date | null; candidateLastReadAt: Date | null },
  userId: string,
): Date | null {
  return dialog.hrUserId === userId ? dialog.hrLastReadAt : dialog.candidateLastReadAt;
}

async function countUnreadMessages(
  prisma: PrismaClient,
  dialogId: string,
  currentUserId: string,
  lastReadAt: Date | null,
): Promise<number> {
  return prisma.dialogMessage.count({
    where: {
      dialogId,
      senderUserId: { not: currentUserId },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  });
}
```

In `GET /dialogs`, after loading dialogs, for each dialog compute:

```typescript
const unreadCount = await countUnreadMessages(
  prisma,
  dialog.id,
  req.user!.id,
  lastReadAtForUser(dialog, req.user!.id),
);
```

Include `unreadCount` in the mapped JSON object. Ensure `findMany` selects/returns the new cursor fields (they come from the model by default).

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: PASS (including previous dialog tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/dialogs.ts backend/src/routes/dialogs.test.ts
git commit -m "feat(api): include unreadCount on dialog list"
```

---

### Task 3: `GET /dialogs/unread-count` + `POST /dialogs/:id/read`

**Files:**
- Modify: `backend/src/routes/dialogs.ts`
- Modify: `backend/src/routes/dialogs.test.ts`
- Test: `backend/src/routes/dialogs.test.ts`

**Interfaces:**
- Consumes: helpers from Task 2
- Produces:
  - `GET /api/dialogs/unread-count` → `{ unreadCount: number }`
  - `POST /api/dialogs/:id/read` → `{ ok: true }`

- [ ] **Step 1: Write failing tests**

```typescript
test("GET /dialogs/unread-count sums unread across dialogs", async () => {
  // seed two dialogs for HR with 2 + 1 foreign unread messages
  // assert body.unreadCount === 3
});

test("POST /dialogs/:id/read clears unread for participant", async () => {
  // seed dialog with 2 foreign messages, hrLastReadAt null
  // POST /api/dialogs/dlg_1/read → 200 { ok: true }
  // GET /api/dialogs → unreadCount === 0
});

test("POST /dialogs/:id/read returns 404 for non-participant", async () => {
  // auth as unrelated user / other HR
  // expect 404
});

test("GET /dialogs/unread-count for candidate uses candidateLastReadAt", async () => {
  // auth as candidate; DECISION_LETTER from HR counts; after candidate read, total 0
});
```

Fill in concrete seeds mirroring Task 2 style and existing `startServer` helper.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: FAIL (404 / missing routes).

- [ ] **Step 3: Implement routes**

**Important:** register `GET /dialogs/unread-count` **before** `GET /dialogs/:id`.

```typescript
router.get("/dialogs/unread-count", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const where =
    req.user!.role === "HR"
      ? { hrUserId: req.user!.id }
      : { candidateUserId: req.user!.id };

  const dialogs = await prisma.dialog.findMany({
    where,
    select: {
      id: true,
      hrUserId: true,
      hrLastReadAt: true,
      candidateLastReadAt: true,
    },
  });

  let unreadCount = 0;
  for (const dialog of dialogs) {
    unreadCount += await countUnreadMessages(
      prisma,
      dialog.id,
      req.user!.id,
      lastReadAtForUser(dialog, req.user!.id),
    );
  }

  res.status(200).json({ unreadCount });
});

router.post("/dialogs/:id/read", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const dialog = await prisma.dialog.findUnique({ where: { id: req.params.id } });
  if (!dialog || !isParticipant(dialog, req.user!.id)) {
    res.status(404).json({ error: "Dialog not found" });
    return;
  }

  const now = new Date();
  const data =
    dialog.hrUserId === req.user!.id
      ? { hrLastReadAt: now }
      : { candidateLastReadAt: now };

  await prisma.dialog.update({ where: { id: dialog.id }, data });
  res.status(200).json({ ok: true });
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/dialogs.ts backend/src/routes/dialogs.test.ts
git commit -m "feat(api): dialog unread total and mark-read endpoints"
```

---

### Task 4: Frontend API client

**Files:**
- Modify: `frontend/src/api/dialogs.ts`

**Interfaces:**
- Consumes: backend Task 2–3 shapes
- Produces:
  - `DialogListItem.unreadCount: number`
  - `fetchDialogUnreadCount(): Promise<number>`
  - `markDialogRead(id: string): Promise<void>`

- [ ] **Step 1: Extend types and functions**

```typescript
export type DialogListItem = {
  id: string;
  peer: { id: string; email: string };
  lastMessage: { body: string; createdAt: string; kind: DialogMessageKind } | null;
  updatedAt: string;
  unreadCount: number;
};

export async function fetchDialogUnreadCount(): Promise<number> {
  const response = await fetchWithAuth("/api/dialogs/unread-count");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити непрочитані");
  }
  const body = (await response.json()) as { unreadCount: number };
  return body.unreadCount;
}

export async function markDialogRead(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/dialogs/${id}/read`, {
    method: "POST",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося позначити діалог прочитаним");
  }
}
```

When mapping list responses, if backend omits the field during partial deploys, coerce with `Number(item.unreadCount ?? 0)` only if needed — prefer trusting the API after Task 2.

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run lint
```

Expected: PASS (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/dialogs.ts
git commit -m "feat(fe): dialog unread API client helpers"
```

---

### Task 5: `useDialogUnread` composable + tests

**Files:**
- Create: `frontend/src/composables/useDialogUnread.ts`
- Create: `frontend/src/composables/useDialogUnread.test.ts`
- Modify: `frontend/package.json` (`test` script)
- Modify: `frontend/src/layouts/HrLayout.vue`
- Modify: `frontend/src/layouts/CandidateLayout.vue`

**Interfaces:**
- Consumes: `fetchDialogUnreadCount`, `markDialogRead`
- Produces:
  - `unreadCount: Ref<number>`
  - `formatUnreadBadge(count: number): string`
  - `refresh(): Promise<void>`
  - `markRead(dialogId: string): Promise<void>`
  - `startPolling(intervalMs?: number): void`
  - `stopPolling(): void`

- [ ] **Step 1: Write failing unit tests**

`useDialogUnread.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatUnreadBadge,
  createDialogUnreadController,
} from "./useDialogUnread";

test("formatUnreadBadge shows 99+ above 99", () => {
  assert.equal(formatUnreadBadge(0), "0");
  assert.equal(formatUnreadBadge(3), "3");
  assert.equal(formatUnreadBadge(99), "99");
  assert.equal(formatUnreadBadge(100), "99+");
});

test("refresh loads unread total", async () => {
  const controller = createDialogUnreadController({
    fetchUnreadCount: async () => 4,
    markDialogRead: async () => undefined,
  });
  await controller.refresh();
  assert.equal(controller.unreadCount.value, 4);
});

test("refresh swallows errors", async () => {
  const controller = createDialogUnreadController({
    fetchUnreadCount: async () => {
      throw new Error("network");
    },
    markDialogRead: async () => undefined,
  });
  controller.unreadCount.value = 2;
  await controller.refresh();
  assert.equal(controller.unreadCount.value, 2);
});

test("markRead calls API then refreshes", async () => {
  const calls: string[] = [];
  const controller = createDialogUnreadController({
    fetchUnreadCount: async () => {
      calls.push("fetch");
      return 0;
    },
    markDialogRead: async (id: string) => {
      calls.push(`mark:${id}`);
    },
  });
  await controller.markRead("dlg_1");
  assert.deepEqual(calls, ["mark:dlg_1", "fetch"]);
  assert.equal(controller.unreadCount.value, 0);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd frontend && node --import tsx --test src/composables/useDialogUnread.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement composable**

```typescript
import { onUnmounted, ref, type Ref } from "vue";
import {
  fetchDialogUnreadCount,
  markDialogRead as apiMarkDialogRead,
} from "../api/dialogs";

const DEFAULT_POLL_MS = 45_000;

export function formatUnreadBadge(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export type DialogUnreadAdapters = {
  fetchUnreadCount: () => Promise<number>;
  markDialogRead: (id: string) => Promise<void>;
};

export function createDialogUnreadController(
  adapters: DialogUnreadAdapters,
  pollMs: number = DEFAULT_POLL_MS,
) {
  const unreadCount = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      unreadCount.value = await adapters.fetchUnreadCount();
    } catch {
      // keep last known value
    }
  }

  async function markRead(dialogId: string): Promise<void> {
    await adapters.markDialogRead(dialogId);
    await refresh();
  }

  function startPolling(): void {
    stopPolling();
    void refresh();
    timer = setInterval(() => {
      void refresh();
    }, pollMs);
  }

  function stopPolling(): void {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { unreadCount, refresh, markRead, startPolling, stopPolling };
}

const shared = createDialogUnreadController({
  fetchUnreadCount: fetchDialogUnreadCount,
  markDialogRead: apiMarkDialogRead,
});

export function useDialogUnread(): {
  unreadCount: Ref<number>;
  refresh: () => Promise<void>;
  markRead: (dialogId: string) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
} {
  return shared;
}
```

Wire layouts:

```typescript
import { onMounted, onUnmounted } from "vue";
import { useDialogUnread } from "../composables/useDialogUnread";

const { startPolling, stopPolling } = useDialogUnread();
onMounted(() => startPolling());
onUnmounted(() => stopPolling());
```

Do this in both `HrLayout.vue` and `CandidateLayout.vue`.

- [ ] **Step 4: Register test + run**

In `frontend/package.json`:

```json
"test": "node --import tsx --test src/composables/usePrepChat.test.ts src/composables/useDialogUnread.test.ts"
```

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useDialogUnread.ts frontend/src/composables/useDialogUnread.test.ts frontend/package.json frontend/src/layouts/HrLayout.vue frontend/src/layouts/CandidateLayout.vue
git commit -m "feat(fe): poll dialog unread total in layouts"
```

---

### Task 6: Sidebar + list + thread UI badges

**Files:**
- Modify: `frontend/src/components/HrSidebar.vue`
- Modify: `frontend/src/components/CandidateSidebar.vue`
- Modify: `frontend/src/views/DialogListView.vue`
- Modify: `frontend/src/views/DialogThreadView.vue`

**Interfaces:**
- Consumes: `useDialogUnread`, `formatUnreadBadge`, `DialogListItem.unreadCount`, `markRead`
- Produces: visible badges; mark-read on thread open

- [ ] **Step 1: Update sidebars**

In both sidebars:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  formatUnreadBadge,
  useDialogUnread,
} from "../composables/useDialogUnread";

const route = useRoute();
const { unreadCount } = useDialogUnread();
const dialogBadge = computed(() =>
  unreadCount.value > 0 ? formatUnreadBadge(unreadCount.value) : null,
);
// ...existing isActive helpers
</script>
```

Dialogs link markup:

```vue
<RouterLink ... class="nav-item" ...>
  <span>Діалоги</span>
  <span v-if="dialogBadge" class="nav-badge">{{ dialogBadge }}</span>
</RouterLink>
```

Styles (match `HrHomeView` badge spirit):

```css
.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  /* keep existing padding/colors */
}
.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
}
```

- [ ] **Step 2: Update `DialogListView.vue`**

In the row template, after peer/preview/time:

```vue
<button type="button" class="row" :class="{ unread: dialog.unreadCount > 0 }" @click="openDialog(dialog.id)">
  <span class="peer">{{ dialog.peer.email }}</span>
  <span class="preview">{{ previewText(dialog) }}</span>
  <span v-if="dialog.unreadCount > 0" class="row-badge">{{ formatUnreadBadge(dialog.unreadCount) }}</span>
  <span class="time">{{ formatDate(dialog.updatedAt) }}</span>
</button>
```

Import `formatUnreadBadge`. Style `.row.unread .peer { font-weight: 600; }` and reuse pill badge styles for `.row-badge`.

- [ ] **Step 3: Update `DialogThreadView.vue`**

Import `useDialogUnread`. After successful thread load (inside `loadThread` success path, after messages assigned):

```typescript
const { markRead } = useDialogUnread();
// ...
await markRead(id);
```

If `markRead` fails, do **not** fail the thread UI — catch and ignore (messages already shown). Example:

```typescript
try {
  await markRead(id);
} catch {
  // leave unread badge until next successful mark/poll
}
```

- [ ] **Step 4: Verify build**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HrSidebar.vue frontend/src/components/CandidateSidebar.vue frontend/src/views/DialogListView.vue frontend/src/views/DialogThreadView.vue
git commit -m "feat(fe): show dialog unread badges in nav and list"
```

---

### Task 7: Smoke verification

**Files:** none (manual / automated checks)

- [ ] **Step 1: Backend tests**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Frontend tests + build**

```bash
cd frontend && npm test && npm run build
```

Expected: PASS.

- [ ] **Step 3: Manual smoke (if servers running)**

1. As candidate with unread decision letter → sidebar «Діалоги» shows badge.
2. Open list → row badge visible.
3. Open thread → badges clear after return / next poll.
4. As HR with candidate reply → same behavior.
5. Own-only messages → no badge.

- [ ] **Step 4: Final commit only if smoke found fixes**; otherwise done.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `hrLastReadAt` / `candidateLastReadAt` | Task 1 |
| Unread = foreign messages after cursor | Task 2 |
| `GET /dialogs` includes `unreadCount` | Task 2 |
| `GET /dialogs/unread-count` | Task 3 |
| `POST /dialogs/:id/read` | Task 3 |
| Route order unread-count before `:id` | Task 3 |
| API client helpers | Task 4 |
| Polling 45s + silent errors | Task 5 |
| Sidebar badge + `99+` | Tasks 5–6 |
| List row badge | Task 6 |
| Mark read on thread open | Task 6 |
| Backend tests for HR + candidate | Tasks 2–3 |
| No Socket.IO / email | Global constraints |

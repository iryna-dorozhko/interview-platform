# Per-User Dialog Hide (Delete from Thread) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дозволити HR і кандидату прибрати діалог зі **свого** списку кнопкою в шапці треду; історія лишається; діалог знову з’являється після нового повідомлення від іншої сторони.

**Architecture:** Nullable `hrHiddenAt` / `candidateHiddenAt` на `Dialog`. `DELETE /api/dialogs/:id` виставляє hide для поточного учасника. List і unread-count фільтрують `*HiddenAt: null`. `POST .../messages` і decision letter зі звіту скидають hide **отримувача**.

**Tech Stack:** Prisma + Express (`node:test` + tsx), Vue 3 + Vue Router + `fetchWithAuth`.

**Spec:** `docs/superpowers/specs/2026-07-23-delete-dialogs-design.md`

## Global Constraints

- Per-user hide only — never hard-delete `Dialog` / `DialogMessage` / decisions.
- Reappear only when the **other** party creates a message (USER or DECISION_LETTER); own message does **not** clear own hide.
- UI delete control **only** in `DialogThreadView` header (not list).
- Confirm copy (exact): `Видалити цей діалог зі свого списку? Він знову з’явиться, якщо співрозмовник напише нове повідомлення.`
- `DELETE` → **204**; non-participant → **404** `{ error: "Dialog not found" }`.
- `GET /dialogs/:id` stays available for hidden dialogs (direct URL).
- UI copy: Ukrainian; identifiers English.
- Follow TDD for backend route changes.
- Do not touch unrelated WIP (`.playwright-mcp/`, `reports/Day 15.txt`, vacancy/interview WIP, etc.).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | `hrHiddenAt`, `candidateHiddenAt` on `Dialog` |
| `backend/prisma/migrations/<ts>_dialog_hidden_at/migration.sql` | ALTER TABLE |
| `backend/src/routes/dialogs.ts` | DELETE; filter list/unread; clear peer hide on send |
| `backend/src/routes/dialogs.test.ts` | Fake Prisma + hide/unhide tests |
| `backend/src/routes/reports.ts` | Clear `candidateHiddenAt` when sending decision letter |
| `backend/src/routes/reports.test.ts` | Fake dialog fields + assert unhide on decision |
| `frontend/src/api/dialogs.ts` | `deleteDialog(id)` |
| `frontend/src/views/DialogThreadView.vue` | Delete button, confirm, redirect, refresh unread |

---

### Task 1: Prisma — hide cursors on Dialog

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_dialog_hidden_at/migration.sql` (via `prisma migrate`)

**Interfaces:**
- Consumes: existing `Dialog` model
- Produces: `Dialog.hrHiddenAt: DateTime | null`, `Dialog.candidateHiddenAt: DateTime | null`

- [ ] **Step 1: Update `Dialog` in `schema.prisma`**

After `candidateLastReadAt`, add:

```prisma
  hrHiddenAt        DateTime?
  candidateHiddenAt DateTime?
```

- [ ] **Step 2: Create and apply migration**

Run from `backend/`:

```bash
npx prisma migrate dev --name dialog_hidden_at
```

Expected: migration folder created; client generated; migrate succeeds against local DB.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/*_dialog_hidden_at/
git commit -m "feat(db): add dialog per-user hiddenAt fields"
```

---

### Task 2: Fake Prisma + `DELETE` + list/unread filter

**Files:**
- Modify: `backend/src/routes/dialogs.ts`
- Modify: `backend/src/routes/dialogs.test.ts`
- Test: `backend/src/routes/dialogs.test.ts`

**Interfaces:**
- Consumes: `Dialog.hrHiddenAt`, `Dialog.candidateHiddenAt`
- Produces: `DELETE /api/dialogs/:id` → 204; `GET /dialogs` and `GET /dialogs/unread-count` exclude rows where the caller's hide field is non-null

- [ ] **Step 1: Extend fake Prisma for hide fields**

In `dialogs.test.ts`:

1. Add to `FakeDialog`:

```typescript
  hrHiddenAt: Date | null;
  candidateHiddenAt: Date | null;
```

2. Set both to `null` on `baseDialog`, `otherDialog`, and in `dialog.create`.

3. Extend `dialog.update` `data` type and apply:

```typescript
data: {
  updatedAt?: Date;
  hrLastReadAt?: Date | null;
  candidateLastReadAt?: Date | null;
  hrHiddenAt?: Date | null;
  candidateHiddenAt?: Date | null;
};
// ...
if (data.hrHiddenAt !== undefined) dialog.hrHiddenAt = data.hrHiddenAt;
if (data.candidateHiddenAt !== undefined) {
  dialog.candidateHiddenAt = data.candidateHiddenAt;
}
```

4. Extend `findMany` `where` to support null-equality filters (Prisma style):

```typescript
where?: {
  hrUserId?: string;
  candidateUserId?: string;
  hrHiddenAt?: null;
  candidateHiddenAt?: null;
};
```

Inside the filter:

```typescript
if (where?.hrHiddenAt === null && d.hrHiddenAt != null) return false;
if (where?.candidateHiddenAt === null && d.candidateHiddenAt != null) return false;
```

Also include the new fields in `select` when requested (optional; unread-count may select only ids/read cursors — filtering happens in `where`).

- [ ] **Step 2: Write failing tests**

Append to `dialogs.test.ts`:

```typescript
test("DELETE /dialogs/:id hides dialog for HR only; candidate still lists it", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [{ ...baseDialog }],
    messages: [
      {
        id: "msg_1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "Hi",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
    ],
  });

  const hrApp = makeApp(prisma, hrUser);
  const hrServer = hrApp.listen(0);
  const hrPort = (hrServer.address() as { port: number }).port;

  try {
    const del = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs/dlg_1`, {
      method: "DELETE",
    });
    assert.equal(del.status, 204);

    const hrList = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs`);
    assert.equal(hrList.status, 200);
    assert.equal((await hrList.json()).dialogs.length, 0);

    const hrUnread = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs/unread-count`);
    assert.equal(hrUnread.status, 200);
    assert.equal((await hrUnread.json()).unreadCount, 0);
  } finally {
    hrServer.close();
  }

  const candApp = makeApp(prisma, candidateUser);
  const candServer = candApp.listen(0);
  const candPort = (candServer.address() as { port: number }).port;

  try {
    const candList = await fetch(`http://127.0.0.1:${candPort}/api/dialogs`);
    assert.equal(candList.status, 200);
    assert.equal((await candList.json()).dialogs.length, 1);

    const thread = await fetch(`http://127.0.0.1:${candPort}/api/dialogs/dlg_1`);
    assert.equal(thread.status, 200);
    assert.equal((await thread.json()).messages.length, 1);
  } finally {
    candServer.close();
  }
});

test("DELETE /dialogs/:id hides dialog for candidate only", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [{ ...baseDialog }],
  });
  const app = makeApp(prisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const del = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`, {
      method: "DELETE",
    });
    assert.equal(del.status, 204);

    const list = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal((await list.json()).dialogs.length, 0);
  } finally {
    server.close();
  }

  const hrApp = makeApp(prisma, hrUser);
  const hrServer = hrApp.listen(0);
  const hrPort = (hrServer.address() as { port: number }).port;
  try {
    const list = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs`);
    assert.equal((await list.json()).dialogs.length, 1);
  } finally {
    hrServer.close();
  }
});

test("DELETE /dialogs/:id returns 404 for non-participant", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [{ ...baseDialog }],
  });
  const app = makeApp(prisma, otherHr);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`, {
      method: "DELETE",
    });
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test("GET /dialogs/:id still works after hide for hider", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        hrHiddenAt: new Date("2026-07-20T10:00:00.000Z"),
        candidateHiddenAt: null,
      },
    ],
    messages: [
      {
        id: "msg_1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "Still here",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.messages[0].body, "Still here");
  } finally {
    server.close();
  }
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: new DELETE/hide tests fail (404 / method not handled / list still returns hidden).

- [ ] **Step 4: Implement DELETE + filters in `dialogs.ts`**

Helper (near other dialog helpers):

```typescript
function hiddenAtFieldForUser(
  dialog: { hrUserId: string },
  userId: string,
): "hrHiddenAt" | "candidateHiddenAt" {
  return dialog.hrUserId === userId ? "hrHiddenAt" : "candidateHiddenAt";
}
```

`GET /dialogs` — change `where` to:

```typescript
const where =
  req.user!.role === "HR"
    ? { hrUserId: req.user!.id, hrHiddenAt: null }
    : { candidateUserId: req.user!.id, candidateHiddenAt: null };
```

`GET /dialogs/unread-count` — same `where` change.

Add route (alongside other `/:id` routes; after `/dialogs/unread-count` is already separate):

```typescript
router.delete("/dialogs/:id", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const dialog = await prisma.dialog.findUnique({ where: { id: req.params.id } });
  if (!dialog || !isParticipant(dialog, req.user!.id)) {
    res.status(404).json({ error: "Dialog not found" });
    return;
  }

  const field = hiddenAtFieldForUser(dialog, req.user!.id);
  await prisma.dialog.update({
    where: { id: dialog.id },
    data: { [field]: new Date() },
  });
  res.status(204).send();
});
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: all dialogs tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/dialogs.ts backend/src/routes/dialogs.test.ts
git commit -m "feat(api): per-user hide dialog via DELETE"
```

---

### Task 3: Clear peer hide on `POST /dialogs/:id/messages`

**Files:**
- Modify: `backend/src/routes/dialogs.ts`
- Modify: `backend/src/routes/dialogs.test.ts`
- Test: `backend/src/routes/dialogs.test.ts`

**Interfaces:**
- Consumes: `POST /dialogs/:id/messages`
- Produces: after USER message, peer's `*HiddenAt` set to `null`; author's hide unchanged

- [ ] **Step 1: Write failing tests**

```typescript
test("candidate message after HR hide clears hrHiddenAt and restores HR list", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        hrHiddenAt: new Date("2026-07-20T10:00:00.000Z"),
        candidateHiddenAt: null,
      },
    ],
  });

  const candApp = makeApp(prisma, candidateUser);
  const candServer = candApp.listen(0);
  const candPort = (candServer.address() as { port: number }).port;

  try {
    const send = await fetch(`http://127.0.0.1:${candPort}/api/dialogs/dlg_1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Ping" }),
    });
    assert.equal(send.status, 201);
  } finally {
    candServer.close();
  }

  const hrApp = makeApp(prisma, hrUser);
  const hrServer = hrApp.listen(0);
  const hrPort = (hrServer.address() as { port: number }).port;

  try {
    const list = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).dialogs.length, 1);
  } finally {
    hrServer.close();
  }
});

test("own message after hide does not clear own hiddenAt", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        hrHiddenAt: new Date("2026-07-20T10:00:00.000Z"),
        candidateHiddenAt: null,
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const send = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Still hidden for me" }),
    });
    assert.equal(send.status, 201);

    const list = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal((await list.json()).dialogs.length, 0);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: restore-list test fails (HR list still empty).

- [ ] **Step 3: Update message send in `dialogs.ts`**

Replace the post-create `dialog.update` with:

```typescript
await prisma.dialog.update({
  where: { id: dialog.id },
  data: {
    updatedAt: new Date(),
    ...(dialog.hrUserId === req.user!.id
      ? { candidateHiddenAt: null }
      : { hrHiddenAt: null }),
  },
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/dialogs.ts backend/src/routes/dialogs.test.ts
git commit -m "feat(api): unhide dialog for peer on new message"
```

---

### Task 4: Decision letter clears `candidateHiddenAt`

**Files:**
- Modify: `backend/src/routes/reports.ts`
- Modify: `backend/src/routes/reports.test.ts`
- Test: `backend/src/routes/reports.test.ts`

**Interfaces:**
- Consumes: `POST /reports/:id/decisions` transaction that creates `DECISION_LETTER`
- Produces: `dialog.update` also sets `candidateHiddenAt: null`

- [ ] **Step 1: Extend reports fake Dialog + write failing test**

In `reports.test.ts` `FakeDialog`, add:

```typescript
  hrHiddenAt: Date | null;
  candidateHiddenAt: Date | null;
```

In `dialog.create`, initialize both to `null`.

Extend `dialog.update` data + apply:

```typescript
data: {
  updatedAt?: Date;
  candidateHiddenAt?: Date | null;
  hrHiddenAt?: Date | null;
};
// ...
if (data.candidateHiddenAt !== undefined) {
  dialog.candidateHiddenAt = data.candidateHiddenAt;
}
if (data.hrHiddenAt !== undefined) dialog.hrHiddenAt = data.hrHiddenAt;
```

Add test (reuse existing report seed pattern from `POST /reports/:id/decisions creates decision...`; seed a dialog with `candidateHiddenAt` set):

```typescript
test("POST /reports/:id/decisions clears candidateHiddenAt on existing dialog", async () => {
  const hiddenAt = new Date("2026-07-20T10:00:00.000Z");
  const fakePrisma = makeFakePrisma({
    reports: [sampleReport], // use the same sampleReport fixture already in this file
    dialogs: [
      {
        id: "dlg_existing",
        hrUserId: "hr_1",
        candidateUserId: "cand_1",
        createdAt: new Date("2026-07-14T10:00:00.000Z"),
        updatedAt: new Date("2026-07-14T12:00:00.000Z"),
        hrHiddenAt: null,
        candidateHiddenAt: hiddenAt,
      },
    ],
  });
  // makeApp / listen same as neighboring decision tests in this file
  const app = makeApp(fakePrisma, hrUser); // match local makeApp + hrUser names
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reports/rep_1/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ACCEPT", letterBody: "Вітаємо!" }),
    });
    assert.equal(response.status, 201);
    assert.equal(fakePrisma.__dialogs[0].candidateHiddenAt, null);
  } finally {
    server.close();
  }
});
```

Adapt `sampleReport`, `makeApp`, `hrUser`, and report id to **exact** names already used in `reports.test.ts` (see existing `POST /reports/:id/decisions creates decision...` test around line 828).

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

Expected: new test fails (`candidateHiddenAt` still set).

- [ ] **Step 3: Update `reports.ts` dialog.update in decisions transaction**

Change:

```typescript
await tx.dialog.update({
  where: { id: dialog.id },
  data: { updatedAt: new Date() },
});
```

to:

```typescript
await tx.dialog.update({
  where: { id: dialog.id },
  data: { updatedAt: new Date(), candidateHiddenAt: null },
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

Expected: all reports tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts
git commit -m "feat(api): unhide dialog for candidate on decision letter"
```

---

### Task 5: Frontend — API + delete in thread header

**Files:**
- Modify: `frontend/src/api/dialogs.ts`
- Modify: `frontend/src/views/DialogThreadView.vue`

**Interfaces:**
- Consumes: `DELETE /api/dialogs/:id` → 204
- Produces: `deleteDialog(id: string): Promise<void>`; thread UI button + confirm + navigate + unread refresh

- [ ] **Step 1: Add `deleteDialog` to `frontend/src/api/dialogs.ts`**

```typescript
export async function deleteDialog(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/dialogs/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити діалог");
  }
}
```

- [ ] **Step 2: Wire UI in `DialogThreadView.vue`**

Imports: add `deleteDialog`; add `useRouter` from `vue-router`; keep `useDialogUnread`.

```typescript
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  deleteDialog,
  fetchDialog,
  fetchDialogs,
  sendDialogMessage,
  type DialogMessage,
  type InterviewDecisionType,
} from "../api/dialogs";
```

In setup:

```typescript
const router = useRouter();
const { markRead, refresh } = useDialogUnread();

const deleting = ref(false);
const deleteError = ref<string | null>(null);

async function onDelete(): Promise<void> {
  if (deleting.value) return;
  const ok = window.confirm(
    "Видалити цей діалог зі свого списку? Він знову з’явиться, якщо співрозмовник напише нове повідомлення.",
  );
  if (!ok) return;

  deleting.value = true;
  deleteError.value = null;
  try {
    await deleteDialog(dialogId.value);
    await refresh();
    await router.push(basePath.value);
  } catch (error) {
    deleteError.value =
      error instanceof Error ? error.message : "Не вдалося видалити діалог";
  } finally {
    deleting.value = false;
  }
}
```

Clear `deleteError` in `loadThread` alongside other errors.

Template header:

```html
<header class="header">
  <RouterLink :to="basePath" class="back-link">← До діалогів</RouterLink>
  <div class="header-row">
    <h1>{{ peerLabel }}</h1>
    <button
      v-if="loadState === 'ready'"
      type="button"
      class="btn-danger"
      :disabled="deleting"
      @click="onDelete"
    >
      Видалити
    </button>
  </div>
  <p v-if="deleteError" class="fail" role="alert">{{ deleteError }}</p>
</header>
```

Styles (scoped), mirror vacancy/interview danger button + row layout:

```css
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.btn-danger {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid #fca5a5;
  background: #fff;
  color: var(--danger);
  cursor: pointer;
  flex-shrink: 0;
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Typecheck / build frontend**

```bash
cd frontend && npm run build
```

Expected: success, no TS errors in touched files.

- [ ] **Step 4: Manual smoke (local app running)**

1. Як HR відкрити діалог → Видалити → confirm → редірект на `/dialogs`, рядок зник.
2. Як кандидат — діалог досі в списку.
3. Кандидат пише повідомлення → у HR діалог знову в списку / unread оновлюється.
4. Прямий URL схованого (до чужого повідомлення) відкриває thread.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/dialogs.ts frontend/src/views/DialogThreadView.vue
git commit -m "feat(fe): delete dialog from thread header"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| `hrHiddenAt` / `candidateHiddenAt` | Task 1 |
| `DELETE /api/dialogs/:id` 204 / 404 | Task 2 |
| List excludes own hidden | Task 2 |
| Unread excludes own hidden | Task 2 |
| `GET :id` still works when hidden | Task 2 |
| Peer message clears recipient hide | Task 3 |
| Own message does not clear own hide | Task 3 |
| Decision letter clears `candidateHiddenAt` | Task 4 |
| Thread header button + confirm copy | Task 5 |
| Redirect + unread refresh | Task 5 |
| No list delete button / no hard-delete | Out of scope (not implemented) |

No placeholders left; types (`hrHiddenAt`, `candidateHiddenAt`, `deleteDialog`) consistent across tasks.

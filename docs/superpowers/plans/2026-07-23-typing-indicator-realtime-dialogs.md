# Typing Indicator + Realtime Dialogs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показати «Кандидат друкує» / «Рекрутер друкує» у live-кімнаті та в діалогах; у відкритому діалозі також доставляти нові повідомлення через Socket.IO без reload.

**Architecture:** Розширити наявний Socket.IO. Live: `room:typing` relay. Діалоги: новий `registerDialogHandlers` (`dialog:join` / `dialog:typing`) + broadcast `dialog:message` після `POST /dialogs/:id/messages` і після decision letter у reports. Відправка діалогів лишається HTTP; клієнт дедупить по `id`.

**Tech Stack:** Socket.IO (server + client), Express, Prisma, Vue 3 composables, `node:test` + tsx.

**Spec:** `docs/superpowers/specs/2026-07-23-typing-indicator-realtime-dialogs-design.md`

## Global Constraints

- UI copy exact: `Кандидат друкує` / `Рекрутер друкує`.
- Never show own typing to self (prefer `socket.to(room)` on server; UI also filters by role).
- Typing emit `true` at most every ~500 ms; idle clear `false` after ~2.5 s; clear on send and empty input.
- Dialog history/send stay on HTTP; socket is additive (degrade gracefully if socket down).
- Broadcast `dialog:message` for USER posts and DECISION_LETTER creation.
- Ukrainian UI; English identifiers.
- TDD for backend socket/route changes.
- Do not touch unrelated WIP (`.playwright-mcp/`, `reports/Day 15.txt`, agent-stop WIP unless required to compile, vacancy/interview WIP, etc.).
- Register new test files in `backend/package.json` / `frontend/package.json` `test` scripts when created.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/socket/types.ts` | Typing + dialog socket payload/event types |
| `backend/src/socket/room.ts` | Handle/relay `room:typing`; clear on disconnect |
| `backend/src/socket/room.test.ts` | Typing relay + access tests |
| `backend/src/socket/dialogs.ts` | `dialogRoomName`, `emitDialogMessage`, `registerDialogHandlers` |
| `backend/src/socket/dialogs.test.ts` | Join/typing/access socket tests |
| `backend/src/routes/dialogs.ts` | Accept `getIo`; broadcast after POST message |
| `backend/src/routes/dialogs.test.ts` | Assert emit on POST |
| `backend/src/routes/reports.ts` | Accept `getIo`; broadcast decision letter |
| `backend/src/routes/reports.test.ts` | Assert emit on decision |
| `backend/src/server.ts` | Wire `getIo` + `registerDialogHandlers` |
| `frontend/src/utils/typing-indicator.ts` | Labels + `createTypingEmitter` (throttle/idle) |
| `frontend/src/utils/typing-indicator.test.ts` | Unit tests for helper |
| `frontend/src/composables/useInterviewRoom.ts` | Emit/listen `room:typing` |
| `frontend/src/components/LiveChatPanel.vue` | Show peer typing row; notify input |
| `frontend/src/components/InterviewRoomContent.vue` | Pass typing props/events |
| `frontend/src/composables/useDialogThread.ts` | Join dialog room, typing, merge messages |
| `frontend/src/views/DialogThreadView.vue` | Use composable + typing UI |

---

### Task 1: Shared typing helper (frontend)

**Files:**
- Create: `frontend/src/utils/typing-indicator.ts`
- Create: `frontend/src/utils/typing-indicator.test.ts`
- Modify: `frontend/package.json` (`test` script — append new test file)

**Interfaces:**
- Consumes: none
- Produces:
  - `typingLabelFor(role: "HR" | "CANDIDATE"): string`
  - `createTypingEmitter(options: { emit: (isTyping: boolean) => void; throttleMs?: number; idleMs?: number }): { onInput(text: string): void; onSend(): void; dispose(): void }`

- [ ] **Step 1: Write failing tests**

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTypingEmitter, typingLabelFor } from "./typing-indicator";

test("typingLabelFor maps roles", () => {
  assert.equal(typingLabelFor("CANDIDATE"), "Кандидат друкує");
  assert.equal(typingLabelFor("HR"), "Рекрутер друкує");
});

test("createTypingEmitter emits true then idle false", async () => {
  const calls: boolean[] = [];
  const emitter = createTypingEmitter({
    emit: (v) => calls.push(v),
    throttleMs: 50,
    idleMs: 80,
  });
  emitter.onInput("a");
  assert.deepEqual(calls, [true]);
  emitter.onInput("ab");
  assert.deepEqual(calls, [true]); // throttled — no second true yet
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(calls, [true, false]);
  emitter.dispose();
});

test("createTypingEmitter onSend clears immediately", () => {
  const calls: boolean[] = [];
  const emitter = createTypingEmitter({
    emit: (v) => calls.push(v),
    throttleMs: 50,
    idleMs: 5000,
  });
  emitter.onInput("hi");
  emitter.onSend();
  assert.deepEqual(calls, [true, false]);
  emitter.dispose();
});

test("createTypingEmitter empty text emits false if was typing", () => {
  const calls: boolean[] = [];
  const emitter = createTypingEmitter({
    emit: (v) => calls.push(v),
    throttleMs: 50,
    idleMs: 5000,
  });
  emitter.onInput("x");
  emitter.onInput("");
  assert.deepEqual(calls, [true, false]);
  emitter.dispose();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && node --import tsx --test src/utils/typing-indicator.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement helper**

```typescript
export function typingLabelFor(role: "HR" | "CANDIDATE"): string {
  return role === "HR" ? "Рекрутер друкує" : "Кандидат друкує";
}

export function createTypingEmitter(options: {
  emit: (isTyping: boolean) => void;
  throttleMs?: number;
  idleMs?: number;
}): {
  onInput(text: string): void;
  onSend(): void;
  dispose(): void;
} {
  const throttleMs = options.throttleMs ?? 500;
  const idleMs = options.idleMs ?? 2500;
  let lastTrueAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let isTyping = false;

  function clearIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function setFalse(): void {
    clearIdle();
    if (!isTyping) return;
    isTyping = false;
    options.emit(false);
  }

  function setTrue(): void {
    const now = Date.now();
    if (!isTyping) {
      isTyping = true;
      lastTrueAt = now;
      options.emit(true);
    } else if (now - lastTrueAt >= throttleMs) {
      lastTrueAt = now;
      options.emit(true);
    }
    clearIdle();
    idleTimer = setTimeout(() => setFalse(), idleMs);
  }

  return {
    onInput(text: string) {
      if (!text.trim()) {
        setFalse();
        return;
      }
      setTrue();
    },
    onSend() {
      setFalse();
    },
    dispose() {
      clearIdle();
    },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && node --import tsx --test src/utils/typing-indicator.test.ts
```

- [ ] **Step 5: Register in `frontend/package.json` `test` script** (append `src/utils/typing-indicator.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/typing-indicator.ts frontend/src/utils/typing-indicator.test.ts frontend/package.json
git commit -m "feat(fe): add shared typing indicator helper"
```

---

### Task 2: Backend `room:typing`

**Files:**
- Modify: `backend/src/socket/types.ts`
- Modify: `backend/src/socket/room.ts`
- Modify: `backend/src/socket/room.test.ts`

**Interfaces:**
- Consumes: existing room join + `getSocketData().roomRole` / `interviewId`
- Produces:
  - Client→server: `room:typing` `{ interviewId, isTyping: boolean }`
  - Server→peers: `room:typing` `{ role: "HR" | "CANDIDATE", isTyping: boolean }` via `socket.to(roomName(id))`
  - On disconnect: emit `{ role, isTyping: false }` to peers

- [ ] **Step 1: Add types**

In `types.ts`:

```typescript
export type RoomTypingPayload = {
  interviewId?: unknown;
  isTyping?: unknown;
};

export type RoomTypingEvent = {
  role: "HR" | "CANDIDATE";
  isTyping: boolean;
};
```

- [ ] **Step 2: Write failing test in `room.test.ts`**

```typescript
test("room:typing relays to peer without echoing sender", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const prisma = makeFakePrisma(interview, [{ id: "session_1", interviewId: "interview_1" }], []);
  const server = await startRoomServer(prisma);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);
    hrSocket.emit("room:join", { interviewId: "interview_1" });
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await Promise.all([
      waitForEvent(hrSocket, "room:messages"),
      waitForEvent(candidateSocket, "room:messages"),
    ]);

    const peerTyping = waitForEvent<{ role: string; isTyping: boolean }>(
      candidateSocket,
      "room:typing",
    );
    let senderGotTyping = false;
    hrSocket.once("room:typing", () => {
      senderGotTyping = true;
    });

    hrSocket.emit("room:typing", { interviewId: "interview_1", isTyping: true });
    const payload = await peerTyping;
    assert.equal(payload.role, "HR");
    assert.equal(payload.isTyping, true);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(senderGotTyping, false);

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("room:typing ignored when interviewId does not match joined room", async () => {
  const interview: FakeInterview = {
    id: "interview_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
    status: "LIVE",
  };
  const prisma = makeFakePrisma(interview, [{ id: "session_1", interviewId: "interview_1" }], []);
  const server = await startRoomServer(prisma);

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);
    hrSocket.emit("room:join", { interviewId: "interview_1" });
    candidateSocket.emit("room:join", { interviewId: "interview_1" });
    await Promise.all([
      waitForEvent(hrSocket, "room:messages"),
      waitForEvent(candidateSocket, "room:messages"),
    ]);

    let got = false;
    candidateSocket.once("room:typing", () => {
      got = true;
    });
    hrSocket.emit("room:typing", { interviewId: "other", isTyping: true });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(got, false);

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/socket/room.test.ts
```

Expected: FAIL (timeout / no `room:typing`).

- [ ] **Step 4: Implement handler in `room.ts`**

Import `RoomTypingPayload`. After `room:message` handler (before agent-retry), add:

```typescript
    socket.on("room:typing", (payload: RoomTypingPayload) => {
      const user = getSocketUser(socket);
      if (!user) return;
      const data = getSocketData(socket);
      const interviewId =
        typeof payload?.interviewId === "string" ? payload.interviewId.trim() : "";
      if (!interviewId || data.interviewId !== interviewId || !data.roomRole) return;
      if (typeof payload?.isTyping !== "boolean") return;

      socket.to(roomName(interviewId)).emit("room:typing", {
        role: data.roomRole,
        isTyping: payload.isTyping,
      });
    });
```

In existing `disconnect` handler, before `trackLeave`, add:

```typescript
      socket.to(room).emit("room:typing", {
        role: data.roomRole,
        isTyping: false,
      });
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/socket/room.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/socket/types.ts backend/src/socket/room.ts backend/src/socket/room.test.ts
git commit -m "feat(api): relay room typing indicator over socket"
```

---

### Task 3: Live chat UI wiring

**Files:**
- Modify: `frontend/src/composables/useInterviewRoom.ts`
- Modify: `frontend/src/components/LiveChatPanel.vue`
- Modify: `frontend/src/components/InterviewRoomContent.vue`

**Interfaces:**
- Consumes: `createTypingEmitter`, `typingLabelFor`, `room:typing` events
- Produces:
  - `peerTypingLabel: Ref<string | null>` (or `peerTypingRole`)
  - `notifyTypingInput(text: string)`, clear on `sendMessage`
  - `LiveChatPanel` props: `peerTypingLabel?: string | null`; emit `typing-input: [string]`

- [ ] **Step 1: Extend `useInterviewRoom`**

Add:

```typescript
import { createTypingEmitter } from "../utils/typing-indicator";
import { typingLabelFor } from "../utils/typing-indicator";

const peerTypingRole = ref<"HR" | "CANDIDATE" | null>(null);
const peerTypingLabel = computed(() =>
  peerTypingRole.value ? typingLabelFor(peerTypingRole.value) : null,
);

const typingEmitter = createTypingEmitter({
  emit: (isTyping) => {
    if (connectionState.value !== "connected") return;
    if (interviewStatus.value === "ENDED") return;
    socket.emit("room:typing", { interviewId, isTyping });
  },
});

function onTyping(payload: { role?: "HR" | "CANDIDATE"; isTyping?: boolean }): void {
  if (payload?.role !== "HR" && payload?.role !== "CANDIDATE") return;
  if (typeof payload.isTyping !== "boolean") return;
  if (payload.role === currentRole) return;
  peerTypingRole.value = payload.isTyping ? payload.role : null;
}

function notifyTypingInput(text: string): void {
  typingEmitter.onInput(text);
}

// In sendMessage, after validating text, before emit:
typingEmitter.onSend();
peerTypingRole.value = null; // optional: local only; peer clears via sender's false

// onMounted: socket.on("room:typing", onTyping);
// onUnmounted: socket.off(...); typingEmitter.dispose();
```

Return `peerTypingLabel`, `notifyTypingInput`.

- [ ] **Step 2: Wire `LiveChatPanel`**

Props: `peerTypingLabel?: string | null`.  
Emit: `typingInput: [content: string]`.

On textarea `@input` (or watch `input`):

```typescript
watch(input, (value) => {
  emit("typingInput", value);
});
```

Template after thinking row:

```html
<p v-if="peerTypingLabel" class="thinking">{{ peerTypingLabel }}</p>
```

Reuse `.thinking` styles.

- [ ] **Step 3: Wire `InterviewRoomContent`**

```vue
<LiveChatPanel
  ...
  :peer-typing-label="peerTypingLabel"
  @send="sendMessage"
  @typing-input="notifyTypingInput"
/>
```

- [ ] **Step 4: Manual smoke (optional in agent run)** — if servers up: two browsers, type in one, see label in other.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useInterviewRoom.ts frontend/src/components/LiveChatPanel.vue frontend/src/components/InterviewRoomContent.vue
git commit -m "feat(fe): show peer typing in live interview chat"
```

---

### Task 4: Backend dialog socket handlers

**Files:**
- Create: `backend/src/socket/dialogs.ts`
- Create: `backend/src/socket/dialogs.test.ts`
- Modify: `backend/src/socket/types.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json` (`test` script — append `src/socket/dialogs.test.ts`)

**Interfaces:**
- Consumes: `attachSocketAuth` / `getSocketUser`, Prisma `dialog.findUnique`
- Produces:
  - `dialogRoomName(dialogId: string): string` → `dialog:${dialogId}`
  - `emitDialogMessage(io, dialogId, messageDto): void`
  - `registerDialogHandlers(io, getPrisma)`
  - Events: `dialog:join`, `dialog:typing` (in/out), `dialog:error`, `dialog:message` (out)

- [ ] **Step 1: Add dialog types to `types.ts`**

```typescript
export type DialogJoinPayload = { dialogId?: unknown };
export type DialogTypingPayload = { dialogId?: unknown; isTyping?: unknown };

export type DialogTypingEvent = {
  role: "HR" | "CANDIDATE";
  isTyping: boolean;
};

export type DialogMessageDto = {
  id: string;
  dialogId: string;
  senderUserId: string;
  body: string;
  kind: "USER" | "DECISION_LETTER";
  createdAt: string;
  decision?: { type: "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING" } | null;
};

export type DialogErrorEvent = { error: string };
```

- [ ] **Step 2: Write failing socket tests** (`dialogs.test.ts`)

Mirror `room.test.ts` helpers (`connectClient`, `waitForEvent`, JWT tokens for hr/candidate). Fake Prisma needs `dialog.findUnique` returning `{ id, hrUserId, candidateUserId }` for `dialog_1`.

```typescript
test("dialog:join then dialog:typing relays to peer", async () => {
  // join both; HR emits typing true; candidate receives { role: "HR", isTyping: true }
});

test("dialog:join rejects non-participant", async () => {
  // other HR token → dialog:error "Немає доступу"
});
```

Use the same Socket.IO server bootstrap pattern as `room.test.ts`, calling `registerDialogHandlers(io, () => prisma)` (auth middleware inside register).

- [ ] **Step 3: Run — expect FAIL**

```bash
cd backend && node --import tsx --test src/socket/dialogs.test.ts
```

- [ ] **Step 4: Implement `dialogs.ts`**

```typescript
import type { Server, Socket } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import { attachSocketAuth, getSocketUser } from "./auth";
import type {
  DialogJoinPayload,
  DialogMessageDto,
  DialogTypingPayload,
} from "./types";

type DialogSocketData = {
  dialogId?: string;
  dialogRole?: "HR" | "CANDIDATE";
};

export function dialogRoomName(dialogId: string): string {
  return `dialog:${dialogId}`;
}

export function emitDialogMessage(
  io: Server,
  dialogId: string,
  message: DialogMessageDto,
): void {
  io.to(dialogRoomName(dialogId)).emit("dialog:message", { message });
}

function getData(socket: Socket): DialogSocketData {
  return socket.data as DialogSocketData;
}

export function registerDialogHandlers(
  io: Server,
  getPrisma: () => PrismaClient,
): void {
  io.use((socket, next) => {
    if (attachSocketAuth(socket)) next();
    else next(new Error("Unauthorized"));
  });

  io.on("connection", (socket: Socket) => {
    socket.on("dialog:join", async (payload: DialogJoinPayload) => {
      try {
        const user = getSocketUser(socket);
        if (!user) {
          socket.emit("dialog:error", { error: "Немає доступу" });
          return;
        }
        const dialogId =
          typeof payload?.dialogId === "string" ? payload.dialogId.trim() : "";
        if (!dialogId) {
          socket.emit("dialog:error", { error: "Невірний запит" });
          return;
        }
        const dialog = await getPrisma().dialog.findUnique({
          where: { id: dialogId },
          select: { id: true, hrUserId: true, candidateUserId: true },
        });
        if (
          !dialog ||
          (dialog.hrUserId !== user.id && dialog.candidateUserId !== user.id)
        ) {
          socket.emit("dialog:error", { error: "Немає доступу" });
          return;
        }
        const prev = getData(socket).dialogId;
        if (prev && prev !== dialogId) {
          await socket.leave(dialogRoomName(prev));
        }
        await socket.join(dialogRoomName(dialogId));
        getData(socket).dialogId = dialogId;
        getData(socket).dialogRole =
          dialog.hrUserId === user.id ? "HR" : "CANDIDATE";
      } catch (error) {
        console.error("[dialog:join] failed:", error instanceof Error ? error.message : error);
        socket.emit("dialog:error", { error: "Внутрішня помилка діалогу" });
      }
    });

    socket.on("dialog:typing", (payload: DialogTypingPayload) => {
      const user = getSocketUser(socket);
      if (!user) return;
      const data = getData(socket);
      const dialogId =
        typeof payload?.dialogId === "string" ? payload.dialogId.trim() : "";
      if (!dialogId || data.dialogId !== dialogId || !data.dialogRole) return;
      if (typeof payload?.isTyping !== "boolean") return;
      socket.to(dialogRoomName(dialogId)).emit("dialog:typing", {
        role: data.dialogRole,
        isTyping: payload.isTyping,
      });
    });

    socket.on("disconnect", () => {
      const data = getData(socket);
      if (!data.dialogId || !data.dialogRole) return;
      socket.to(dialogRoomName(data.dialogId)).emit("dialog:typing", {
        role: data.dialogRole,
        isTyping: false,
      });
    });
  });
}
```

- [ ] **Step 5: Register in `server.ts`**

```typescript
import { registerDialogHandlers } from "./socket/dialogs";
// after registerRoomHandlers:
registerDialogHandlers(io, () => prisma);
```

- [ ] **Step 6: Run tests — PASS; add file to backend `package.json` test script**

```bash
cd backend && node --import tsx --test src/socket/dialogs.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/socket/dialogs.ts backend/src/socket/dialogs.test.ts backend/src/socket/types.ts backend/src/server.ts backend/package.json
git commit -m "feat(api): add dialog socket join and typing relay"
```

---

### Task 5: Broadcast on `POST /dialogs/:id/messages`

**Files:**
- Modify: `backend/src/routes/dialogs.ts`
- Modify: `backend/src/routes/dialogs.test.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: `emitDialogMessage`, `getIo: () => Server`
- Produces: `createDialogsRouter(getPrisma, getIo)` — after create, `emitDialogMessage(getIo(), dialog.id, dto)`

- [ ] **Step 1: Write failing test**

In `dialogs.test.ts`, when constructing router, pass fake `getIo`:

```typescript
const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
const fakeIo = {
  to: (room: string) => ({
    emit: (event: string, payload: unknown) => {
      emitted.push({ room, event, payload });
    },
  }),
};
// createDialogsRouter(() => fakePrisma, () => fakeIo as never)
```

After successful POST message, assert:

```typescript
assert.equal(emitted.length, 1);
assert.equal(emitted[0]?.room, "dialog:dialog_1"); // use real fake dialog id
assert.equal(emitted[0]?.event, "dialog:message");
```

Update **all** `createDialogsRouter(() => ...)` call sites in the test file to pass a noop `getIo` (`() => ({ to: () => ({ emit: () => {} }) })`).

- [ ] **Step 2: Run — expect FAIL** (arity / no emit)

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

- [ ] **Step 3: Implement**

```typescript
import type { Server } from "socket.io";
import { emitDialogMessage } from "../socket/dialogs";

export function createDialogsRouter(
  getPrisma: () => PrismaClient,
  getIo: () => Server,
): Router {
```

After `res.status(201).json(...)` building the message object, also:

```typescript
    const messageDto = {
      id: message.id,
      dialogId: message.dialogId,
      senderUserId: message.senderUserId,
      body: message.body,
      kind: message.kind as "USER" | "DECISION_LETTER",
      createdAt: message.createdAt.toISOString(),
    };
    emitDialogMessage(getIo(), dialog.id, messageDto);
    res.status(201).json({ message: messageDto });
```

(Keep response shape compatible with existing clients — same fields as today.)

- [ ] **Step 4: Update `server.ts`**

```typescript
app.use("/api", requireAuth, createDialogsRouter(() => prisma, () => io));
```

(Note: `() => io` is fine — called at request time after `io` exists, same as interviews.)

- [ ] **Step 5: Run tests — PASS**

```bash
cd backend && node --import tsx --test src/routes/dialogs.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/dialogs.ts backend/src/routes/dialogs.test.ts backend/src/server.ts
git commit -m "feat(api): broadcast dialog messages over socket after POST"
```

---

### Task 6: Broadcast decision letter from reports

**Files:**
- Modify: `backend/src/routes/reports.ts`
- Modify: `backend/src/routes/reports.test.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: `emitDialogMessage`, `getIo`
- Produces: `createReportsRouter(getPrisma, getLlmProvider, getIo)` emits after transaction with DTO including `decision: { type }`

- [ ] **Step 1: Extend fake io in reports tests + assert emit**

Change signature usages to pass noop/recording `getIo`. After decision POST success, assert `dialog:message` with `kind: "DECISION_LETTER"` and `decision.type`.

Return `message` fields from the transaction (or re-fetch) so emit has `id`, `dialogId`, `body`, `createdAt`, `senderUserId`, `kind`, `decision: { type }`.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

- [ ] **Step 3: Implement**

```typescript
export function createReportsRouter(
  getPrisma: () => PrismaClient,
  getLlmProvider: () => LlmProvider,
  getIo: () => Server,
): Router {
```

Inside the route, change transaction return to include message + dialogId + type; after `tx`:

```typescript
    emitDialogMessage(getIo(), result.dialogId, {
      id: result.message.id,
      dialogId: result.dialogId,
      senderUserId: result.message.senderUserId,
      body: result.message.body,
      kind: "DECISION_LETTER",
      createdAt: result.message.createdAt.toISOString(),
      decision: { type: result.decision.type },
    });
```

Update HTTP JSON response to stay as today (`decision` + `dialogId` only).

- [ ] **Step 4: Wire `server.ts`**

```typescript
createReportsRouter(() => prisma, getLlmProvider, () => io)
```

- [ ] **Step 5: Run — PASS**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts backend/src/server.ts
git commit -m "feat(api): broadcast decision letters to dialog socket room"
```

---

### Task 7: Frontend dialog thread realtime + typing

**Files:**
- Create: `frontend/src/composables/useDialogThread.ts`
- Modify: `frontend/src/views/DialogThreadView.vue`

**Interfaces:**
- Consumes: `connectSocket`, `createTypingEmitter`, `typingLabelFor`, dialog REST APIs, `emitDialogMessage` event shape `{ message: BackendDialogMessage }`
- Produces: composable API used by `DialogThreadView`:
  - `messages`, `peerTypingLabel`, `loadState`, `send`, `notifyTypingInput`, `dispose`/lifecycle

- [ ] **Step 1: Implement `useDialogThread(dialogId: Ref<string> | ComputedRef<string>)`**

Behavior:

1. On mount / `dialogId` change: HTTP `fetchDialog`, then `socket.emit("dialog:join", { dialogId })`.
2. Listen `dialog:message` → map via same mapping as `mapDialogMessage` (export mapper from `api/dialogs.ts` if needed, or duplicate minimal map) → merge by `id`.
3. Listen `dialog:typing` → set `peerTypingLabel` when role ≠ current user role (derive role from `auth.user` vs `dialog.hrUserId`).
4. `createTypingEmitter` → `socket.emit("dialog:typing", { dialogId, isTyping })`.
5. `send`: HTTP `sendDialogMessage`; `typingEmitter.onSend()`; append/merge by id (dedupe if broadcast arrives too).
6. On unmount / id change: `typingEmitter.dispose()`; optionally emit typing false; leave previous room by joining new only (server leaves prev).

Export `mapDialogMessage` from `api/dialogs.ts` if not already exported:

```typescript
export function mapDialogMessage(message: BackendDialogMessage): DialogMessage { ... }
export type { BackendDialogMessage };
```

- [ ] **Step 2: Refactor `DialogThreadView.vue` to use composable**

Keep delete/peerLabel/loadError UX. Add under messages list:

```html
<p v-if="peerTypingLabel" class="typing">{{ peerTypingLabel }}</p>
```

```css
.typing {
  margin: 0.25rem 0 0;
  color: #666;
  font-size: 0.875rem;
  font-style: italic;
}
```

Textarea: `@input` / watch `draft` → `notifyTypingInput(draft)`.

- [ ] **Step 3: Smoke-check TypeScript**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: no errors in touched files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/composables/useDialogThread.ts frontend/src/views/DialogThreadView.vue frontend/src/api/dialogs.ts
git commit -m "feat(fe): realtime messages and typing in dialog threads"
```

---

### Task 8: Final verification

**Files:** none new (run only)

- [ ] **Step 1: Run backend focused tests**

```bash
cd backend && node --import tsx --test \
  src/socket/room.test.ts \
  src/socket/dialogs.test.ts \
  src/routes/dialogs.test.ts \
  src/routes/reports.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run frontend focused tests**

```bash
cd frontend && node --import tsx --test \
  src/utils/typing-indicator.test.ts \
  src/composables/useDialogUnread.test.ts
```

Expected: PASS.

- [ ] **Step 3: Spec checklist** — confirm each acceptance item in the design spec is met.

- [ ] **Step 4: No commit unless leftover fix needed**; if fix, commit separately with a clear message.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Live `room:typing` relay | Task 2 |
| Live UI labels + triggers | Tasks 1, 3 |
| Dialog join/typing | Task 4 |
| Realtime USER messages | Task 5 |
| Realtime DECISION_LETTER | Task 6 |
| Dialog UI + typing | Tasks 1, 7 |
| HTTP degrade if no socket | Tasks 5–7 (send still HTTP) |
| Own typing hidden | Tasks 2, 4 (`socket.to`) + UI filter |
| Tests for relay + broadcast | Tasks 2, 4, 5, 6 |
| Idle 2.5s / throttle 500ms | Task 1 |

No TBD placeholders. Types `DialogMessageDto` / event names consistent across tasks 4–7.

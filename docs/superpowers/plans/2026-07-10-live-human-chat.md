# Live Human Chat (Day 15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR і кандидат обмінюються повідомленнями в реальному часі через Socket.IO; кожне повідомлення зберігається в `LiveMessage` з `authorType: HUMAN_HR` або `HUMAN_CANDIDATE`.

**Architecture:** Express HTTP-сервер + Socket.IO на одному порту. Модуль `backend/src/socket/` (auth, room-access, room handlers). Фронт: singleton socket client, composable `useInterviewRoom`, спільний `LiveChatPanel`. Історія лише через `room:join` → `room:messages`.

**Tech Stack:** Express + Socket.IO + Prisma (backend), Vue 3 + socket.io-client + TypeScript (frontend), Node `node:test`/`assert`.

**Spec:** `docs/superpowers/specs/2026-07-10-live-human-chat-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/package.json` | Add `socket.io`; extend `test` script |
| `frontend/package.json` | Add `socket.io-client` |
| `backend/src/socket/types.ts` | Event payloads + `LiveMessageDto` |
| `backend/src/socket/room-access.ts` | `canAccessInterviewRoom()` |
| `backend/src/socket/room-access.test.ts` | Unit tests for access rules |
| `backend/src/socket/auth.ts` | JWT verification on socket handshake |
| `backend/src/socket/room.ts` | `registerRoomHandlers(io)` |
| `backend/src/server.ts` | `http.createServer` + Socket.IO bootstrap |
| `frontend/vite.config.ts` | Proxy `/socket.io` with WebSocket |
| `frontend/src/api/socket.ts` | Singleton `getSocket()` |
| `frontend/src/composables/useInterviewRoom.ts` | Join, send, message state |
| `frontend/src/components/LiveChatPanel.vue` | Chat UI |
| `frontend/src/views/HrInterviewRoomView.vue` | HR room page |
| `frontend/src/views/CandidateInterviewRoomView.vue` | Candidate room page |
| `frontend/src/router/index.ts` | Two new routes |
| `frontend/src/views/InterviewDetailView.vue` | «Увійти в кімнату» button |
| `frontend/src/views/CandidateInterviewView.vue` | «Увійти в кімнату» button |
| `README.md` | Day 15 Quick Start + socket events |

---

### Task 1: Install Socket.IO dependencies

**Files:**
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

- [ ] **Step 1: Install backend dependency**

Run from repo root:

```bash
npm install socket.io --workspace=backend
```

- [ ] **Step 2: Install frontend dependency**

```bash
npm install socket.io-client --workspace=frontend
```

- [ ] **Step 3: Commit**

```bash
git add backend/package.json frontend/package.json package-lock.json
git commit -m "chore: add socket.io dependencies for Day 15 live chat"
```

---

### Task 2: `canAccessInterviewRoom` unit tests (TDD)

**Files:**
- Create: `backend/src/socket/room-access.test.ts`
- Create: `backend/src/socket/room-access.ts`
- Modify: `backend/package.json` (add test file to `test` script)

- [ ] **Step 1: Write failing test file**

Create `backend/src/socket/room-access.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { canAccessInterviewRoom } from "./room-access";

const hrUser = { id: "hr_1", email: "hr@test.com", role: "HR" as const };
const candidateUser = { id: "cd_1", email: "candidate@test.com", role: "CANDIDATE" as const };
const otherHr = { id: "hr_2", email: "other@test.com", role: "HR" as const };

test("HR can access own interview when READY", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true });
});

test("HR can access own interview when LIVE", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "LIVE" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true });
});

test("HR cannot access another HR interview", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    otherHr,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Немає доступу");
});

test("candidate can access linked interview when READY", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    candidateUser,
  );
  assert.deepEqual(result, { ok: true });
});

test("candidate cannot access interview linked to another candidate", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_2", status: "READY" },
    candidateUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Немає доступу");
});

test("rejects AWAITING_CANDIDATE status", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "AWAITING_CANDIDATE" },
    hrUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Співбесіда ще не готова");
});

test("rejects ENDED status", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "ENDED" },
    hrUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Співбесіда завершена");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test --workspace=backend -- --test src/socket/room-access.test.ts
```

Expected: FAIL — module `./room-access` not found.

- [ ] **Step 3: Implement `room-access.ts`**

Create `backend/src/socket/room-access.ts`:

```ts
import type { Interview } from "@prisma/client";
import type { AuthUser } from "../auth/middleware";

const JOINABLE_STATUSES = ["READY", "LIVE"] as const;

export function canAccessInterviewRoom(
  interview: Pick<Interview, "hrUserId" | "candidateUserId" | "status">,
  user: AuthUser,
): { ok: true } | { ok: false; error: string } {
  if (interview.status === "ENDED") {
    return { ok: false, error: "Співбесіда завершена" };
  }

  if (
    !JOINABLE_STATUSES.includes(
      interview.status as (typeof JOINABLE_STATUSES)[number],
    )
  ) {
    return { ok: false, error: "Співбесіда ще не готова" };
  }

  if (user.role === "HR") {
    if (interview.hrUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    return { ok: true };
  }

  if (user.role === "CANDIDATE") {
    if (interview.candidateUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    return { ok: true };
  }

  return { ok: false, error: "Немає доступу" };
}
```

- [ ] **Step 4: Add test file to backend test script**

In `backend/package.json`, append `src/socket/room-access.test.ts` to the `test` script array (after `src/utils/interview-readiness.test.ts`).

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npm run test --workspace=backend -- --test src/socket/room-access.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/socket/room-access.ts backend/src/socket/room-access.test.ts backend/package.json
git commit -m "feat: add interview room access rules with unit tests"
```

---

### Task 3: Socket types and auth

**Files:**
- Create: `backend/src/socket/types.ts`
- Create: `backend/src/socket/auth.ts`

- [ ] **Step 1: Create `types.ts`**

Create `backend/src/socket/types.ts`:

```ts
export type LiveMessageDto = {
  id: string;
  authorType: "HUMAN_HR" | "HUMAN_CANDIDATE";
  content: string;
  createdAt: string;
};

export type RoomJoinPayload = {
  interviewId?: unknown;
};

export type RoomMessagePayload = {
  interviewId?: unknown;
  content?: unknown;
};

export type RoomMessagesEvent = {
  messages: LiveMessageDto[];
};

export type RoomStatusEvent = {
  status: "LIVE" | "ENDED";
};

export type RoomErrorEvent = {
  error: string;
};
```

- [ ] **Step 2: Create `auth.ts`**

Create `backend/src/socket/auth.ts`:

```ts
import type { Socket } from "socket.io";
import { verifyToken } from "../auth/jwt";
import type { AuthUser } from "../auth/middleware";

declare module "socket.io" {
  interface SocketData {
    user?: AuthUser;
  }
}

export function getSocketUser(socket: Socket): AuthUser | null {
  return socket.data.user ?? null;
}

export function attachSocketAuth(socket: Socket): boolean {
  const raw = socket.handshake.auth?.token;
  if (typeof raw !== "string" || !raw.trim()) {
    return false;
  }

  try {
    const payload = verifyToken(raw.trim());
    socket.data.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/socket/types.ts backend/src/socket/auth.ts
git commit -m "feat: add socket types and JWT handshake auth"
```

---

### Task 4: Room socket handlers

**Files:**
- Create: `backend/src/socket/room.ts`

- [ ] **Step 1: Create `room.ts`**

Create `backend/src/socket/room.ts`:

```ts
import type { Server, Socket } from "socket.io";
import type { LiveMessage, PrismaClient } from "@prisma/client";
import { attachSocketAuth, getSocketUser } from "./auth";
import { canAccessInterviewRoom } from "./room-access";
import type {
  LiveMessageDto,
  RoomJoinPayload,
  RoomMessagePayload,
} from "./types";

const MAX_CONTENT_LENGTH = 4000;

function roomName(interviewId: string): string {
  return `interview:${interviewId}`;
}

function toDto(message: LiveMessage): LiveMessageDto {
  const authorType = message.authorType;
  if (authorType !== "HUMAN_HR" && authorType !== "HUMAN_CANDIDATE") {
    throw new Error(`Unexpected authorType: ${authorType}`);
  }
  return {
    id: message.id,
    authorType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

function authorTypeForUser(role: "HR" | "CANDIDATE"): "HUMAN_HR" | "HUMAN_CANDIDATE" {
  return role === "HR" ? "HUMAN_HR" : "HUMAN_CANDIDATE";
}

async function loadInterview(prisma: PrismaClient, interviewId: string) {
  return prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, hrUserId: true, candidateUserId: true, status: true },
  });
}

async function ensureLiveSession(prisma: PrismaClient, interviewId: string) {
  return prisma.liveSession.upsert({
    where: { interviewId },
    create: { interviewId },
    update: {},
  });
}

export function registerRoomHandlers(
  io: Server,
  getPrisma: () => PrismaClient,
): void {
  io.use((socket, next) => {
    if (attachSocketAuth(socket)) {
      next();
    } else {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("room:join", async (payload: RoomJoinPayload) => {
      const user = getSocketUser(socket);
      if (!user) {
        socket.emit("room:error", { error: "Немає доступу" });
        return;
      }

      const interviewId =
        typeof payload?.interviewId === "string" ? payload.interviewId.trim() : "";
      if (!interviewId) {
        socket.emit("room:error", { error: "Невірний запит" });
        return;
      }

      const prisma = getPrisma();
      const interview = await loadInterview(prisma, interviewId);
      if (!interview) {
        socket.emit("room:error", { error: "Співбесіду не знайдено" });
        return;
      }

      const access = canAccessInterviewRoom(interview, user);
      if (!access.ok) {
        socket.emit("room:error", { error: access.error });
        return;
      }

      await socket.join(roomName(interviewId));
      const session = await ensureLiveSession(prisma, interviewId);

      if (interview.status === "READY") {
        await prisma.interview.update({
          where: { id: interviewId },
          data: { status: "LIVE" },
        });
        io.to(roomName(interviewId)).emit("room:status", { status: "LIVE" });
      }

      const messages = await prisma.liveMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "asc" },
      });

      socket.emit("room:messages", { messages: messages.map(toDto) });
    });

    socket.on("room:message", async (payload: RoomMessagePayload) => {
      const user = getSocketUser(socket);
      if (!user) {
        socket.emit("room:error", { error: "Немає доступу" });
        return;
      }

      const interviewId =
        typeof payload?.interviewId === "string" ? payload.interviewId.trim() : "";
      const content =
        typeof payload?.content === "string" ? payload.content.trim() : "";

      if (!interviewId) {
        socket.emit("room:error", { error: "Невірний запит" });
        return;
      }
      if (!content || content.length > MAX_CONTENT_LENGTH) {
        socket.emit("room:error", { error: "Порожнє або занадто довге повідомлення" });
        return;
      }

      const prisma = getPrisma();
      const interview = await loadInterview(prisma, interviewId);
      if (!interview) {
        socket.emit("room:error", { error: "Співбесіду не знайдено" });
        return;
      }

      if (interview.status === "ENDED") {
        socket.emit("room:error", { error: "Співбесіда завершена" });
        return;
      }

      const access = canAccessInterviewRoom(interview, user);
      if (!access.ok) {
        socket.emit("room:error", { error: access.error });
        return;
      }

      const session = await ensureLiveSession(prisma, interviewId);
      const saved = await prisma.liveMessage.create({
        data: {
          sessionId: session.id,
          authorType: authorTypeForUser(user.role),
          content,
        },
      });

      io.to(roomName(interviewId)).emit("room:messages", {
        messages: [toDto(saved)],
      });
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/socket/room.ts
git commit -m "feat: add Socket.IO room join and message handlers"
```

---

### Task 5: Bootstrap Socket.IO in `server.ts`

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Refactor server to use HTTP + Socket.IO**

Replace `backend/src/server.ts` with:

```ts
import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { getJwtConfig } from "./auth/jwt";
import { requireAuth, requireHr, requireCandidate } from "./auth/middleware";
import { prisma } from "./db/prisma";
import { createLlmProvider } from "./llm/factory";
import { createAuthRouter } from "./routes/auth";
import { createHealthRouter } from "./routes/health";
import { createInterviewsRouter } from "./routes/interviews";
import { createVacanciesRouter } from "./routes/vacancies";
import { createLlmRouter } from "./routes/llm";
import { createPrepRouter } from "./routes/prep";
import { createCandidatePrepRouter } from "./routes/candidate-prep";
import { createCandidateInterviewRouter } from "./routes/candidate-interview";
import { registerRoomHandlers } from "./socket/room";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: "http://localhost:5173",
  }),
);

app.use(express.json());

getJwtConfig();

app.use("/api", createHealthRouter(() => prisma));
app.use("/api", createAuthRouter(() => prisma));
app.use(
  "/api/candidate-prep",
  requireAuth,
  requireCandidate,
  createCandidatePrepRouter(() => prisma, () => createLlmProvider()),
);
app.use("/api/candidate", createCandidateInterviewRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createLlmRouter(() => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, () => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createInterviewsRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createVacanciesRouter(() => prisma));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
  },
});

registerRoomHandlers(io, () => prisma);

httpServer.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
```

- [ ] **Step 2: Verify backend compiles**

Run:

```bash
npm run lint --workspace=backend
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat: bootstrap Socket.IO on shared HTTP server"
```

---

### Task 6: Vite WebSocket proxy

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Add `/socket.io` proxy**

Update `frontend/vite.config.ts` `server.proxy`:

```ts
proxy: {
  "/api": {
    target: "http://localhost:3000",
    changeOrigin: true,
  },
  "/socket.io": {
    target: "http://localhost:3000",
    changeOrigin: true,
    ws: true,
  },
},
```

- [ ] **Step 2: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "chore: proxy socket.io through Vite dev server"
```

---

### Task 7: Frontend socket client and composable

**Files:**
- Create: `frontend/src/api/socket.ts`
- Create: `frontend/src/composables/useInterviewRoom.ts`

- [ ] **Step 1: Create socket singleton**

Create `frontend/src/api/socket.ts`:

```ts
import { io, type Socket } from "socket.io-client";
import { getStoredToken } from "./client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      auth: {
        token: getStoredToken() ?? "",
      },
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const client = getSocket();
  const token = getStoredToken() ?? "";
  client.auth = { token };
  if (!client.connected) {
    client.connect();
  }
  return client;
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}
```

- [ ] **Step 2: Create composable**

Create `frontend/src/composables/useInterviewRoom.ts`:

```ts
import { onMounted, onUnmounted, ref } from "vue";
import { connectSocket } from "../api/socket";

export type LiveMessage = {
  id: string;
  authorType: "HUMAN_HR" | "HUMAN_CANDIDATE";
  content: string;
  createdAt: string;
};

export type RoomConnectionState = "connecting" | "connected" | "error";

export function useInterviewRoom(interviewId: string, currentRole: "HR" | "CANDIDATE") {
  const messages = ref<LiveMessage[]>([]);
  const connectionState = ref<RoomConnectionState>("connecting");
  const errorMessage = ref<string | null>(null);
  const interviewStatus = ref<"READY" | "LIVE" | "ENDED" | null>(null);

  const socket = connectSocket();

  function mergeMessages(incoming: LiveMessage[]): void {
    const byId = new Map(messages.value.map((item) => [item.id, item]));
    for (const item of incoming) {
      byId.set(item.id, item);
    }
    messages.value = [...byId.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  function onConnect(): void {
    connectionState.value = "connected";
    errorMessage.value = null;
    socket.emit("room:join", { interviewId });
  }

  function onDisconnect(): void {
    connectionState.value = "connecting";
  }

  function onConnectError(): void {
    connectionState.value = "error";
    errorMessage.value = "Не вдалося підключитися до кімнати";
  }

  function onMessages(payload: { messages?: LiveMessage[] }): void {
    if (Array.isArray(payload?.messages)) {
      mergeMessages(payload.messages);
    }
  }

  function onStatus(payload: { status?: "LIVE" | "ENDED" }): void {
    if (payload?.status) {
      interviewStatus.value = payload.status;
    }
  }

  function onError(payload: { error?: string }): void {
    connectionState.value = "error";
    errorMessage.value = payload?.error ?? "Помилка кімнати";
  }

  function sendMessage(content: string): void {
    const text = content.trim();
    if (!text || connectionState.value !== "connected") return;
    if (interviewStatus.value === "ENDED") return;
    socket.emit("room:message", { interviewId, content: text });
  }

  onMounted(() => {
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:messages", onMessages);
    socket.on("room:status", onStatus);
    socket.on("room:error", onError);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }
  });

  onUnmounted(() => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
    socket.off("room:messages", onMessages);
    socket.off("room:status", onStatus);
    socket.off("room:error", onError);
  });

  const isReadOnly =
    interviewStatus.value === "ENDED" || connectionState.value === "error";

  return {
    messages,
    connectionState,
    errorMessage,
    interviewStatus,
    currentRole,
    sendMessage,
    isReadOnly,
  };
}
```

Note: `isReadOnly` above is not reactive as written — fix in implementation by using `computed`:

```ts
import { computed, onMounted, onUnmounted, ref } from "vue";
// ...
const isReadOnly = computed(
  () => interviewStatus.value === "ENDED" || connectionState.value === "error",
);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/socket.ts frontend/src/composables/useInterviewRoom.ts
git commit -m "feat: add socket client and useInterviewRoom composable"
```

---

### Task 8: `LiveChatPanel` component

**Files:**
- Create: `frontend/src/components/LiveChatPanel.vue`

- [ ] **Step 1: Create chat panel**

Create `frontend/src/components/LiveChatPanel.vue`:

```vue
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { LiveMessage } from "../composables/useInterviewRoom";

const props = defineProps<{
  messages: LiveMessage[];
  currentRole: "HR" | "CANDIDATE";
  connectionState: "connecting" | "connected" | "error";
  disabled?: boolean;
  errorMessage?: string | null;
}>();

const emit = defineEmits<{
  send: [content: string];
}>();

const input = ref("");
const messagesEl = ref<HTMLElement | null>(null);

const ownAuthorType = computed(() =>
  props.currentRole === "HR" ? "HUMAN_HR" : "HUMAN_CANDIDATE",
);

function labelFor(authorType: LiveMessage["authorType"]): string {
  return authorType === "HUMAN_HR" ? "HR" : "Кандидат";
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => props.messages.length,
  () => {
    void scrollToBottom();
  },
);

function sendMessage(): void {
  const text = input.value.trim();
  if (!text || props.disabled) return;
  emit("send", text);
  input.value = "";
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}
</script>

<template>
  <section class="chat-panel">
    <p v-if="connectionState === 'connecting'" class="status-hint">Підключення до кімнати…</p>
    <p v-else-if="connectionState === 'error'" class="error-banner" role="alert">
      {{ errorMessage ?? "Помилка підключення" }}
    </p>

    <div ref="messagesEl" class="messages" role="log" aria-live="polite">
      <p v-if="messages.length === 0" class="empty-hint">
        Напишіть перше повідомлення, щоб почати діалог.
      </p>
      <div
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="{ own: message.authorType === ownAuthorType }"
      >
        <span class="message-label">{{ labelFor(message.authorType) }}</span>
        <p class="message-text">{{ message.content }}</p>
      </div>
    </div>

    <form class="composer" @submit.prevent="sendMessage">
      <textarea
        v-model="input"
        class="composer-input"
        rows="2"
        placeholder="Напишіть повідомлення…"
        :disabled="disabled || connectionState !== 'connected'"
        @keydown="onKeydown"
      />
      <button
        type="submit"
        class="btn-primary"
        :disabled="disabled || connectionState !== 'connected' || !input.trim()"
      >
        Надіслати
      </button>
    </form>
  </section>
</template>

<style scoped>
.chat-panel {
  margin-top: 1rem;
}
.status-hint {
  margin: 0 0 0.75rem;
  color: #666;
  font-size: 0.875rem;
}
.messages {
  max-height: 24rem;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: #fafafa;
  margin-bottom: 0.75rem;
}
.empty-hint {
  margin: 0;
  color: #666;
  font-size: 0.9rem;
}
.message {
  margin-bottom: 0.75rem;
  max-width: 85%;
}
.message.own {
  margin-left: auto;
  text-align: right;
}
.message-label {
  display: block;
  font-size: 0.75rem;
  color: #666;
  margin-bottom: 0.25rem;
}
.message-text {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  white-space: pre-wrap;
  word-break: break-word;
  background: #e5e7eb;
  color: #1f2937;
}
.message.own .message-text {
  background: #dbeafe;
  color: #1e3a5f;
}
.error-banner {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: #b00020;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.composer {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}
.composer-input {
  flex: 1;
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  resize: vertical;
  min-height: 2.5rem;
}
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}
.btn-primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/LiveChatPanel.vue
git commit -m "feat: add LiveChatPanel for interview room"
```

---

### Task 9: Room views and router

**Files:**
- Create: `frontend/src/views/HrInterviewRoomView.vue`
- Create: `frontend/src/views/CandidateInterviewRoomView.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: Create HR room view**

Create `frontend/src/views/HrInterviewRoomView.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import LiveChatPanel from "../components/LiveChatPanel.vue";
import { useInterviewRoom } from "../composables/useInterviewRoom";

const route = useRoute();
const interviewId = computed(() => String(route.params.id));

const {
  messages,
  connectionState,
  errorMessage,
  sendMessage,
  isReadOnly,
} = useInterviewRoom(interviewId.value, "HR");
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink :to="`/interviews/${interviewId}`" class="back-link">
        ← Назад до співбесіди
      </RouterLink>
    </header>
    <h1>Жива кімната</h1>
    <LiveChatPanel
      :messages="messages"
      current-role="HR"
      :connection-state="connectionState"
      :disabled="isReadOnly"
      :error-message="errorMessage"
      @send="sendMessage"
    />
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
}
.header {
  margin-bottom: 1rem;
}
.back-link {
  color: #2563eb;
  text-decoration: none;
  font-size: 0.875rem;
}
h1 {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
</style>
```

- [ ] **Step 2: Create candidate room view**

Create `frontend/src/views/CandidateInterviewRoomView.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import LiveChatPanel from "../components/LiveChatPanel.vue";
import { useInterviewRoom } from "../composables/useInterviewRoom";
import { fetchCandidateInterview } from "../api/candidate-interview";

const interviewId = ref<string | null>(null);
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    const interview = await fetchCandidateInterview();
    if (!interview) {
      loadError.value = "Спочатку приєднайтеся до співбесіди";
      return;
    }
    interviewId.value = interview.id;
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
});

const room = ref<ReturnType<typeof useInterviewRoom> | null>(null);

// Re-init composable when interviewId is known
import { watch } from "vue";
watch(interviewId, (id) => {
  if (id) {
    room.value = useInterviewRoom(id, "CANDIDATE");
  }
});
</script>
```

The candidate view above has a composable lifecycle issue — implement with a cleaner pattern:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import LiveChatPanel from "../components/LiveChatPanel.vue";
import { useInterviewRoom } from "../composables/useInterviewRoom";
import { fetchCandidateInterview } from "../api/candidate-interview";

const interviewId = ref<string | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    const interview = await fetchCandidateInterview();
    if (!interview) {
      loadState.value = "error";
      loadError.value = "Спочатку приєднайтеся до співбесіди";
      return;
    }
    interviewId.value = interview.id;
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
});

const activeId = computed(() => interviewId.value ?? "");
const room = computed(() =>
  interviewId.value ? useInterviewRoom(interviewId.value, "CANDIDATE") : null,
);
</script>
```

Composable cannot be called inside `computed` — fix by using `shallowRef` + watch:

Final `CandidateInterviewRoomView.vue` implementation:

```vue
<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import LiveChatPanel from "../components/LiveChatPanel.vue";
import { useInterviewRoom } from "../composables/useInterviewRoom";
import { fetchCandidateInterview } from "../api/candidate-interview";

const loadState = ref<"loading" | "ready" | "error">("loading");
const loadError = ref<string | null>(null);
const room = shallowRef<ReturnType<typeof useInterviewRoom> | null>(null);

onMounted(async () => {
  try {
    const interview = await fetchCandidateInterview();
    if (!interview) {
      loadState.value = "error";
      loadError.value = "Спочатку приєднайтеся до співбесіди";
      return;
    }
    room.value = useInterviewRoom(interview.id, "CANDIDATE");
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
});
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink to="/candidate/interview" class="back-link">← Назад до співбесіди</RouterLink>
    </header>
    <h1>Жива кімната</h1>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ loadError }}</p>

    <LiveChatPanel
      v-else-if="room"
      :messages="room.messages"
      current-role="CANDIDATE"
      :connection-state="room.connectionState"
      :disabled="room.isReadOnly"
      :error-message="room.errorMessage"
      @send="room.sendMessage"
    />
  </main>
</template>
```

Use `.value` unwrapping in template for refs returned from shallowRef object — in template `room.messages` auto-unwraps refs inside? Actually `room` is shallowRef to object containing refs — template needs `room.messages` which won't auto-unwrap nested refs.

Fix: destructure in script after init:

```vue
const messages = computed(() => room.value?.messages.value ?? []);
```

Simplest approach for plan: pass individual refs from composable at top level in HR view; for candidate view, call `useInterviewRoom` only after interviewId loaded using `v-if` wrapper component or inline:

```vue
<InterviewRoomContent v-if="interviewId" :interview-id="interviewId" role="CANDIDATE" />
```

Add small wrapper `InterviewRoomContent.vue` OR keep candidate view simple: fetch interviewId in parent, then:

```vue
<template>
  <CandidateRoomChat v-if="interviewId" :interview-id="interviewId" />
</template>
```

For plan simplicity, use **inline child component** in same file or separate `InterviewRoomContent.vue`.

Plan decision: create `frontend/src/components/InterviewRoomContent.vue` used by both HR and candidate views.

Actually HR view can call useInterviewRoom directly at setup top level since interviewId from route is always available. Candidate needs async load first.

Create `InterviewRoomContent.vue`:

```vue
<script setup lang="ts">
import LiveChatPanel from "./LiveChatPanel.vue";
import { useInterviewRoom } from "../composables/useInterviewRoom";

const props = defineProps<{
  interviewId: string;
  currentRole: "HR" | "CANDIDATE";
}>();

const {
  messages,
  connectionState,
  errorMessage,
  sendMessage,
  isReadOnly,
} = useInterviewRoom(props.interviewId, props.currentRole);
</script>

<template>
  <LiveChatPanel
    :messages="messages"
    :current-role="currentRole"
    :connection-state="connectionState"
    :disabled="isReadOnly"
    :error-message="errorMessage"
    @send="sendMessage"
  />
</template>
```

Then both room views become thin shells. Update plan accordingly.

- [ ] **Step 3: Create `InterviewRoomContent.vue`**

Create `frontend/src/components/InterviewRoomContent.vue` (code above).

- [ ] **Step 4: Simplify room views**

`HrInterviewRoomView.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import InterviewRoomContent from "../components/InterviewRoomContent.vue";

const route = useRoute();
const interviewId = computed(() => String(route.params.id));
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink :to="`/interviews/${interviewId}`" class="back-link">
        ← Назад до співбесіди
      </RouterLink>
    </header>
    <h1>Жива кімната</h1>
    <InterviewRoomContent :interview-id="interviewId" current-role="HR" />
  </main>
</template>
```

`CandidateInterviewRoomView.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import InterviewRoomContent from "../components/InterviewRoomContent.vue";
import { fetchCandidateInterview } from "../api/candidate-interview";

const interviewId = ref<string | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    const interview = await fetchCandidateInterview();
    if (!interview) {
      loadState.value = "error";
      loadError.value = "Спочатку приєднайтеся до співбесіди";
      return;
    }
    interviewId.value = interview.id;
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
});
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink to="/candidate/interview" class="back-link">← Назад до співбесіди</RouterLink>
    </header>
    <h1>Жива кімната</h1>
    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ loadError }}</p>
    <InterviewRoomContent
      v-else-if="interviewId"
      :interview-id="interviewId"
      current-role="CANDIDATE"
    />
  </main>
</template>
```

- [ ] **Step 5: Add router routes**

In `frontend/src/router/index.ts`, add imports:

```ts
import HrInterviewRoomView from "../views/HrInterviewRoomView.vue";
import CandidateInterviewRoomView from "../views/CandidateInterviewRoomView.vue";
```

Add HR child route after `interview-detail`:

```ts
{
  path: "interviews/:id/room",
  name: "interview-room",
  component: HrInterviewRoomView,
},
```

Add candidate child route after `candidate-interview`:

```ts
{ path: "interview/room", name: "candidate-interview-room", component: CandidateInterviewRoomView },
```

- [ ] **Step 6: Verify frontend compiles**

Run:

```bash
npm run lint --workspace=frontend
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/InterviewRoomContent.vue frontend/src/views/HrInterviewRoomView.vue frontend/src/views/CandidateInterviewRoomView.vue frontend/src/router/index.ts
git commit -m "feat: add interview room views and routes"
```

---

### Task 10: Entry buttons on detail pages

**Files:**
- Modify: `frontend/src/views/InterviewDetailView.vue`
- Modify: `frontend/src/views/CandidateInterviewView.vue`

- [ ] **Step 1: Update `InterviewDetailView.vue`**

Add computed:

```ts
const canEnterRoom = computed(
  () => interview.value?.status === "READY" || interview.value?.status === "LIVE",
);
```

Replace placeholder `<p class="muted">…</p>` with:

```vue
<RouterLink
  v-if="canEnterRoom"
  :to="`/interviews/${interviewId}/room`"
  class="btn-primary"
>
  Увійти в кімнату
</RouterLink>
<p v-else class="muted">
  Кімната буде доступна, коли обидва профілі підтверджені (статус «Обидва готові»).
</p>
```

Add styles:

```css
.btn-primary {
  display: inline-block;
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  text-decoration: none;
  background: #2563eb;
  color: #fff;
}
```

- [ ] **Step 2: Update `CandidateInterviewView.vue`**

Add import `RouterLink`, computed `canEnterRoom`, same button pattern linking to `/candidate/interview/room`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/InterviewDetailView.vue frontend/src/views/CandidateInterviewView.vue
git commit -m "feat: add enter room buttons on interview detail pages"
```

---

### Task 11: README Day 15 documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Expand Day 15 section**

After the existing Day 15 Definition of Done block, add:

```markdown
### Live Chat Quick Start (Day 15)

**1. Підготувати співбесіду в статусі READY**

- HR: анкета confirmed, співбесіда створена
- Кандидат: приєднався за кодом, профіль confirmed
- Статус співбесіди: «Обидва готові» (`READY`)

**2. Відкрити дві вкладки**

| Роль | URL |
|------|-----|
| HR | `http://localhost:5173/interviews/:id` → «Увійти в кімнату» |
| Кандидат | `http://localhost:5173/candidate/interview` → «Увійти в кімнату» |

**3. Перевірити realtime**

- Написати повідомлення в одній вкладці → миттєво з’являється в іншій
- Перезавантажити обидві вкладки → історія відновлюється
- Статус співбесіди → `LIVE` після першого входу в кімнату

**Socket events**

| Напрям | Подія | Payload |
|--------|-------|---------|
| client → server | `room:join` | `{ interviewId: string }` |
| client → server | `room:message` | `{ interviewId: string, content: string }` |
| server → client | `room:messages` | `{ messages: LiveMessageDto[] }` |
| server → client | `room:status` | `{ status: "LIVE" \| "ENDED" }` |
| server → client | `room:error` | `{ error: string }` |

Auth: JWT у `handshake.auth.token` (той самий `auth_token` з localStorage).

Повідомлення зберігаються в `LiveSession` / `LiveMessage` з `authorType: HUMAN_HR` або `HUMAN_CANDIDATE`.
```

Update DoD checkbox text for authorType to match schema (`HUMAN_HR` / `HUMAN_CANDIDATE` instead of `HUMAN`).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Day 15 live chat quick start and socket events"
```

---

### Task 12: Final verification

**Files:** (none — verification only)

- [ ] **Step 1: Run backend tests**

```bash
npm run test --workspace=backend
```

Expected: all tests PASS (including `room-access.test.ts`).

- [ ] **Step 2: Run full build**

```bash
npm run build
```

Expected: frontend and backend build without errors.

- [ ] **Step 3: Manual smoke test**

1. `npm run dev` from repo root
2. Login HR (`hr@test.com` / `123456`) and candidate (`candidate@test.com` / `123456`) in two browser tabs
3. Ensure interview is `READY`
4. Enter room from both sides, exchange messages, reload — history persists

- [ ] **Step 4: Mark README DoD checkboxes**

Update Day 15 Definition of Done items to `[x]` in README.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "chore: mark Day 15 live chat DoD complete"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Socket.IO room join + message | Task 4, 5 |
| JWT handshake auth | Task 3 |
| `LiveSession` upsert on join | Task 4 |
| `READY` → `LIVE` transition | Task 4 |
| `HUMAN_HR` / `HUMAN_CANDIDATE` authorType | Task 4 |
| History via `room:join` → `room:messages` | Task 4, 7 |
| Routes `/interviews/:id/room`, `/candidate/interview/room` | Task 9 |
| Entry buttons on detail pages | Task 10 |
| Vite socket proxy | Task 6 |
| `canAccessInterviewRoom` unit tests | Task 2 |
| README socket events | Task 11 |
| `npm run build` | Task 12 |

No placeholder steps. `isReadOnly` must use `computed` in composable (noted in Task 7). Candidate room uses `InterviewRoomContent` wrapper to avoid composable lifecycle issues (Task 9).

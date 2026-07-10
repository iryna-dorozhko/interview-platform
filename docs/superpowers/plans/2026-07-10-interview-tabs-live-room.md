# Interview Tabs + Live Room End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end флоу вкладок «Співбесіда» (HR/кандидат) з live-кімнатою, presence-based переходом у `LIVE`, видаленням співбесід і gating агентів до `LIVE`.

**Architecture:** Розширити REST (`DELETE /interviews`, `reportSummary`) і socket-шар (`room-access` з `readOnly`, `room-presence`, `maybeTransitionToLive`). HR входить у кімнату при `AWAITING_CANDIDATE`; кандидат — при `READY`/`LIVE`. Orchestrator запускається лише при `LIVE`. Фронт: двокрокова `CreateInterviewModal`, таблиця з delete, room views з phase banners.

**Tech Stack:** Express + Socket.IO + Prisma (backend), Vue 3 + socket.io-client + TypeScript (frontend), Node `node:test`/`assert`.

**Spec:** `docs/superpowers/specs/2026-07-10-interview-tabs-live-room-design.md`

**Prerequisite:** Якщо socket-файли відсутні у гілці, Tasks 6–10 відновлюють Day 15/16 bootstrap з amendments з цієї спеки (не копіювати старий `READY→LIVE` на першому join).

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/routes/interviews.ts` | `DELETE`, `reportSummary` |
| `backend/src/routes/interviews.test.ts` | Delete + report tests |
| `backend/src/socket/room-access.ts` | Role/status access + `readOnly` |
| `backend/src/socket/room-access.test.ts` | Access matrix tests |
| `backend/src/socket/room-presence.ts` | In-memory HR/candidate counts |
| `backend/src/socket/room-presence.test.ts` | Presence unit tests |
| `backend/src/socket/maybe-transition-live.ts` | `READY` + both present → `LIVE` |
| `backend/src/socket/maybe-transition-live.test.ts` | Transition unit tests |
| `backend/src/socket/types.ts` | Socket event DTOs |
| `backend/src/socket/auth.ts` | JWT on handshake |
| `backend/src/socket/room.ts` | Join/message handlers + presence |
| `backend/src/socket/orchestrator.ts` | Debounce stub; gate `LIVE` |
| `backend/src/agents/stub-arbiter.ts` | Stub Arbiter (Day 16) |
| `backend/src/server.ts` | `http.createServer` + Socket.IO |
| `frontend/src/api/interviews.ts` | `deleteInterview()` |
| `frontend/src/views/InterviewListView.vue` | Table, create, delete |
| `frontend/src/components/CreateInterviewModal.vue` | Two-step wizard |
| `frontend/src/views/HrHomeView.vue` | Remove create UI |
| `frontend/src/components/JoinInterviewModal.vue` | Button label |
| `frontend/src/views/CandidateInterviewView.vue` | Room entry button |
| `frontend/src/composables/useInterviewRoom.ts` | Socket composable |
| `frontend/src/components/LiveChatPanel.vue` | Chat UI + banners |
| `frontend/src/views/InterviewRoomView.vue` | HR room page |
| `frontend/src/views/CandidateInterviewRoomView.vue` | Candidate room page |
| `frontend/src/router/index.ts` | Room routes |
| `frontend/vite.config.ts` | `/socket.io` proxy |
| `README.md` | End-to-end Quick Start |

---

### Task 1: `DELETE /api/interviews/:id` (TDD)

**Files:**
- Modify: `backend/src/routes/interviews.test.ts`
- Modify: `backend/src/routes/interviews.ts`

- [ ] **Step 1: Write failing delete tests**

Append to `backend/src/routes/interviews.test.ts`:

```ts
test("DELETE /interviews/:id returns 404 when not found", async () => {
  const { app } = mountRouter([], []);
  const res = await request(app, "DELETE", "/interviews/missing");
  assert.equal(res.status, 404);
});

test("DELETE /interviews/:id returns 403 for another HR", async () => {
  const interviews = [
    {
      id: "int_1",
      hrUserId: "hr_1",
      vacancyId: "vac_1",
      displayName: "Backend",
      joinCode: "ABC123",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ];
  const { app } = mountRouter(interviews, [], "hr_2");
  const res = await request(app, "DELETE", "/interviews/int_1");
  assert.equal(res.status, 403);
});

test("DELETE /interviews/:id cascades and returns 204", async () => {
  const deleted: string[] = [];
  const interviews = [
    {
      id: "int_1",
      hrUserId: "hr_1",
      vacancyId: "vac_1",
      displayName: "Backend",
      joinCode: "ABC123",
      status: "ENDED",
      createdAt: new Date(),
    },
  ];
  const prisma = makeFakePrisma(interviews, []);
  prisma.interview.delete = async ({ where }: { where: { id: string } }) => {
    deleted.push(where.id);
    return interviews[0];
  };
  prisma.$transaction = async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma);
  prisma.liveSession = {
    findUnique: async () => ({ id: "ls_1" }),
    delete: async () => ({ id: "ls_1" }),
  };
  prisma.liveMessage = { deleteMany: async () => ({ count: 1 }) };
  prisma.prepSessionCandidate = {
    findUnique: async () => ({ id: "ps_1" }),
    delete: async () => ({ id: "ps_1" }),
  };
  prisma.prepMessageCandidate = { deleteMany: async () => ({ count: 1 }) };
  prisma.candidateProfile = { deleteMany: async () => ({ count: 1 }) };
  prisma.finalReport = { deleteMany: async () => ({ count: 1 }) };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user?: AuthUser }).user = {
      id: "hr_1",
      email: "hr@test.com",
      role: "HR",
    };
    next();
  });
  app.use(createInterviewsRouter(() => prisma as never));

  const res = await request(app, "DELETE", "/interviews/int_1");
  assert.equal(res.status, 204);
  assert.deepEqual(deleted, ["int_1"]);
});
```

(Adapt `mountRouter` / `request` helpers to match existing patterns in the file.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=backend -- --test src/routes/interviews.test.ts
```

Expected: FAIL — `DELETE` route not registered.

- [ ] **Step 3: Implement delete handler**

Add to `backend/src/routes/interviews.ts` before `return router`:

```ts
router.delete("/interviews/:id", async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const interview = await prisma.interview.findUnique({ where: { id: req.params.id } });

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  if (interview.hrUserId !== req.user?.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const liveSession = await tx.liveSession.findUnique({
      where: { interviewId: interview.id },
    });
    if (liveSession) {
      await tx.liveMessage.deleteMany({ where: { sessionId: liveSession.id } });
      await tx.liveSession.delete({ where: { id: liveSession.id } });
    }

    const prepSession = await tx.prepSessionCandidate.findUnique({
      where: { interviewId: interview.id },
    });
    if (prepSession) {
      await tx.prepMessageCandidate.deleteMany({ where: { sessionId: prepSession.id } });
      await tx.prepSessionCandidate.delete({ where: { id: prepSession.id } });
    }

    await tx.candidateProfile.deleteMany({ where: { interviewId: interview.id } });
    await tx.finalReport.deleteMany({ where: { interviewId: interview.id } });
    await tx.interview.delete({ where: { id: interview.id } });
  });

  res.status(204).end();
});
```

- [ ] **Step 4: Run tests**

```bash
npm run test --workspace=backend -- --test src/routes/interviews.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts
git commit -m "feat: add DELETE /api/interviews/:id with cascade"
```

---

### Task 2: `reportSummary` in list endpoint

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`

- [ ] **Step 1: Extend `findMany` include and map**

In `GET /interviews/mine`, change query:

```ts
include: {
  vacancy: { select: { title: true } },
  finalReport: { select: { recommendation: true } },
},
```

Map response:

```ts
reportSummary: item.finalReport?.recommendation ?? null,
```

Apply same pattern to `GET /interviews/:id`.

- [ ] **Step 2: Add test with finalReport mock**

- [ ] **Step 3: Run tests and commit**

```bash
git commit -m "feat: expose reportSummary from FinalReport in interview list"
```

---

### Task 3: `canAccessInterviewRoom` with `readOnly` (TDD)

**Files:**
- Create: `backend/src/socket/room-access.test.ts`
- Create: `backend/src/socket/room-access.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing tests**

Create `backend/src/socket/room-access.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { canAccessInterviewRoom } from "./room-access";

const hrUser = { id: "hr_1", email: "hr@test.com", role: "HR" as const };
const candidateUser = { id: "cd_1", email: "c@test.com", role: "CANDIDATE" as const };

test("HR can access AWAITING_CANDIDATE (not read-only)", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: null, status: "AWAITING_CANDIDATE" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true, readOnly: false });
});

test("HR can access ENDED read-only", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "ENDED" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true, readOnly: true });
});

test("candidate rejected at AWAITING_CANDIDATE", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "AWAITING_CANDIDATE" },
    candidateUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Співбесіда ще не готова");
});

test("candidate can access READY", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    candidateUser,
  );
  assert.deepEqual(result, { ok: true, readOnly: false });
});
```

- [ ] **Step 2: Implement `room-access.ts`**

```ts
import type { Interview } from "@prisma/client";
import type { AuthUser } from "../auth/middleware";

const HR_STATUSES = ["AWAITING_CANDIDATE", "READY", "LIVE", "ENDED"] as const;
const CANDIDATE_STATUSES = ["READY", "LIVE", "ENDED"] as const;

export type RoomAccessResult =
  | { ok: true; readOnly: boolean }
  | { ok: false; error: string };

export function canAccessInterviewRoom(
  interview: Pick<Interview, "hrUserId" | "candidateUserId" | "status">,
  user: AuthUser,
): RoomAccessResult {
  if (user.role === "HR") {
    if (interview.hrUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    if (!HR_STATUSES.includes(interview.status as (typeof HR_STATUSES)[number])) {
      return { ok: false, error: "Немає доступу" };
    }
    return { ok: true, readOnly: interview.status === "ENDED" };
  }

  if (user.role === "CANDIDATE") {
    if (interview.candidateUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    if (!CANDIDATE_STATUSES.includes(interview.status as (typeof CANDIDATE_STATUSES)[number])) {
      return { ok: false, error: "Співбесіда ще не готова" };
    }
    return { ok: true, readOnly: interview.status === "ENDED" };
  }

  return { ok: false, error: "Немає доступу" };
}
```

- [ ] **Step 3: Add to test script, run, commit**

```bash
git commit -m "feat: extend room access for early HR entry and read-only ENDED"
```

---

### Task 4: `room-presence` module (TDD)

**Files:**
- Create: `backend/src/socket/room-presence.test.ts`
- Create: `backend/src/socket/room-presence.ts`

- [ ] **Step 1: Write failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { trackJoin, trackLeave, getPresence, resetPresenceForTests } from "./room-presence";

test("trackJoin increments role counts", () => {
  resetPresenceForTests();
  trackJoin("interview:int_1", "HR");
  trackJoin("interview:int_1", "CANDIDATE");
  assert.deepEqual(getPresence("interview:int_1"), { hrCount: 1, candidateCount: 1 });
});

test("trackLeave decrements without going negative", () => {
  resetPresenceForTests();
  trackJoin("interview:int_1", "HR");
  trackLeave("interview:int_1", "HR");
  trackLeave("interview:int_1", "HR");
  assert.deepEqual(getPresence("interview:int_1"), { hrCount: 0, candidateCount: 0 });
});
```

- [ ] **Step 2: Implement**

```ts
export type RoomRole = "HR" | "CANDIDATE";
export type RoomPresence = { hrCount: number; candidateCount: number };

const store = new Map<string, RoomPresence>();

function empty(): RoomPresence {
  return { hrCount: 0, candidateCount: 0 };
}

export function getPresence(roomId: string): RoomPresence {
  return store.get(roomId) ?? empty();
}

export function trackJoin(roomId: string, role: RoomRole): RoomPresence {
  const current = { ...getPresence(roomId) };
  if (role === "HR") current.hrCount += 1;
  else current.candidateCount += 1;
  store.set(roomId, current);
  return current;
}

export function trackLeave(roomId: string, role: RoomRole): RoomPresence {
  const current = { ...getPresence(roomId) };
  if (role === "HR") current.hrCount = Math.max(0, current.hrCount - 1);
  else current.candidateCount = Math.max(0, current.candidateCount - 1);
  store.set(roomId, current);
  return current;
}

export function resetPresenceForTests(): void {
  store.clear();
}
```

- [ ] **Step 3: Run tests, commit**

---

### Task 5: `maybeTransitionToLive` (TDD)

**Files:**
- Create: `backend/src/socket/maybe-transition-live.test.ts`
- Create: `backend/src/socket/maybe-transition-live.ts`

- [ ] **Step 1: Write failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { shouldTransitionToLive } from "./maybe-transition-live";

test("transitions when READY and both present", () => {
  assert.equal(
    shouldTransitionToLive("READY", { hrCount: 1, candidateCount: 1 }),
    true,
  );
});

test("no transition when only HR present", () => {
  assert.equal(
    shouldTransitionToLive("READY", { hrCount: 1, candidateCount: 0 }),
    false,
  );
});

test("no transition when AWAITING_CANDIDATE", () => {
  assert.equal(
    shouldTransitionToLive("AWAITING_CANDIDATE", { hrCount: 1, candidateCount: 1 }),
    false,
  );
});
```

- [ ] **Step 2: Implement pure helper + async updater**

`maybe-transition-live.ts`:

```ts
import type { Server } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import type { RoomPresence } from "./room-presence";

export function shouldTransitionToLive(
  status: string,
  presence: RoomPresence,
): boolean {
  return (
    status === "READY" &&
    presence.hrCount > 0 &&
    presence.candidateCount > 0
  );
}

export function roomName(interviewId: string): string {
  return `interview:${interviewId}`;
}

export async function maybeTransitionToLive(
  io: Server,
  prisma: PrismaClient,
  interviewId: string,
  presence: RoomPresence,
): Promise<void> {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
  if (!interview || !shouldTransitionToLive(interview.status, presence)) {
    return;
  }

  await prisma.interview.update({
    where: { id: interviewId },
    data: { status: "LIVE" },
  });

  io.to(roomName(interviewId)).emit("room:status", { status: "LIVE" });
}
```

- [ ] **Step 3: Run tests, commit**

---

### Task 6: Socket bootstrap + `room.ts` handlers

**Files:**
- Create: `backend/src/socket/types.ts`, `auth.ts`, `room.ts`
- Create: `backend/src/agents/stub-arbiter.ts`, `orchestrator.ts`
- Modify: `backend/src/server.ts`, `backend/package.json`, `frontend/package.json`, `frontend/vite.config.ts`

- [ ] **Step 1: Install deps (if missing)**

```bash
npm install socket.io --workspace=backend
npm install socket.io-client --workspace=frontend
```

- [ ] **Step 2: Implement socket auth** (`auth.ts` — JWT from `handshake.auth.token`, disconnect if invalid)

- [ ] **Step 3: Implement `room.ts`**

Key behavior in `room:join`:

1. Load interview, `canAccessInterviewRoom`
2. `socket.join(roomName(interviewId))`
3. Store on socket: `{ interviewId, role: user.role === "HR" ? "HR" : "CANDIDATE" }`
4. `trackJoin(roomName, role)`
5. `ensureLiveSession` (upsert)
6. **`maybeTransitionToLive`** — NOT old `READY→LIVE` on first join
7. Emit `room:messages` with full history

Key behavior in `room:message`:

1. Access check + reject if `readOnly`
2. Save `LiveMessage` with `HUMAN_HR` / `HUMAN_CANDIDATE`
3. Broadcast `room:messages`
4. If human message → `orchestrator.onHumanMessage()` (orchestrator gates `LIVE` internally)

On `disconnect`:

1. If socket had interviewId + role → `trackLeave`
2. Call `maybeTransitionToLive` (no-op unless still READY with both)

- [ ] **Step 4: Orchestrator LIVE gate**

At start of `onHumanMessage`:

```ts
const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
if (!interview || interview.status !== "LIVE") return;
```

- [ ] **Step 5: Refactor `server.ts`**

```ts
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerRoomHandlers } from "./socket/room";
import { createRoomOrchestrator } from "./socket/orchestrator";

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "http://localhost:5173" } });
const orchestrator = createRoomOrchestrator(() => prisma);
registerRoomHandlers(io, () => prisma, orchestrator);
httpServer.listen(port, () => { ... });
```

- [ ] **Step 6: Vite proxy**

```ts
"/socket.io": { target: "http://localhost:3000", changeOrigin: true, ws: true },
```

- [ ] **Step 7: Run backend tests, commit**

```bash
git commit -m "feat: socket room with presence-based LIVE transition and orchestrator gate"
```

---

### Task 7: Frontend `deleteInterview` + HR list UI

**Files:**
- Modify: `frontend/src/api/interviews.ts`
- Modify: `frontend/src/views/InterviewListView.vue`

- [ ] **Step 1: Add API helper**

```ts
export async function deleteInterview(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/interviews/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити співбесіду");
  }
}
```

- [ ] **Step 2: Update `InterviewListView.vue`**

- Import `CreateInterviewModal`, `deleteInterview`
- Header row: `<h1>Співбесіди</h1>` + `<button @click="showCreateModal = true">Створити зустріч</button>`
- Table columns: **Назва, Звіт, Дата, Статус, Дії** (remove Код, remove Відкрити)
- Name cell: `@click="goToRoom(interview.id)"` → `{ name: 'interview-room', params: { id } }`
- Delete button with confirm:

```ts
async function onDelete(id: string): Promise<void> {
  if (!window.confirm("Видалити співбесіду? Цю дію не можна скасувати.")) return;
  await deleteInterview(id);
  interviews.value = interviews.value.filter((i) => i.id !== id);
}
```

- Empty state: «Створіть першу кнопкою «Створити зустріч»»

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: HR interview list with create and delete actions"
```

---

### Task 8: Two-step `CreateInterviewModal`

**Files:**
- Modify: `frontend/src/components/CreateInterviewModal.vue`

- [ ] **Step 1: Add step state**

```ts
const step = ref<"form" | "code">("form");
const createdInterview = ref<CreatedInterview | null>(null);
```

Reset on open: `step = "form"`, `createdInterview = null`.

- [ ] **Step 2: After successful create**

```ts
createdInterview.value = interview;
step.value = "code";
```

- [ ] **Step 3: Step 2 template**

```vue
<template v-else-if="step === 'code' && createdInterview">
  <h2>Код для кандидата</h2>
  <p class="join-code">{{ createdInterview.joinCode }}</p>
  <p class="hint">Надішліть цей код кандидату</p>
  <div class="actions">
    <button type="button" class="btn-secondary" @click="onClose">Закрити</button>
    <button type="button" class="btn-primary" @click="onContinue">Далі</button>
  </div>
</template>
```

```ts
function onContinue(): void {
  if (!createdInterview.value) return;
  emit("created", createdInterview.value);
  router.push({ name: "interview-room", params: { id: createdInterview.value.id } });
}
```

- [ ] **Step 4: Change step 1 title to «Створити зустріч»**

- [ ] **Step 5: Commit**

---

### Task 9: `HrHomeView` cleanup

**Files:**
- Modify: `frontend/src/views/HrHomeView.vue`

- [ ] **Step 1: Remove**

- `showInterviewModal`, `CreateInterviewModal` import/usage
- «Створити нову співбесіду» button
- `createdInterview` banner block
- `onInterviewCreated` handler

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor: move interview creation to interviews tab"
```

---

### Task 10: Candidate join label + room entry

**Files:**
- Modify: `frontend/src/components/JoinInterviewModal.vue`
- Modify: `frontend/src/views/CandidateInterviewView.vue`

- [ ] **Step 1: JoinInterviewModal submit text**

```vue
{{ submitting ? "Приєднання…" : "Приєднатися до співbесіди" }}
```

- [ ] **Step 2: CandidateInterviewView**

Replace placeholder text with room entry when `interview.status === 'READY' || interview.status === 'LIVE'`:

```vue
<button
  v-if="interview.status === 'READY' || interview.status === 'LIVE'"
  type="button"
  class="btn-primary"
  @click="router.push({ name: 'candidate-interview-room' })"
>
  Увійти в кімнату
</button>
```

Remove «буде доступна пізніше» placeholder.

- [ ] **Step 3: Commit**

---

### Task 11: Live room frontend

**Files:**
- Create: `frontend/src/api/socket.ts`
- Create: `frontend/src/composables/useInterviewRoom.ts`
- Create: `frontend/src/components/LiveChatPanel.vue`
- Create: `frontend/src/views/InterviewRoomView.vue`
- Create: `frontend/src/views/CandidateInterviewRoomView.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: `getSocket()` singleton** with `auth: { token: localStorage.getItem('auth_token') }`

- [ ] **Step 2: `useInterviewRoom(interviewId)`**

State: `messages`, `status`, `connecting`, `error`, `readOnly`, `agentThinking`, `phaseBanner`.

Listen: `room:messages`, `room:status`, `room:error`, `room:agent-thinking`.

On mount: connect → emit `room:join { interviewId }`.

`sendMessage(content)` → emit `room:message`.

Compute `phaseBanner`:

```ts
if (status === 'AWAITING_CANDIDATE') return `Очікуємо кандидата. Код: ${joinCode}`;
if (status === 'READY') return 'Обидва готові. Очікуємо другого учасника в кімнаті';
if (status === 'ENDED') return 'Співbесідa завершена';
return null;
```

(Hide banner when `LIVE`.)

- [ ] **Step 3: `LiveChatPanel.vue`**

Reuse prep-chat layout: message list, labels map per spec, `.agent` class, thinking indicator, composer disabled when `readOnly`.

- [ ] **Step 4: Room views**

`InterviewRoomView.vue`: load `fetchInterview(id)` for joinCode/displayName; render `LiveChatPanel`.

`CandidateInterviewRoomView.vue`: load `fetchCandidateInterview()` for id; same panel.

- [ ] **Step 5: Router routes**

```ts
{ path: "interviews/:id/room", name: "interview-room", component: InterviewRoomView },
// under /candidate children:
{ path: "interview/room", name: "candidate-interview-room", component: CandidateInterviewRoomView },
```

- [ ] **Step 6: Build check**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: live interview room UI for HR and candidate"
```

---

### Task 12: README + manual smoke

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add «Interview Tabs Live Room Quick Start» section**

Document smoke steps 1–7 from spec.

- [ ] **Step 2: Manual smoke**

1. HR `/interviews` → create → code → Далі → waiting banner
2. HR message → no agent reply
3. Candidate join gating
4. Candidate join → READY
5. Both in room → LIVE → agent stub reply
6. Delete with confirm

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add interview tabs live room quick start"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| HR table columns + delete | Task 7 |
| Create two-step modal + Далі | Task 8 |
| Remove create from home | Task 9 |
| Candidate join gating + label | Task 10 |
| Candidate room entry | Task 10, 11 |
| HR early room access | Task 3, 6 |
| Candidate room at READY+ | Task 3, 6 |
| LIVE = READY + both present | Task 4, 5, 6 |
| Agents silent until LIVE | Task 6 |
| DELETE always + confirm | Task 1, 7 |
| reportSummary column | Task 2 |
| Phase banners | Task 11 |
| No «Завершити» button | Task 11 (omit button) |

---

## Execution notes

- Implement Tasks 1–5 before Task 6 if socket layer missing.
- Day 17–18 agent pipeline (LLM Arbiter, Company, Candidate) — окремі дні; Task 6 включає stub Arbiter з Day 16.
- If branch has partial Day 15/16 code, merge amendments (access, presence, LIVE gate) instead of duplicating files.

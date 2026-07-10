# Agent Orchestrator (Day 16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Після людського повідомлення в live-кімнаті система чекає debounce, запускає stub Arbiter, показує індикатор «думає» через `room:agent-thinking`.

**Architecture:** In-process `RoomOrchestrator` у `backend/src/socket/orchestrator.ts` з debounce + generation counter для скасування. `room.ts` викликає orchestrator після збереження `HUMAN_*` msg. Stub без LLM у `stub-arbiter.ts`. Фронт слухає `room:agent-thinking` і рендерить agent messages.

**Tech Stack:** Express + Socket.IO + Prisma (backend), Vue 3 + socket.io-client + TypeScript (frontend), Node `node:test`/`assert`.

**Spec:** `docs/superpowers/specs/2026-07-10-agent-orchestrator-day16-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/agents/stub-arbiter.ts` | Stub Arbiter без LLM |
| `backend/src/agents/stub-arbiter.test.ts` | Unit tests stub |
| `backend/src/socket/orchestrator.ts` | Debounce, generation, emit events |
| `backend/src/socket/orchestrator.test.ts` | Unit tests orchestrator |
| `backend/src/socket/types.ts` | Розширений DTO + `RoomAgentThinkingEvent` |
| `backend/src/socket/room.ts` | Виклик orchestrator; `toDto` для agent types |
| `backend/src/socket/room.test.ts` | Pass no-op orchestrator mock |
| `backend/src/server.ts` | Create orchestrator singleton |
| `frontend/src/composables/useInterviewRoom.ts` | `agentThinking` state + listener |
| `frontend/src/components/LiveChatPanel.vue` | Agent labels, styles, thinking indicator |
| `frontend/src/components/InterviewRoomContent.vue` | Pass `agentThinking` prop |
| `backend/package.json` | Add new test files to `test` script |
| `README.md` | Day 16 Quick Start + pipeline docs |

---

### Task 1: Stub Arbiter (TDD)

**Files:**
- Create: `backend/src/agents/stub-arbiter.ts`
- Create: `backend/src/agents/stub-arbiter.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing tests**

Create `backend/src/agents/stub-arbiter.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildStubArbiterReply, runStubArbiter, STUB_AGENT_DELAY_MS } from "./stub-arbiter";

test("buildStubArbiterReply includes truncated quote", () => {
  const long = "а".repeat(100);
  const reply = buildStubArbiterReply(long);
  assert.match(reply, /^\[Arbiter stub\]/);
  assert.match(reply, /Почув вас/);
  assert.match(reply, /«а{80}»/);
  assert.doesNotMatch(reply, /а{81}/);
});

test("buildStubArbiterReply handles short content", () => {
  const reply = buildStubArbiterReply("Привіт");
  assert.equal(reply, "[Arbiter stub] Почув вас. Продовжуйте розмову. (Останнє: «Привіт»)");
});

test("runStubArbiter resolves after delay", async () => {
  const start = Date.now();
  const reply = await runStubArbiter("Тест");
  const elapsed = Date.now() - start;
  assert.match(reply, /\[Arbiter stub\]/);
  assert.ok(elapsed >= STUB_AGENT_DELAY_MS - 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=backend -- --test src/agents/stub-arbiter.test.ts
```

Expected: FAIL — module `./stub-arbiter` not found.

- [ ] **Step 3: Implement stub**

Create `backend/src/agents/stub-arbiter.ts`:

```ts
export const STUB_AGENT_DELAY_MS = 1500;

const MAX_QUOTE_LENGTH = 80;

export function buildStubArbiterReply(lastHumanContent: string): string {
  const quote =
    lastHumanContent.length > MAX_QUOTE_LENGTH
      ? `${lastHumanContent.slice(0, MAX_QUOTE_LENGTH)}`
      : lastHumanContent;
  return `[Arbiter stub] Почув вас. Продовжуйте розмову. (Останнє: «${quote}»)`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runStubArbiter(lastHumanContent: string): Promise<string> {
  await sleep(STUB_AGENT_DELAY_MS);
  return buildStubArbiterReply(lastHumanContent);
}
```

- [ ] **Step 4: Add test file to backend test script**

Append `src/agents/stub-arbiter.test.ts` to the `test` array in `backend/package.json` (after `src/agents/agent-reply.test.ts`).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test --workspace=backend -- --test src/agents/stub-arbiter.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/stub-arbiter.ts backend/src/agents/stub-arbiter.test.ts backend/package.json
git commit -m "feat: add stub Arbiter agent for Day 16 orchestrator"
```

---

### Task 2: Extend socket types

**Files:**
- Modify: `backend/src/socket/types.ts`

- [ ] **Step 1: Extend DTO and add thinking event type**

Replace `backend/src/socket/types.ts` with:

```ts
export type LiveAuthorTypeDto =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

export type LiveMessageDto = {
  id: string;
  authorType: LiveAuthorTypeDto;
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

export type RoomAgentThinkingEvent = {
  active: boolean;
  agentType?: "AGENT_ARBITER";
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/socket/types.ts
git commit -m "feat: extend socket types for agent messages and thinking indicator"
```

---

### Task 3: Room orchestrator (TDD)

**Files:**
- Create: `backend/src/socket/orchestrator.ts`
- Create: `backend/src/socket/orchestrator.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing orchestrator tests**

Create `backend/src/socket/orchestrator.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "socket.io";
import type { LiveMessage, PrismaClient } from "@prisma/client";
import { createRoomOrchestrator } from "./orchestrator";

type Emitted = { event: string; room: string; payload: unknown };

function makeIo(): { io: Server; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, room, payload });
      },
    }),
  } as unknown as Server;
  return { io, emitted };
}

function makePrisma(messages: LiveMessage[]) {
  let createCount = 0;
  return {
    liveMessage: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: {
          sessionId: string;
          authorType?: { in: string[] };
        };
        orderBy: { createdAt: "desc" };
      }) => {
        const filtered = messages
          .filter((m) => m.sessionId === where.sessionId)
          .filter((m) =>
            where.authorType?.in ? where.authorType.in.includes(m.authorType) : true,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return filtered[0] ?? null;
      },
      create: async ({
        data,
      }: {
        data: { sessionId: string; authorType: string; content: string };
      }) => {
        createCount += 1;
        const created = {
          id: `agent_${createCount}`,
          sessionId: data.sessionId,
          authorType: data.authorType as LiveMessage["authorType"],
          content: data.content,
          createdAt: new Date(),
        } as LiveMessage;
        messages.push(created);
        return created;
      },
    },
  } as unknown as PrismaClient;
}

test("orchestrator runs agent after debounce and emits thinking + message", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Привіт",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    runAgent: async (content) => `reply:${content}`,
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 80));

  const thinkingStart = emitted.find((e) => e.event === "room:agent-thinking" && (e.payload as { active: boolean }).active);
  const agentMessage = emitted.find((e) => e.event === "room:messages");
  const thinkingEnd = emitted.filter((e) => e.event === "room:agent-thinking").at(-1);

  assert.ok(thinkingStart);
  assert.equal((thinkingStart!.payload as { agentType?: string }).agentType, "AGENT_ARBITER");
  assert.ok(agentMessage);
  assert.deepEqual((agentMessage!.payload as { messages: Array<{ authorType: string }> }).messages[0].authorType, "AGENT_ARBITER");
  assert.equal((thinkingEnd!.payload as { active: boolean }).active, false);
  assert.equal(messages.filter((m) => m.authorType === "AGENT_ARBITER").length, 1);
});

test("orchestrator cancels in-flight agent when new human message arrives", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_HR",
      content: "Перше",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages);
  const { io, emitted } = makeIo();

  let resolveAgent: (() => void) | null = null;
  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 20,
    runAgent: () =>
      new Promise((resolve) => {
        resolveAgent = () => resolve("late-reply");
      }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 40));

  messages.push({
    id: "m2",
    sessionId: "session_1",
    authorType: "HUMAN_HR",
    content: "Друге",
    createdAt: new Date(),
  });
  orchestrator.onHumanMessage(io, "interview_1", "session_1");

  resolveAgent?.();
  await new Promise((r) => setTimeout(r, 80));

  const agentMessages = emitted.filter((e) => e.event === "room:messages");
  assert.equal(agentMessages.length, 1);
  assert.match(
    (agentMessages[0].payload as { messages: Array<{ content: string }> }).messages[0].content,
    /reply:Друге/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=backend -- --test src/socket/orchestrator.test.ts
```

Expected: FAIL — module `./orchestrator` not found.

- [ ] **Step 3: Implement orchestrator**

Create `backend/src/socket/orchestrator.ts`:

```ts
import type { Server } from "socket.io";
import type { LiveAuthorType, LiveMessage, PrismaClient } from "@prisma/client";
import { runStubArbiter } from "../agents/stub-arbiter";
import type { LiveMessageDto, RoomAgentThinkingEvent } from "./types";

export const AGENT_DEBOUNCE_MS = 2500;

const HUMAN_AUTHOR_TYPES: LiveAuthorType[] = ["HUMAN_HR", "HUMAN_CANDIDATE"];

type RoomState = {
  debounceTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
};

export type RoomOrchestratorOptions = {
  debounceMs?: number;
  runAgent?: (lastHumanContent: string) => Promise<string>;
};

export interface RoomOrchestrator {
  onHumanMessage(io: Server, interviewId: string, sessionId: string): void;
}

function roomName(interviewId: string): string {
  return `interview:${interviewId}`;
}

function toDto(message: LiveMessage): LiveMessageDto {
  return {
    id: message.id,
    authorType: message.authorType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

function emitThinking(io: Server, interviewId: string, payload: RoomAgentThinkingEvent): void {
  io.to(roomName(interviewId)).emit("room:agent-thinking", payload);
}

export function createRoomOrchestrator(
  getPrisma: () => PrismaClient,
  options: RoomOrchestratorOptions = {},
): RoomOrchestrator {
  const debounceMs = options.debounceMs ?? AGENT_DEBOUNCE_MS;
  const runAgent = options.runAgent ?? runStubArbiter;
  const rooms = new Map<string, RoomState>();

  function getState(interviewId: string): RoomState {
    let state = rooms.get(interviewId);
    if (!state) {
      state = { debounceTimer: null, generation: 0 };
      rooms.set(interviewId, state);
    }
    return state;
  }

  async function executeTurn(
    io: Server,
    interviewId: string,
    sessionId: string,
    capturedGeneration: number,
  ): Promise<void> {
    const state = getState(interviewId);
    const prisma = getPrisma();

    emitThinking(io, interviewId, { active: true, agentType: "AGENT_ARBITER" });

    try {
      const lastHuman = await prisma.liveMessage.findFirst({
        where: {
          sessionId,
          authorType: { in: HUMAN_AUTHOR_TYPES },
        },
        orderBy: { createdAt: "desc" },
      });

      const content = await runAgent(lastHuman?.content ?? "");

      if (state.generation !== capturedGeneration) {
        emitThinking(io, interviewId, { active: false });
        return;
      }

      const saved = await prisma.liveMessage.create({
        data: {
          sessionId,
          authorType: "AGENT_ARBITER",
          content,
        },
      });

      io.to(roomName(interviewId)).emit("room:messages", {
        messages: [toDto(saved)],
      });
    } catch (error) {
      console.error(
        "[orchestrator] agent turn failed:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      if (state.generation === capturedGeneration) {
        emitThinking(io, interviewId, { active: false });
      }
    }
  }

  return {
    onHumanMessage(io: Server, interviewId: string, sessionId: string): void {
      const state = getState(interviewId);

      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
      }

      state.generation += 1;
      emitThinking(io, interviewId, { active: false });

      const capturedGeneration = state.generation;
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        void executeTurn(io, interviewId, sessionId, capturedGeneration);
      }, debounceMs);
    },
  };
}
```

- [ ] **Step 4: Add test file to backend test script**

Append `src/socket/orchestrator.test.ts` to the `test` array in `backend/package.json` (after `src/socket/live-session.test.ts`).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test --workspace=backend -- --test src/socket/orchestrator.test.ts
```

Expected: all 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/socket/orchestrator.ts backend/src/socket/orchestrator.test.ts backend/package.json
git commit -m "feat: add room orchestrator with debounce and agent cancellation"
```

---

### Task 4: Wire orchestrator into room handlers

**Files:**
- Modify: `backend/src/socket/room.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/socket/room.test.ts`

- [ ] **Step 1: Update `toDto` and accept orchestrator in `room.ts`**

In `backend/src/socket/room.ts`:

1. Import orchestrator type:

```ts
import type { RoomOrchestrator } from "./orchestrator";
```

2. Replace `toDto` — remove throw on agent types:

```ts
function toDto(message: LiveMessage): LiveMessageDto {
  return {
    id: message.id,
    authorType: message.authorType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}
```

3. Update `registerRoomHandlers` signature:

```ts
export function registerRoomHandlers(
  io: Server,
  getPrisma: () => PrismaClient,
  orchestrator: RoomOrchestrator,
): void {
```

4. After `liveMessage.create` in `room:message`, add orchestrator call:

```ts
if (saved.authorType === "HUMAN_HR" || saved.authorType === "HUMAN_CANDIDATE") {
  orchestrator.onHumanMessage(io, interviewId, session.id);
}
```

- [ ] **Step 2: Bootstrap orchestrator in `server.ts`**

Add import:

```ts
import { createRoomOrchestrator } from "./socket/orchestrator";
```

Before `registerRoomHandlers`:

```ts
const orchestrator = createRoomOrchestrator(() => prisma);
```

Update call:

```ts
registerRoomHandlers(io, () => prisma, orchestrator);
```

- [ ] **Step 3: Pass no-op orchestrator in `room.test.ts`**

Add before `registerRoomHandlers` call in test helper:

```ts
const noopOrchestrator = { onHumanMessage: () => {} };
registerRoomHandlers(io, () => prisma, noopOrchestrator);
```

- [ ] **Step 4: Run backend tests**

```bash
npm run test --workspace=backend
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/room.ts backend/src/server.ts backend/src/socket/room.test.ts
git commit -m "feat: trigger agent orchestrator after human live messages"
```

---

### Task 5: Frontend — agent thinking state

**Files:**
- Modify: `frontend/src/composables/useInterviewRoom.ts`

- [ ] **Step 1: Extend types and add `agentThinking`**

Update `frontend/src/composables/useInterviewRoom.ts`:

```ts
export type LiveAuthorType =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

export type LiveMessage = {
  id: string;
  authorType: LiveAuthorType;
  content: string;
  createdAt: string;
};

export type AgentThinkingState = {
  active: boolean;
  agentType?: LiveAuthorType;
};
```

Add ref:

```ts
const agentThinking = ref<AgentThinkingState | null>(null);
```

Add handler:

```ts
function onAgentThinking(payload: { active?: boolean; agentType?: LiveAuthorType }): void {
  if (typeof payload?.active !== "boolean") return;
  agentThinking.value = {
    active: payload.active,
    agentType: payload.agentType,
  };
}
```

In `onMessages`, after `mergeMessages`, clear thinking on agent messages:

```ts
function onMessages(payload: { messages?: LiveMessage[] }): void {
  if (Array.isArray(payload?.messages)) {
    mergeMessages(payload.messages);
    if (payload.messages.some((m) => m.authorType.startsWith("AGENT_"))) {
      agentThinking.value = { active: false };
    }
  }
}
```

Register listener in `onMounted`:

```ts
socket.on("room:agent-thinking", onAgentThinking);
```

Unregister in `onUnmounted`:

```ts
socket.off("room:agent-thinking", onAgentThinking);
```

Return `agentThinking` from composable.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/composables/useInterviewRoom.ts
git commit -m "feat: track agent thinking state in useInterviewRoom"
```

---

### Task 6: Frontend — LiveChatPanel agent UI

**Files:**
- Modify: `frontend/src/components/LiveChatPanel.vue`
- Modify: `frontend/src/components/InterviewRoomContent.vue`

- [ ] **Step 1: Update `LiveChatPanel.vue`**

Add prop:

```ts
import type { AgentThinkingState } from "../composables/useInterviewRoom";

agentThinking?: AgentThinkingState | null;
```

Update `labelFor`:

```ts
function labelFor(authorType: LiveMessage["authorType"]): string {
  switch (authorType) {
    case "HUMAN_HR":
      return "HR";
    case "HUMAN_CANDIDATE":
      return "Кандидат";
    case "AGENT_ARBITER":
      return "Arbiter";
    case "AGENT_COMPANY":
      return "Компанія";
    case "AGENT_CANDIDATE":
      return "Кандидат (AI)";
    default:
      return "Учасник";
  }
}
```

Add computed:

```ts
const thinkingLabel = computed(() => {
  if (props.agentThinking?.agentType === "AGENT_ARBITER") return "Arbiter";
  return "Агент";
});
```

Update message `:class`:

```html
:class="{
  own: message.authorType === ownAuthorType,
  agent: message.authorType.startsWith('AGENT_'),
}"
```

Add thinking indicator after messages loop:

```html
<p v-if="agentThinking?.active" class="thinking">{{ thinkingLabel }} думає…</p>
```

Add styles:

```css
.message.agent .message-text {
  background: #ede9fe;
  color: #4c1d95;
}
.thinking {
  margin: 0;
  color: #666;
  font-size: 0.875rem;
  font-style: italic;
}
```

- [ ] **Step 2: Pass `agentThinking` from `InterviewRoomContent.vue`**

```ts
const { messages, connectionState, errorMessage, sendMessage, isReadOnly, agentThinking } =
  useInterviewRoom(props.interviewId, props.currentRole);
```

```html
<LiveChatPanel
  ...
  :agent-thinking="agentThinking"
/>
```

- [ ] **Step 3: Verify frontend compiles**

```bash
npm run lint --workspace=frontend
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LiveChatPanel.vue frontend/src/components/InterviewRoomContent.vue
git commit -m "feat: show agent messages and thinking indicator in live chat"
```

---

### Task 7: README Day 16 documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Day 16 Quick Start after Day 15 section**

Insert after Day 15 block (before Day 17):

```markdown
### Agent Orchestrator Quick Start (Day 16)

**Pipeline:** `Human message → debounce 2.5s → Arbiter stub → room:messages`

**1. Відкрити live-кімнату** (як у Day 15) у двох вкладках.

**2. Написати повідомлення від HR або кандидата**

- Через ~2.5 с з’являється «Arbiter думає…»
- Ще через ~1.5 с — відповідь `[Arbiter stub] …`
- Відповідь видна в обох вкладках

**3. Перевірити debounce і скасування**

- Швидко надіслати 3 повідомлення → stub відповідає один раз (на останнє)
- Під час «думає» надіслати ще одне → debounce починається заново

**Нова socket-подія**

| Напрям | Подія | Payload |
|--------|-------|---------|
| server → client | `room:agent-thinking` | `{ active: boolean; agentType?: "AGENT_ARBITER" }` |

Агентські повідомлення зберігаються в `LiveMessage` з `authorType: AGENT_ARBITER`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Day 16 agent orchestrator quick start"
```

---

### Task 8: Final verification

**Files:** (none — verification only)

- [ ] **Step 1: Run all backend tests**

```bash
npm run test --workspace=backend
```

Expected: all tests PASS.

- [ ] **Step 2: Run full build**

```bash
npm run build
```

Expected: frontend and backend build without errors.

- [ ] **Step 3: Manual smoke test**

1. `npm run dev` from repo root
2. HR + candidate tabs in live room (`READY`/`LIVE`)
3. HR sends message → wait ~4s → Arbiter stub reply in both tabs
4. «Arbiter думає…» appears after debounce, disappears after reply
5. Send message while thinking → debounce resets
6. Reload — agent message persists in history

- [ ] **Step 4: Mark README Day 16 DoD checkboxes**

Update Day 16 Definition of Done items to `[x]` in README.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "chore: mark Day 16 agent orchestrator DoD complete"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Debounce 2.5s before agents | Task 3 (`AGENT_DEBOUNCE_MS`) |
| Cancel in-flight on new human msg | Task 3 (generation counter) |
| Stub Arbiter `AGENT_ARBITER` | Task 1, 3 |
| `room:agent-thinking` event | Task 2, 3, 5 |
| Agent messages in `LiveMessage` | Task 3, 4 |
| Extended `LiveMessageDto` | Task 2, 4 |
| Frontend thinking indicator | Task 5, 6 |
| Agent labels and styles | Task 6 |
| Composer stays active | Task 6 (no disabled change) |
| Unit tests stub + orchestrator | Task 1, 3 |
| README pipeline docs | Task 7 |
| `npm run build` | Task 8 |

No placeholder steps. `room.test.ts` updated with no-op orchestrator (Task 4). Orchestrator accepts injectable `debounceMs`/`runAgent` for fast tests (Task 3).

# Prep Chat Dedup & Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Витягнути спільний prep-chat цикл у `usePrepChat` + `PrepChatPanel`, підключити Vacancy / Company / Candidate prep, прибрати legacy `CandidatePrepView` і мертвий demo-чат.

**Architecture:** Adapters інжектять API (`prep` / `company-prep` / `candidate-prep`). Composable володіє load/greeting/send/retry/finish/delete. `PrepChatPanel` — controlled UI (messages, thinking, error+retry, composer). Views лишають лише профіль і wiring. Backend API не змінюємо.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vue Router, Node.js test runner (`node --import tsx --test`) для composable.

## Global Constraints

- Не змінювати продуктову поведінку prep (greeting, optimistic bubble, retry без повторного user text, confirm перед finish/delete).
- Не зливати з `LiveChatPanel` / decision dialogs.
- Не чіпати backend `/api/llm/complete`.
- UI-копії українською; код/ідентифікатори англійською.
- Між задачами UX не регресує: кожен споживач повністю на новому шарі перед наступним.

**Spec:** `docs/superpowers/specs/2026-07-22-prep-chat-dedup-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/composables/usePrepChat.ts` | Спільний prep-chat цикл + типи adapters |
| `frontend/src/composables/usePrepChat.test.ts` | Unit-тести composable з mock adapters |
| `frontend/src/components/PrepChatPanel.vue` | Спільний chat UI |
| `frontend/src/components/CandidatePrepChat.vue` | Тонкий wrapper candidate adapters + panel |
| `frontend/src/views/CompanyProfilePrepView.vue` | Профіль + `usePrepChat` + `PrepChatPanel` |
| `frontend/src/views/VacancyPrepView.vue` | Те саме + vacancy metadata / `shouldAutoGreet` |
| `frontend/src/views/CandidatePrepView.vue` | **Видалити** |
| `frontend/src/router/index.ts` | Redirect `candidate-prep` → `candidate-profile` |
| `frontend/src/components/ChatPanel.vue` | **Видалити** |
| `frontend/src/api/llm.ts` | **Видалити** |
| `frontend/src/api/health.ts` | **Видалити** |
| `frontend/package.json` | `test` script + `tsx` / `@types/node` |
| `README.md` | UI-шлях кандидата → `/candidate/profile` |

---

### Task 1: `usePrepChat` + unit tests

**Files:**
- Create: `frontend/src/composables/usePrepChat.ts`
- Create: `frontend/src/composables/usePrepChat.test.ts`
- Modify: `frontend/package.json` (add `test` script, `tsx`, `@types/node`)

**Interfaces:**
- Consumes: Vue `ref`, `nextTick`
- Produces:
  - Types: `PrepFailedAction`, `PrepChatMessage`, `PrepChatLoadResult<TProfile>`, `PrepChatAdapters<TProfile>`, `UsePrepChatOptions<TProfile>`
  - `usePrepChat<TProfile>(options: UsePrepChatOptions<TProfile>)` → state + methods нижче

Adapters (розширення spec: потрібен і `humanAuthorType` для optimistic user bubble):

```ts
export type PrepFailedAction = "greeting" | "message" | "finish";

export type PrepChatMessage = {
  id: string;
  authorType: string;
  content: string;
  createdAt: string;
};

export type PrepChatLoadResult<TProfile> = {
  messages: PrepChatMessage[];
  isClosed: boolean;
  profile: TProfile | null;
};

export type PrepChatAdapters<TProfile> = {
  loadState: () => Promise<PrepChatLoadResult<TProfile>>;
  sendMessage: (text?: string) => Promise<{
    message: string;
    readyForConfirmation: boolean;
  }>;
  finishChat: () => Promise<void | { profile: TProfile }>;
  deleteChat: () => Promise<void>;
  isUserMessage: (msg: PrepChatMessage) => boolean;
  humanAuthorType: string;
  agentAuthorType: string;
};

export type UsePrepChatOptions<TProfile> = {
  adapters: PrepChatAdapters<TProfile>;
  onFinished?: () => void;
  onDeleted?: () => void;
  onAfterLoad?: (state: PrepChatLoadResult<TProfile>) => void | Promise<void>;
  /** Default: `!state.isClosed && state.messages.length === 0` */
  shouldAutoGreet?: (state: PrepChatLoadResult<TProfile>) => boolean;
  confirmDeleteMessage?: string;
  confirmFinishWhenNotReadyMessage?: string;
};
```

Повертає: `loadState` (`"loading" | "ready" | "error"`), `errorMessage`, `messages`, `isClosed`, `profile`, `input`, `sending`, `lastFailedAction`, `lastReadyForConfirmation`, `messagesEl`, методи `load`, `send`, `retry`, `finish`, `deleteChat`, `onKeydown`, `scrollToBottom`, `isUserMessage` (proxy з adapters).

- [ ] **Step 1: Add test runner deps + script**

In `frontend/package.json`, add script and devDependencies:

```json
"scripts": {
  "dev": "vite",
  "build": "vue-tsc -b && vite build",
  "lint": "vue-tsc --noEmit -p tsconfig.app.json",
  "preview": "vite preview",
  "test": "node --import tsx --test src/composables/usePrepChat.test.ts"
},
"devDependencies": {
  "@types/dompurify": "^3.0.5",
  "@types/node": "^22.10.5",
  "@vitejs/plugin-vue": "^5.2.1",
  "@vue/tsconfig": "^0.7.0",
  "tsx": "^4.19.2",
  "typescript": "^5.7.3",
  "vite": "^6.0.7",
  "vue-tsc": "^2.2.0"
}
```

Run: `npm install` from repo root (or `npm install --workspace frontend`).

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/composables/usePrepChat.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { usePrepChat, type PrepChatAdapters, type PrepChatMessage } from "./usePrepChat";

type Profile = { confirmedAt: string | null };

function makeAdapters(overrides: Partial<PrepChatAdapters<Profile>> = {}): PrepChatAdapters<Profile> {
  return {
    loadState: async () => ({ messages: [], isClosed: false, profile: null }),
    sendMessage: async () => ({ message: "agent hi", readyForConfirmation: false }),
    finishChat: async () => ({ profile: { confirmedAt: null } }),
    deleteChat: async () => undefined,
    isUserMessage: (msg) => msg.authorType === "HUMAN_HR",
    humanAuthorType: "HUMAN_HR",
    agentAuthorType: "AGENT_COMPANY",
    ...overrides,
  };
}

test("load with empty messages triggers greeting", async () => {
  let sendCalls = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      sendMessage: async () => {
        sendCalls += 1;
        return { message: "Вітаю!", readyForConfirmation: false };
      },
    }),
  });
  await chat.load();
  assert.equal(chat.loadState.value, "ready");
  assert.equal(sendCalls, 1);
  assert.equal(chat.messages.value.length, 1);
  assert.equal(chat.messages.value[0]?.authorType, "AGENT_COMPANY");
  assert.equal(chat.messages.value[0]?.content, "Вітаю!");
});

test("shouldAutoGreet false skips greeting", async () => {
  let sendCalls = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      sendMessage: async () => {
        sendCalls += 1;
        return { message: "nope", readyForConfirmation: false };
      },
    }),
    shouldAutoGreet: () => false,
  });
  await chat.load();
  assert.equal(sendCalls, 0);
  assert.equal(chat.messages.value.length, 0);
});

test("send adds optimistic user message then agent reply", async () => {
  const chat = usePrepChat({
    adapters: makeAdapters({
      loadState: async () => ({
        messages: [
          {
            id: "1",
            authorType: "AGENT_COMPANY",
            content: "hi",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ] satisfies PrepChatMessage[],
        isClosed: false,
        profile: null,
      }),
      sendMessage: async (text) => {
        assert.equal(text, "мій досвід");
        return { message: "зрозумів", readyForConfirmation: true };
      },
    }),
  });
  await chat.load();
  chat.input.value = "мій досвід";
  await chat.send();
  assert.equal(chat.messages.value.length, 3);
  assert.equal(chat.messages.value[1]?.authorType, "HUMAN_HR");
  assert.equal(chat.messages.value[2]?.content, "зрозумів");
  assert.equal(chat.lastReadyForConfirmation.value, true);
  assert.equal(chat.input.value, "");
});

test("retry after failed greeting calls sendMessage without text", async () => {
  let calls = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      sendMessage: async (text) => {
        calls += 1;
        if (calls === 1) throw new Error("LLM down");
        assert.equal(text, undefined);
        return { message: "ok", readyForConfirmation: false };
      },
    }),
  });
  await chat.load();
  assert.equal(chat.lastFailedAction.value, "greeting");
  await chat.retry();
  assert.equal(chat.lastFailedAction.value, null);
  assert.equal(chat.messages.value.at(-1)?.content, "ok");
});

test("retry after failed finish calls finishChat again", async () => {
  let finishes = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      loadState: async () => ({
        messages: [
          {
            id: "1",
            authorType: "AGENT_COMPANY",
            content: "hi",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        isClosed: false,
        profile: null,
      }),
      finishChat: async () => {
        finishes += 1;
        if (finishes === 1) throw new Error("finish fail");
        return { profile: { confirmedAt: null } };
      },
    }),
  });
  await chat.load();
  chat.lastReadyForConfirmation.value = true;
  await chat.finish();
  assert.equal(chat.lastFailedAction.value, "finish");
  await chat.retry();
  assert.equal(chat.isClosed.value, true);
  assert.equal(chat.profile.value?.confirmedAt, null);
  assert.equal(chat.lastFailedAction.value, null);
});

test("delete resets and greets again when confirm true", async () => {
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    let deleted = false;
    let greetings = 0;
    const chat = usePrepChat({
      adapters: makeAdapters({
        loadState: async () => ({
          messages: [
            {
              id: "1",
              authorType: "AGENT_COMPANY",
              content: "hi",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          isClosed: false,
          profile: null,
        }),
        deleteChat: async () => {
          deleted = true;
        },
        sendMessage: async () => {
          greetings += 1;
          return { message: "again", readyForConfirmation: false };
        },
      }),
    });
    await chat.load();
    await chat.deleteChat();
    assert.equal(deleted, true);
    assert.equal(greetings, 1);
    assert.equal(chat.messages.value[0]?.content, "again");
  } finally {
    globalThis.confirm = originalConfirm;
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --workspace frontend test`

Expected: FAIL — `Cannot find module './usePrepChat'` or similar.

- [ ] **Step 4: Implement `usePrepChat`**

Create `frontend/src/composables/usePrepChat.ts` with the types above and logic mirroring current `CandidatePrepChat` / company prep (greeting on empty, optimistic send, retry without user text, finish/delete confirms).

Key behaviors to encode:

```ts
import { nextTick, ref, type Ref } from "vue";

// ...types...

const DEFAULT_DELETE_MSG = "Видалити всю історію чату? Цю дію не можна скасувати.";
const DEFAULT_FINISH_MSG =
  "Даних може бути недостатньо. Все одно завершити й сформувати профіль?";

export function usePrepChat<TProfile>(options: UsePrepChatOptions<TProfile>) {
  const { adapters } = options;
  const loadState = ref<"loading" | "ready" | "error">("loading");
  const errorMessage = ref<string | null>(null);
  const messages = ref<PrepChatMessage[]>([]) as Ref<PrepChatMessage[]>;
  const isClosed = ref(false);
  const profile = ref<TProfile | null>(null) as Ref<TProfile | null>;
  const input = ref("");
  const sending = ref(false);
  const lastFailedAction = ref<PrepFailedAction | null>(null);
  const lastReadyForConfirmation = ref(false);
  const messagesEl = ref<HTMLElement | null>(null);

  async function scrollToBottom(): Promise<void> {
    await nextTick();
    const el = messagesEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function triggerGreeting(): Promise<void> {
    sending.value = true;
    try {
      const response = await adapters.sendMessage();
      messages.value.push({
        id: `local_${Date.now()}`,
        authorType: adapters.agentAuthorType,
        content: response.message,
        createdAt: new Date().toISOString(),
      });
      lastReadyForConfirmation.value = response.readyForConfirmation;
      lastFailedAction.value = null;
      await scrollToBottom();
    } catch (error) {
      lastFailedAction.value = "greeting";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
    } finally {
      sending.value = false;
    }
  }

  async function load(): Promise<void> {
    loadState.value = "loading";
    errorMessage.value = null;
    try {
      const state = await adapters.loadState();
      messages.value = state.messages;
      isClosed.value = state.isClosed;
      profile.value = state.profile;
      loadState.value = "ready";
      await options.onAfterLoad?.(state);

      const autoGreet =
        options.shouldAutoGreet?.(state) ??
        (!state.isClosed && state.messages.length === 0);
      if (autoGreet) {
        await triggerGreeting();
      }
    } catch (error) {
      loadState.value = "error";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося завантажити анкету";
    }
  }

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (!text || sending.value || isClosed.value) return;

    errorMessage.value = null;
    lastFailedAction.value = null;
    input.value = "";
    messages.value.push({
      id: `local_${Date.now()}`,
      authorType: adapters.humanAuthorType,
      content: text,
      createdAt: new Date().toISOString(),
    });
    await scrollToBottom();

    sending.value = true;
    try {
      const response = await adapters.sendMessage(text);
      messages.value.push({
        id: `local_${Date.now()}_reply`,
        authorType: adapters.agentAuthorType,
        content: response.message,
        createdAt: new Date().toISOString(),
      });
      lastReadyForConfirmation.value = response.readyForConfirmation;
      lastFailedAction.value = null;
      await scrollToBottom();
    } catch (error) {
      lastFailedAction.value = "message";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
    } finally {
      sending.value = false;
    }
  }

  async function retry(): Promise<void> {
    if (!lastFailedAction.value || sending.value) return;
    const action = lastFailedAction.value;
    errorMessage.value = null;
    sending.value = true;
    try {
      if (action === "finish") {
        const result = await adapters.finishChat();
        if (result && "profile" in result) {
          profile.value = result.profile;
        }
        isClosed.value = true;
        options.onFinished?.();
      } else {
        const response = await adapters.sendMessage();
        messages.value.push({
          id: `local_${Date.now()}_reply`,
          authorType: adapters.agentAuthorType,
          content: response.message,
          createdAt: new Date().toISOString(),
        });
        lastReadyForConfirmation.value = response.readyForConfirmation;
        await scrollToBottom();
      }
      lastFailedAction.value = null;
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
    } finally {
      sending.value = false;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function deleteChat(): Promise<void> {
    const msg = options.confirmDeleteMessage ?? DEFAULT_DELETE_MSG;
    if (!globalThis.confirm(msg)) return;

    errorMessage.value = null;
    try {
      await adapters.deleteChat();
      messages.value = [];
      isClosed.value = false;
      profile.value = null;
      lastReadyForConfirmation.value = false;
      options.onDeleted?.();
      const shouldGreet = options.shouldAutoGreet?.({
        messages: [],
        isClosed: false,
        profile: null,
      }) ?? true;
      if (shouldGreet) {
        await triggerGreeting();
      }
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося видалити чат";
    }
  }

  async function finish(): Promise<void> {
    if (!lastReadyForConfirmation.value) {
      const msg = options.confirmFinishWhenNotReadyMessage ?? DEFAULT_FINISH_MSG;
      if (!globalThis.confirm(msg)) return;
    }

    errorMessage.value = null;
    sending.value = true;
    try {
      const result = await adapters.finishChat();
      if (result && "profile" in result) {
        profile.value = result.profile;
      }
      isClosed.value = true;
      lastFailedAction.value = null;
      options.onFinished?.();
    } catch (error) {
      lastFailedAction.value = "finish";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося завершити чат";
    } finally {
      sending.value = false;
    }
  }

  return {
    loadState,
    errorMessage,
    messages,
    isClosed,
    profile,
    input,
    sending,
    lastFailedAction,
    lastReadyForConfirmation,
    messagesEl,
    load,
    send,
    retry,
    finish,
    deleteChat,
    onKeydown,
    scrollToBottom,
    isUserMessage: adapters.isUserMessage,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace frontend test`

Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/composables/usePrepChat.ts frontend/src/composables/usePrepChat.test.ts
git commit -m "$(cat <<'EOF'
feat(fe): add shared usePrepChat composable

EOF
)"
```

---

### Task 2: `PrepChatPanel` + migrate `CandidatePrepChat`

**Files:**
- Create: `frontend/src/components/PrepChatPanel.vue`
- Modify: `frontend/src/components/CandidatePrepChat.vue` (replace inline chat logic/UI)

**Interfaces:**
- Consumes: `usePrepChat` return shape; `PrepChatMessage`, `PrepFailedAction`
- Produces: `PrepChatPanel` props/emits:

```ts
props: {
  title: string;
  loadState: "loading" | "ready" | "error";
  messages: PrepChatMessage[];
  sending: boolean;
  isClosed: boolean;
  input: string; // v-model
  errorMessage: string | null;
  lastFailedAction: PrepFailedAction | null;
  isUserMessage: (msg: PrepChatMessage) => boolean;
  deleteDisabled?: boolean;
  deleteTitle?: string;
  messagesEl: // expose via template ref binding from parent — parent passes ref through setMessagesEl OR panel emits/ref; simplest: parent binds :ref on panel's messages via prop callback, OR panel accepts messagesEl as prop using function-ref pattern
}
emits: send, retry, finish, delete, keydown, "update:input"
```

Practical binding for scroll container: parent keeps `messagesEl` from composable and passes it with:

```vue
<div :ref="(el) => { messagesEl = el as HTMLElement | null }" ...>
```

inside the panel — so panel accepts optional no prop; instead:

```ts
// PrepChatPanel props include:
setMessagesEl?: (el: HTMLElement | null) => void;
```

and in template: `:ref="(el) => setMessagesEl?.(el as HTMLElement | null)"`.

- [ ] **Step 1: Create `PrepChatPanel.vue`**

Extract markup + styles from current `CandidatePrepChat.vue` chat block into `frontend/src/components/PrepChatPanel.vue`:

```vue
<script setup lang="ts">
import type { PrepChatMessage, PrepFailedAction } from "../composables/usePrepChat";

const props = defineProps<{
  title: string;
  loadState: "loading" | "ready" | "error";
  messages: PrepChatMessage[];
  sending: boolean;
  isClosed: boolean;
  input: string;
  errorMessage: string | null;
  lastFailedAction: PrepFailedAction | null;
  isUserMessage: (msg: PrepChatMessage) => boolean;
  deleteDisabled?: boolean;
  deleteTitle?: string;
  setMessagesEl?: (el: HTMLElement | null) => void;
}>();

const emit = defineEmits<{
  "update:input": [value: string];
  send: [];
  retry: [];
  finish: [];
  delete: [];
  keydown: [event: KeyboardEvent];
}>();
</script>

<template>
  <section class="chat-view">
    <p v-if="loadState === 'loading'">Завантаження чату…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else>
      <div class="chat-header">
        <h2>{{ title }}</h2>
        <div class="chat-actions">
          <slot name="actions">
            <button
              type="button"
              class="btn-secondary"
              :disabled="sending || deleteDisabled"
              :title="deleteTitle || ''"
              @click="emit('delete')"
            >
              Видалити чат
            </button>
            <button
              v-if="!isClosed"
              type="button"
              class="btn-primary"
              :disabled="sending"
              @click="emit('finish')"
            >
              Завершити чат
            </button>
          </slot>
        </div>
      </div>

      <div
        :ref="(el) => setMessagesEl?.(el as HTMLElement | null)"
        class="messages"
        role="log"
        aria-live="polite"
      >
        <div
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="isUserMessage(message) ? 'user' : 'assistant'"
        >
          <span class="message-label">
            {{ isUserMessage(message) ? "Ви" : "Агент" }}
          </span>
          <p class="message-text">{{ message.content }}</p>
        </div>
        <p v-if="sending" class="thinking">Думаю…</p>
      </div>

      <p v-if="errorMessage" class="error-banner" role="alert">
        {{ errorMessage }}
        <button
          type="button"
          class="btn-secondary"
          :disabled="sending || !lastFailedAction"
          @click="emit('retry')"
        >
          Спробувати ще раз
        </button>
      </p>

      <form v-if="!isClosed" class="composer" @submit.prevent="emit('send')">
        <textarea
          class="composer-input"
          rows="2"
          placeholder="Напишіть відповідь…"
          :value="input"
          :disabled="sending"
          @input="emit('update:input', ($event.target as HTMLTextAreaElement).value)"
          @keydown="emit('keydown', $event)"
        />
        <button type="submit" class="btn-primary" :disabled="sending || !input.trim()">
          Надіслати
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
/* Copy styles from CandidatePrepChat.vue (.chat-header through .btn-secondary:disabled) unchanged */
</style>
```

(Paste the existing scoped CSS from `CandidatePrepChat.vue` into the `<style scoped>` block — do not invent new tokens.)

- [ ] **Step 2: Rewrite `CandidatePrepChat.vue` as thin wrapper**

Replace script/template so it only wires adapters + panel:

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import {
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  finishCandidatePrepChat,
  sendCandidatePrepMessage,
  type CandidateProfile,
} from "../api/candidate-prep";
import { usePrepChat } from "../composables/usePrepChat";
import PrepChatPanel from "./PrepChatPanel.vue";

const props = defineProps<{ interviewId: string }>();
const emit = defineEmits<{ finished: []; deleted: [] }>();

const chat = usePrepChat<CandidateProfile>({
  adapters: {
    loadState: async () => {
      const state = await fetchCandidatePrepState(props.interviewId);
      return {
        messages: state.messages,
        isClosed: state.isClosed,
        profile: state.profile,
      };
    },
    sendMessage: (text) => sendCandidatePrepMessage(props.interviewId, text),
    finishChat: async () => {
      await finishCandidatePrepChat(props.interviewId);
    },
    deleteChat: () => deleteCandidatePrepChat(props.interviewId),
    isUserMessage: (msg) => msg.authorType === "HUMAN_CANDIDATE",
    humanAuthorType: "HUMAN_CANDIDATE",
    agentAuthorType: "AGENT_CANDIDATE",
  },
  onFinished: () => emit("finished"),
  onDeleted: () => emit("deleted"),
});

onMounted(() => {
  void chat.load();
});
</script>

<template>
  <PrepChatPanel
    title="Чат з Candidate Agent"
    :load-state="chat.loadState.value"
    :messages="chat.messages.value"
    :sending="chat.sending.value"
    :is-closed="chat.isClosed.value"
    :input="chat.input.value"
    :error-message="chat.errorMessage.value"
    :last-failed-action="chat.lastFailedAction.value"
    :is-user-message="chat.isUserMessage"
    :delete-disabled="!!chat.profile.value?.confirmedAt"
    :delete-title="
      chat.profile.value?.confirmedAt ? 'Підтверджений профіль не можна видалити' : ''
    "
    :set-messages-el="(el) => { chat.messagesEl.value = el; }"
    @update:input="(v) => { chat.input.value = v; }"
    @send="chat.send"
    @retry="chat.retry"
    @finish="chat.finish"
    @delete="chat.deleteChat"
    @keydown="chat.onKeydown"
  />
</template>
```

Note: in `<script setup>` template auto-unwraps refs returned from setup if you destructure carefully. Prefer assigning to top-level consts from `chat` for cleaner template:

```ts
const {
  loadState,
  messages,
  sending,
  isClosed,
  input,
  errorMessage,
  lastFailedAction,
  profile,
  messagesEl,
  load,
  send,
  retry,
  finish,
  deleteChat,
  onKeydown,
  isUserMessage,
} = chat;
```

Then template uses `loadState`, `messages`, etc. without `.value`. Keep `input` writable via `@update:input`.

- [ ] **Step 3: Typecheck**

Run: `npm --workspace frontend run lint`

Expected: no errors related to PrepChatPanel / CandidatePrepChat.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PrepChatPanel.vue frontend/src/components/CandidatePrepChat.vue
git commit -m "$(cat <<'EOF'
feat(fe): extract PrepChatPanel and wire CandidatePrepChat

EOF
)"
```

---

### Task 3: Migrate `CompanyProfilePrepView`

**Files:**
- Modify: `frontend/src/views/CompanyProfilePrepView.vue`

**Interfaces:**
- Consumes: `usePrepChat`, `PrepChatPanel`, `../api/company-prep`
- Produces: same UX; chat section replaced; profile section unchanged

- [ ] **Step 1: Replace chat state/methods with `usePrepChat`**

Remove local duplicates: `messages`, `input`, `sending`, `lastFailedAction`, `lastReadyForConfirmation`, `messagesEl`, `triggerGreeting`, `sendMessage`, `retryLastFailed`, `onKeydown`, `onDeleteChat`, `onFinishChat`, and the chat-only parts of `loadPrepState`.

Keep: `viewingHistory`, `editableProfile`, `saving`, profile section editors, `syncEditableProfile`, confirm/save flows.

Wire:

```ts
import { usePrepChat } from "../composables/usePrepChat";
import PrepChatPanel from "../components/PrepChatPanel.vue";

const chat = usePrepChat<HrCompanyProfile>({
  adapters: {
    loadState: async () => {
      const state = await fetchCompanyPrepState();
      return {
        messages: state.messages,
        isClosed: state.isClosed,
        profile: state.profile,
      };
    },
    sendMessage: (text) => sendCompanyPrepMessage(text),
    finishChat: () => finishCompanyPrepChat(),
    deleteChat: () => deleteCompanyPrepChat(),
    isUserMessage: (msg) => msg.authorType === "HUMAN_HR",
    humanAuthorType: "HUMAN_HR",
    agentAuthorType: "AGENT_COMPANY",
  },
  onAfterLoad: (state) => {
    syncEditableProfile(state.profile);
    viewingHistory.value = false;
  },
  onFinished: () => {
    syncEditableProfile(chat.profile.value);
    viewingHistory.value = false;
  },
  onDeleted: () => {
    syncEditableProfile(null);
    viewingHistory.value = false;
  },
});

async function loadPage(): Promise<void> {
  await chat.load();
}

onMounted(loadPage);
```

Update template conditions that used `loadState` / `isClosed` / `profile` / `errorMessage` to use `chat.*` (or destructured refs).

Replace the `section.chat-view` block with:

```vue
<PrepChatPanel
  v-else
  title="Чат з Company Agent"
  :load-state="loadState"
  :messages="messages"
  :sending="sending"
  :is-closed="isClosed"
  :input="input"
  :error-message="errorMessage"
  :last-failed-action="lastFailedAction"
  :is-user-message="isUserMessage"
  :set-messages-el="(el) => { messagesEl = el; }"
  @update:input="(v) => { input = v; }"
  @send="send"
  @retry="retry"
  @finish="finish"
  @delete="deleteChat"
  @keydown="onKeydown"
/>
```

(Use whatever local names you destructured from `chat`.)

Remove duplicated chat CSS that now lives in `PrepChatPanel` (keep profile-view styles).

- [ ] **Step 2: Typecheck**

Run: `npm --workspace frontend run lint`

Expected: PASS for CompanyProfilePrepView.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CompanyProfilePrepView.vue
git commit -m "$(cat <<'EOF'
refactor(fe): use shared prep chat in CompanyProfilePrepView

EOF
)"
```

---

### Task 4: Migrate `VacancyPrepView`

**Files:**
- Modify: `frontend/src/views/VacancyPrepView.vue`

**Interfaces:**
- Consumes: `usePrepChat`, `PrepChatPanel`, `../api/prep`, `fetchVacancy`
- Produces: same UX including `missingCompanyProfile` gate on auto-greet

- [ ] **Step 1: Wire `usePrepChat` with vacancy extras**

Keep vacancy title editing, `missingCompanyProfile`, `canEditProfile`, `editingConfirmed`, profile editors.

```ts
const missingCompanyProfile = ref(false);
// ... other vacancy-only refs ...

const chat = usePrepChat<CompanyProfile>({
  adapters: {
    loadState: async () => {
      const [vacancy, state] = await Promise.all([
        fetchVacancy(vacancyId.value),
        fetchPrepState(vacancyId.value),
      ]);
      title.value = vacancy.title;
      editableTitle.value = vacancy.title;
      vacancyStatus.value = vacancy.status ?? null;
      missingCompanyProfile.value = state.missingCompanyProfile;
      canEditProfile.value = state.canEditProfile;
      editingConfirmed.value = false;
      viewingHistory.value = false;
      return {
        messages: state.messages,
        isClosed: state.isClosed,
        profile: state.profile,
      };
    },
    sendMessage: (text) => sendPrepMessage(vacancyId.value, text),
    finishChat: () => finishPrepChat(vacancyId.value),
    deleteChat: () => deletePrepChat(vacancyId.value),
    isUserMessage: (msg) => msg.authorType === "HUMAN_HR",
    humanAuthorType: "HUMAN_HR",
    agentAuthorType: "AGENT_COMPANY",
  },
  shouldAutoGreet: () => !missingCompanyProfile.value,
  onAfterLoad: (state) => {
    if (state.profile && (!state.profile.confirmedAt || editingConfirmed.value)) {
      syncEditableProfile(state.profile);
    }
  },
  onFinished: () => {
    syncEditableProfile(chat.profile.value);
    viewingHistory.value = false;
  },
  onDeleted: () => {
    editableProfile.value = null;
    viewingHistory.value = false;
    vacancyStatus.value = null;
  },
});
```

Important: `shouldAutoGreet` must read the `missingCompanyProfile` value set inside `loadState` **before** greeting runs (adapters.loadState completes first — OK).

On delete when `missingCompanyProfile` is true, `shouldAutoGreet(() => !missingCompanyProfile.value)` returns false — no greeting (matches current behavior).

Replace chat-view section with `PrepChatPanel` titled e.g. `"Чат з Company Agent"` (same title as currently in VacancyPrepView — copy exact string from the view).

Preserve the early UI for `missingCompanyProfile` (banner / CTA) that currently appears instead of chat — do not remove that branch; only replace the actual chat section.

- [ ] **Step 2: Typecheck**

Run: `npm --workspace frontend run lint`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/VacancyPrepView.vue
git commit -m "$(cat <<'EOF'
refactor(fe): use shared prep chat in VacancyPrepView

EOF
)"
```

---

### Task 5: Remove legacy `CandidatePrepView` + redirect + README

**Files:**
- Delete: `frontend/src/views/CandidatePrepView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `README.md` (Day 12 quick start routes / scenario paths)

**Interfaces:**
- Consumes: existing `candidate-profile` route
- Produces: `candidate-prep` path redirects to profile

- [ ] **Step 1: Update router**

In `frontend/src/router/index.ts`:

1. Remove `import CandidatePrepView from "../views/CandidatePrepView.vue";`
2. Replace the prep child route with:

```ts
{
  path: "prep/:interviewId",
  name: "candidate-prep",
  redirect: { name: "candidate-profile" },
},
```

- [ ] **Step 2: Delete `CandidatePrepView.vue`**

```bash
rm frontend/src/views/CandidatePrepView.vue
```

- [ ] **Step 3: Update README UI paths**

In `README.md` section **Candidate Prep Chat UI Quick Start (Day 12)**:

- Table row: change `/candidate/prep/:interviewId` → `/candidate/profile` with description «Анкета + чат з Candidate Agent»
- Scenario step 2: «Моя анкета» → `/candidate/profile`
- Step 6: HR opening `/candidate/prep/:interviewId` → note that path redirects to `/candidate/profile` (candidate-only area still redirects HR to `/` via auth)

Also update the Day 13 line that says «Пройти анкету в `/candidate/prep/:interviewId`» → `/candidate/profile`.

Do **not** change API docs for `/api/candidate-prep`.

- [ ] **Step 4: Typecheck**

Run: `npm --workspace frontend run lint`

Expected: PASS (no missing CandidatePrepView import).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/router/index.ts README.md
git add -u frontend/src/views/CandidatePrepView.vue
git commit -m "$(cat <<'EOF'
refactor(fe): redirect legacy candidate-prep to profile

EOF
)"
```

---

### Task 6: Remove dead demo client + verify

**Files:**
- Delete: `frontend/src/components/ChatPanel.vue`
- Delete: `frontend/src/api/llm.ts`
- Delete: `frontend/src/api/health.ts`

**Interfaces:**
- Consumes: none (unused)
- Produces: cleaner frontend tree; backend `/api/llm/complete` unchanged

- [ ] **Step 1: Confirm no imports**

```bash
# from repo root
grep -R "ChatPanel\|api/llm\|from \"./llm\"\|from '../api/llm'\|fetchHealth\|api/health" frontend/src --include='*.ts' --include='*.vue' || true
```

Expected: only the files being deleted (or no matches).

- [ ] **Step 2: Delete the three files**

```bash
rm frontend/src/components/ChatPanel.vue frontend/src/api/llm.ts frontend/src/api/health.ts
```

- [ ] **Step 3: Run frontend tests + lint**

```bash
npm --workspace frontend test
npm --workspace frontend run lint
```

Expected: tests PASS; lint PASS.

- [ ] **Step 4: Commit**

```bash
git add -u frontend/src/components/ChatPanel.vue frontend/src/api/llm.ts frontend/src/api/health.ts
git commit -m "$(cat <<'EOF'
chore(fe): remove unused ChatPanel and demo API clients

EOF
)"
```

---

## Manual smoke (after Task 6)

1. Candidate: `/candidate/profile` — chat greeting, send, retry (force error if possible), finish → confirm profile.
2. HR: `/company-profile` — same chat loop + profile edit.
3. HR: `/vacancies/:id/prep` — with company profile present: chat works; without: no auto-greet / existing gate UI still shows.
4. Open `/candidate/prep/<anyId>` while logged in as candidate → lands on profile.

---

## Spec coverage self-check

| Spec item | Task |
|-----------|------|
| `usePrepChat` + adapters | Task 1 |
| Unit tests load/send/retry/delete | Task 1 |
| `PrepChatPanel` | Task 2 |
| Wire `CandidatePrepChat` | Task 2 |
| Wire Company / Vacancy | Tasks 3–4 |
| Delete `CandidatePrepView` + redirect | Task 5 |
| README UI paths | Task 5 |
| Delete `ChatPanel` / `llm.ts` / `health.ts` | Task 6 |
| Keep backend `/api/llm/complete` | Task 6 (explicit non-touch) |
| `shouldAutoGreet` for vacancy gate | Task 4 |
| No live/dialogs merge | Global Constraints |

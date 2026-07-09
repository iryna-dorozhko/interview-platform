# Candidate Prep Chat UI (Day 12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати browser UI для candidate prep-чату — сторінка «Мій профіль / Анкета» з Candidate Agent, аналогічно HR-анкеті на Дні 5.

**Architecture:** Окремий `CandidatePrepView.vue` і `frontend/src/api/candidate-prep.ts` підключаються до існуючого backend `/api/candidate-prep/:interviewId` (День 11). Маршрут `/candidate/prep/:interviewId` захищений `requiredRole: CANDIDATE`. Кабінет `/candidate` отримує кнопку «Моя анкета» з demo `interviewId` через `VITE_DEMO_INTERVIEW_ID`. Без змін backend, без finish/confirm UI (День 13).

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, Vue Router, Pinia auth store, Vite env vars.

**Spec:** `docs/superpowers/specs/2026-07-09-candidate-prep-ui-day12-design.md`

---

## File Structure (before tasks)

### Create

- `frontend/src/api/candidate-prep.ts` — API-клієнт для candidate prep endpoints
- `frontend/src/views/CandidatePrepView.vue` — chat UI з Candidate Agent

### Modify

- `frontend/src/router/index.ts` — route `/candidate/prep/:interviewId`
- `frontend/src/views/CandidateHomeView.vue` — кнопка «Моя анкета» + env hint
- `frontend/src/vite-env.d.ts` — тип `VITE_DEMO_INTERVIEW_ID`
- `README.md` — Day 12 Quick Start, оновити DoD checkboxes

### Verification

- Command: `npm --workspace frontend run build`
- Command: `npm run build`
- Manual: candidate chat flow (register → prep → reload → delete)

---

### Task 1: Candidate Prep API Client

**Files:**
- Create: `frontend/src/api/candidate-prep.ts`
- Reference: `frontend/src/api/prep.ts`

- [ ] **Step 1: Create `candidate-prep.ts`**

```ts
import { fetchWithAuth } from "./client";

export type CandidatePrepAuthorType = "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";

export type CandidatePrepMessage = {
  id: string;
  authorType: CandidatePrepAuthorType;
  content: string;
  createdAt: string;
};

export type CandidateProfilePreview = {
  experience: unknown;
  skills: unknown;
  goals: unknown;
  summary: string;
  confirmedAt: string | null;
};

export type CandidatePrepState = {
  messages: CandidatePrepMessage[];
  isClosed: boolean;
  profile: CandidateProfilePreview | null;
};

export type SendMessageResponse = {
  message: string;
  readyForConfirmation: boolean;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore parse errors
  }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchCandidatePrepState(interviewId: string): Promise<CandidatePrepState> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  return response.json() as Promise<CandidatePrepState>;
}

export async function sendCandidatePrepMessage(
  interviewId: string,
  message?: string
): Promise<SendMessageResponse> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}/message`, {
    method: "POST",
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати повідомлення");
  }
  return response.json() as Promise<SendMessageResponse>;
}

export async function deleteCandidatePrepChat(interviewId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити чат");
  }
}
```

- [ ] **Step 2: Run frontend build**

Run: `npm --workspace frontend run build`  
Expected: PASS (новий файл не ламає існуючий код).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/candidate-prep.ts
git commit -m "feat(frontend): add candidate prep API client"
```

---

### Task 2: Router Route + Vite Env Type

**Files:**
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/views/CandidatePrepView.vue` (stub for build)

- [ ] **Step 1: Add env type to `vite-env.d.ts`**

Append after the `vue-router` module block:

```ts
interface ImportMetaEnv {
  readonly VITE_DEMO_INTERVIEW_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Create minimal stub `CandidatePrepView.vue`**

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const interviewId = computed(() => String(route.params.interviewId));
</script>

<template>
  <main class="page">
    <h1>Мій профіль / Анкета</h1>
    <p>Interview: {{ interviewId }}</p>
  </main>
</template>
```

- [ ] **Step 3: Register route in `router/index.ts`**

Add import:

```ts
import CandidatePrepView from "../views/CandidatePrepView.vue";
```

Add route after `candidate-home` entry:

```ts
{
  path: "/candidate/prep/:interviewId",
  name: "candidate-prep",
  component: CandidatePrepView,
  meta: { requiresAuth: true, requiredRole: "CANDIDATE" },
},
```

- [ ] **Step 4: Run frontend build**

Run: `npm --workspace frontend run build`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/vite-env.d.ts frontend/src/router/index.ts frontend/src/views/CandidatePrepView.vue
git commit -m "feat(router): add candidate prep route stub"
```

---

### Task 3: Candidate Prep Chat View

**Files:**
- Modify: `frontend/src/views/CandidatePrepView.vue`
- Reference: `frontend/src/views/VacancyPrepView.vue` (chat section only)

- [ ] **Step 1: Replace stub with full chat implementation**

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  sendCandidatePrepMessage,
  type CandidatePrepMessage,
} from "../api/candidate-prep";

const route = useRoute();
const router = useRouter();
const interviewId = computed(() => String(route.params.interviewId));

const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const messages = ref<CandidatePrepMessage[]>([]);
const isClosed = ref(false);
const input = ref("");
const sending = ref(false);
const lastReadyForConfirmation = ref(false);
const messagesEl = ref<HTMLElement | null>(null);

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function loadPrepState(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    const state = await fetchCandidatePrepState(interviewId.value);
    messages.value = state.messages;
    isClosed.value = state.isClosed;
    loadState.value = "ready";

    if (!state.isClosed && state.messages.length === 0) {
      await triggerGreeting();
    }
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завантажити анкету";
  }
}

async function triggerGreeting(): Promise<void> {
  sending.value = true;
  try {
    const response = await sendCandidatePrepMessage(interviewId.value);
    messages.value.push({
      id: `local_${Date.now()}`,
      authorType: "AGENT_CANDIDATE",
      content: response.message,
      createdAt: new Date().toISOString(),
    });
    lastReadyForConfirmation.value = response.readyForConfirmation;
    await scrollToBottom();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
  } finally {
    sending.value = false;
  }
}

async function sendMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || sending.value || isClosed.value) return;

  errorMessage.value = null;
  input.value = "";
  messages.value.push({
    id: `local_${Date.now()}`,
    authorType: "HUMAN_CANDIDATE",
    content: text,
    createdAt: new Date().toISOString(),
  });
  await scrollToBottom();

  sending.value = true;
  try {
    const response = await sendCandidatePrepMessage(interviewId.value, text);
    messages.value.push({
      id: `local_${Date.now()}_reply`,
      authorType: "AGENT_CANDIDATE",
      content: response.message,
      createdAt: new Date().toISOString(),
    });
    lastReadyForConfirmation.value = response.readyForConfirmation;
    await scrollToBottom();
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
    void sendMessage();
  }
}

async function onDeleteChat(): Promise<void> {
  if (!window.confirm("Видалити всю історію чату? Цю дію не можна скасувати.")) return;

  errorMessage.value = null;
  try {
    await deleteCandidatePrepChat(interviewId.value);
    messages.value = [];
    isClosed.value = false;
    lastReadyForConfirmation.value = false;
    await triggerGreeting();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
}

function goHome(): void {
  router.push({ name: "candidate-home" });
}

onMounted(loadPrepState);
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>Мій профіль / Анкета</h1>
      <button type="button" class="btn-secondary" @click="goHome">← До кабінету</button>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <section v-else class="chat-view">
      <div class="chat-header">
        <h2>Чат з Candidate Agent</h2>
        <button type="button" class="btn-secondary" :disabled="sending" @click="onDeleteChat">
          Видалити чат
        </button>
      </div>

      <div ref="messagesEl" class="messages" role="log" aria-live="polite">
        <div
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="message.authorType === 'HUMAN_CANDIDATE' ? 'user' : 'assistant'"
        >
          <span class="message-label">
            {{ message.authorType === "HUMAN_CANDIDATE" ? "Ви" : "Агент" }}
          </span>
          <p class="message-text">{{ message.content }}</p>
        </div>
        <p v-if="sending" class="thinking">Думаю…</p>
      </div>

      <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>

      <form v-if="!isClosed" class="composer" @submit.prevent="sendMessage">
        <textarea
          v-model="input"
          class="composer-input"
          rows="2"
          placeholder="Напишіть відповідь…"
          :disabled="sending"
          @keydown="onKeydown"
        />
        <button type="submit" class="btn-primary" :disabled="sending || !input.trim()">
          Надіслати
        </button>
      </form>

      <p v-else class="closed-hint">Сесію анкети закрито.</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  gap: 0.5rem;
}
.header h1 {
  margin: 0;
  font-size: 1.25rem;
}
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  gap: 0.5rem;
}
.chat-header h2 {
  margin: 0;
  font-size: 1rem;
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
.message {
  margin-bottom: 0.75rem;
  max-width: 85%;
}
.message.user {
  margin-left: auto;
  text-align: right;
}
.message.assistant {
  margin-right: auto;
  text-align: left;
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
  display: inline-block;
}
.message.user .message-text {
  background: #dbeafe;
  color: #1e3a5f;
}
.message.assistant .message-text {
  background: #e5e7eb;
  color: #1f2937;
}
.thinking {
  margin: 0;
  color: #666;
  font-size: 0.875rem;
  font-style: italic;
}
.closed-hint {
  margin: 0;
  color: #666;
  font-size: 0.875rem;
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
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.btn-primary {
  background: #16a34a;
  color: #fff;
}
.btn-primary:disabled {
  background: #86efac;
  cursor: not-allowed;
}
.btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 2: Run frontend build**

Run: `npm --workspace frontend run build`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CandidatePrepView.vue
git commit -m "feat(frontend): add candidate prep chat view"
```

---

### Task 4: Candidate Home — «Моя анкета» Button

**Files:**
- Modify: `frontend/src/views/CandidateHomeView.vue`

- [ ] **Step 1: Update home view with prep navigation**

Replace entire file:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

const demoInterviewId = computed(() => import.meta.env.VITE_DEMO_INTERVIEW_ID?.trim() ?? "");
const hasDemoInterview = computed(() => demoInterviewId.value.length > 0);

function openQuestionnaire(): void {
  if (!hasDemoInterview.value) return;
  router.push({ name: "candidate-prep", params: { interviewId: demoInterviewId.value } });
}

function logout(): void {
  auth.logout();
  router.push("/candidate/login");
}
</script>

<template>
  <main class="page">
    <h1>Кабінет кандидата</h1>
    <p class="intro">Заповніть анкету перед співбесідою — Candidate Agent допоможе зібрати інформацію про ваш досвід.</p>

    <div class="actions">
      <button type="button" class="btn-primary" :disabled="!hasDemoInterview" @click="openQuestionnaire">
        Моя анкета
      </button>
      <button type="button" class="btn-secondary" @click="logout">Вийти</button>
    </div>

    <p v-if="!hasDemoInterview" class="hint">
      Додайте <code>VITE_DEMO_INTERVIEW_ID</code> у <code>frontend/.env</code> (id з виводу
      <code>npm --workspace backend run db:seed</code>, <code>joinCode=TEST01</code>) або відкрийте
      <code>/candidate/prep/:interviewId</code> вручну.
    </p>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 32rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.intro {
  color: #374151;
  line-height: 1.5;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-primary {
  background: #16a34a;
  color: #fff;
}
.btn-primary:disabled {
  background: #86efac;
  cursor: not-allowed;
}
.btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.hint {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #f3f4f6;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: #4b5563;
  line-height: 1.5;
}
code {
  font-size: 0.8125rem;
  background: #e5e7eb;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
}
</style>
```

- [ ] **Step 2: Run frontend build**

Run: `npm --workspace frontend run build`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CandidateHomeView.vue
git commit -m "feat(frontend): add questionnaire entry on candidate home"
```

---

### Task 5: README + Final Verification

**Files:**
- Modify: `README.md` (section «День 12»)

- [ ] **Step 1: Update Day 12 DoD checkboxes and add Quick Start**

Replace the Day 12 section (after line `## День 12 — Анкета кандидата в браузері`) with:

```md
## День 12 — Анкета кандидата в браузері

**Задача:** кандидат проходить анкету на сайті.

**Що робиш:**
- Сторінка «Мій профіль» / «Анкета»
- Чат з Candidate Agent (як у HR на дні 5)

**Definition of Done:**
- [ ] Демонстрація: кандидат проходить анкету в браузері
- [ ] Сценарій: UI працює аналогічно HR-анкеті; історія чату зберігається після перезавантаження
- [ ] Збірка: `npm run build` проходить
- [ ] README: маршрут анкети кандидата в UI

### Candidate Prep Chat UI Quick Start (Day 12)

**Передумови:** День 10 (candidate auth), День 11 (candidate prep API), запущений LLM.

**1. Налаштувати demo interviewId:**

```bash
npm --workspace backend run db:seed
# Скопіювати interviewId з рядка "Seeded test interview: id=... joinCode=TEST01"
```

Створити `frontend/.env`:

```
VITE_DEMO_INTERVIEW_ID=<interviewId-from-seed>
```

**2. UI-маршрути:**

| Маршрут | Опис |
|---|---|
| `/candidate` | Кабінет кандидата, кнопка «Моя анкета» |
| `/candidate/prep/:interviewId` | Чат з Candidate Agent |

**3. Сценарій перевірки:**

```bash
npm run dev
```

1. Зареєструватися на `/candidate/register` (або увійти на `/candidate/login`)
2. На `/candidate` натиснути **«Моя анкета»** → `/candidate/prep/:interviewId`
3. Агент привітається; надіслати 2–3 відповіді про досвід
4. Перезавантажити сторінку — історія чату на місці
5. «Видалити чат» → нова розмова з привітанням
6. Увійти як HR → відкрити `/candidate/prep/:interviewId` → редірект на `/`

**4. API (для порівняння з UI):**

Див. [Candidate Prep Quick Start (Day 11)](#candidate-prep-quick-start) — ті самі endpoint-и, UI викликає їх через `fetchWithAuth`.
```

- [ ] **Step 2: Run full build**

Run: `npm run build`  
Expected: PASS for backend and frontend.

- [ ] **Step 3: Manual smoke test**

1. Set `VITE_DEMO_INTERVIEW_ID` in `frontend/.env`
2. Register/login as candidate → «Моя анкета» → chat works
3. Reload page → messages persist
4. HR login → navigate to `/candidate/prep/<id>` → redirect to `/`

- [ ] **Step 4: Commit docs**

```bash
git add README.md
git commit -m "docs: add Day 12 candidate prep chat UI quick-start"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| `/candidate/prep/:interviewId` route | Task 2 |
| Minimal shell, back to cabinet | Task 3 |
| `candidate-prep.ts` API client | Task 1 |
| Chat UI (messages, send, delete, greeting) | Task 3 |
| No finish/confirm/profile UI | Task 3 (omitted by design) |
| `VITE_DEMO_INTERVIEW_ID` + hint | Task 2, 4 |
| README Quick Start | Task 5 |
| Role isolation via existing guards | Task 2 (meta) |
| `npm run build` passes | Tasks 1–5 |

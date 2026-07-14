<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  confirmCandidatePrepProfile,
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  finishCandidatePrepChat,
  sendCandidatePrepMessage,
  type CandidatePrepMessage,
  type CandidateProfile,
} from "../api/candidate-prep";

const route = useRoute();
const router = useRouter();
const interviewId = computed(() => String(route.params.interviewId));

const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const messages = ref<CandidatePrepMessage[]>([]);
const isClosed = ref(false);
const profile = ref<CandidateProfile | null>(null);
const viewingHistory = ref(false);
const input = ref("");
const sending = ref(false);
const confirming = ref(false);
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
    profile.value = state.profile;
    viewingHistory.value = false;
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
    profile.value = null;
    viewingHistory.value = false;
    lastReadyForConfirmation.value = false;
    await triggerGreeting();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
}

async function onFinishChat(): Promise<void> {
  if (!lastReadyForConfirmation.value) {
    const proceed = window.confirm("Даних може бути недостатньо. Все одно завершити й сформувати профіль?");
    if (!proceed) return;
  }

  errorMessage.value = null;
  sending.value = true;
  try {
    const response = await finishCandidatePrepChat(interviewId.value);
    profile.value = response.profile;
    isClosed.value = true;
    viewingHistory.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завершити чат";
  } finally {
    sending.value = false;
  }
}

async function onConfirmProfile(): Promise<void> {
  if (
    !window.confirm(
      "Профіль буде зафіксовано. Подальше редагування стане неможливим. Підтвердити?"
    )
  ) {
    return;
  }

  errorMessage.value = null;
  confirming.value = true;
  try {
    const response = await confirmCandidatePrepProfile(interviewId.value);
    profile.value = response.profile;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося підтвердити профіль";
  } finally {
    confirming.value = false;
  }
}

function backToChat(): void {
  viewingHistory.value = true;
}

function backToProfile(): void {
  viewingHistory.value = false;
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

    <template v-else>
      <section v-if="isClosed && profile && !viewingHistory" class="profile-view">
        <h2>Зібраний профіль кандидата</h2>
        <dl>
          <dt>Досвід</dt>
          <dd><ul><li v-for="(item, i) in profile.experience" :key="i">{{ item }}</li></ul></dd>
          <dt>Сильні сторони</dt>
          <dd><ul><li v-for="(item, i) in profile.skills.strong" :key="i">{{ item }}</li></ul></dd>
          <dt>Зони росту</dt>
          <dd><ul><li v-for="(item, i) in profile.skills.growth" :key="i">{{ item }}</li></ul></dd>
          <dt>Цілі</dt>
          <dd><ul><li v-for="(item, i) in profile.goals" :key="i">{{ item }}</li></ul></dd>
          <dt>Короткий опис</dt>
          <dd>{{ profile.summary }}</dd>
        </dl>
        <div class="actions">
          <button type="button" class="btn-secondary" @click="backToChat">← Назад до чату</button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="!!profile.confirmedAt"
            :title="profile.confirmedAt ? 'Підтверджений профіль не можна видалити' : ''"
            @click="onDeleteChat"
          >
            Видалити чат
          </button>
          <button
            v-if="!profile.confirmedAt"
            type="button"
            class="btn-primary"
            :disabled="confirming"
            @click="onConfirmProfile"
          >
            Підтвердити профіль
          </button>
          <p v-else class="confirmed-banner">
            ✓ Підтверджено {{ new Date(profile.confirmedAt).toLocaleString("uk-UA") }}
          </p>
        </div>
      </section>

      <section v-else class="chat-view">
        <div class="chat-header">
          <h2>Чат з Candidate Agent</h2>
          <div class="chat-actions">
            <button
              type="button"
              class="btn-secondary"
              :disabled="sending || !!profile?.confirmedAt"
              :title="profile?.confirmedAt ? 'Підтверджений профіль не можна видалити' : ''"
              @click="onDeleteChat"
            >
              Видалити чат
            </button>
            <button
              v-if="!isClosed"
              type="button"
              class="btn-primary"
              :disabled="sending"
              @click="onFinishChat"
            >
              Завершити чат
            </button>
            <button v-else-if="profile" type="button" class="btn-secondary" @click="backToProfile">
              Показати профіль
            </button>
          </div>
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
      </section>
    </template>
  </main>
</template>

<style scoped>
.page {
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
.chat-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
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
  background: var(--accent-soft);
  color: var(--accent);
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
.error-banner {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: var(--danger);
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
.profile-view dl {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.5rem 1rem;
  margin: 1rem 0;
}
.profile-view dt {
  font-weight: 600;
  color: #374151;
}
.profile-view dd {
  margin: 0;
}
.profile-view ul {
  margin: 0;
  padding-left: 1.25rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.confirmed-banner {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
}
</style>

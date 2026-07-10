<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import {
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  finishCandidatePrepChat,
  sendCandidatePrepMessage,
  type CandidatePrepMessage,
  type CandidateProfile,
} from "../api/candidate-prep";

const props = defineProps<{
  interviewId: string;
}>();

const emit = defineEmits<{
  finished: [];
  deleted: [];
}>();

const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const messages = ref<CandidatePrepMessage[]>([]);
const isClosed = ref(false);
const profile = ref<CandidateProfile | null>(null);
const input = ref("");
const sending = ref(false);
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
    const response = await sendCandidatePrepMessage(props.interviewId);
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

async function loadPrepState(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    const state = await fetchCandidatePrepState(props.interviewId);
    messages.value = state.messages;
    isClosed.value = state.isClosed;
    profile.value = state.profile;
    loadState.value = "ready";

    if (state.isClosed) {
      emit("finished");
      return;
    }

    if (state.messages.length === 0) {
      await triggerGreeting();
    }
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завантажити анкету";
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
    const response = await sendCandidatePrepMessage(props.interviewId, text);
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
    await deleteCandidatePrepChat(props.interviewId);
    messages.value = [];
    isClosed.value = false;
    profile.value = null;
    lastReadyForConfirmation.value = false;
    emit("deleted");
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
    await finishCandidatePrepChat(props.interviewId);
    isClosed.value = true;
    emit("finished");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завершити чат";
  } finally {
    sending.value = false;
  }
}

onMounted(loadPrepState);
</script>

<template>
  <section class="chat-view">
    <p v-if="loadState === 'loading'">Завантаження чату…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else>
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
    </template>
  </section>
</template>

<style scoped>
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
  background: #2563eb;
  color: #fff;
}
.btn-primary:disabled {
  background: #93c5fd;
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

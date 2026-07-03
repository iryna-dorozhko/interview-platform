<script setup lang="ts">
import { nextTick, ref } from "vue";
import { sendChat, type UiMessage } from "../api/llm";

const messages = ref<UiMessage[]>([]);
const input = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const lastProvider = ref<string | null>(null);
const messagesEl = ref<HTMLElement | null>(null);

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = messagesEl.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

function clearChat(): void {
  if (loading.value) return;
  messages.value = [];
  input.value = "";
  error.value = null;
  lastProvider.value = null;
}

async function sendMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || loading.value) return;

  error.value = null;
  input.value = "";
  messages.value.push({ role: "user", content: text });
  await scrollToBottom();

  loading.value = true;
  try {
    const response = await sendChat(messages.value);
    messages.value.push({ role: "assistant", content: response.text });
    lastProvider.value = response.provider;
    await scrollToBottom();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не вдалося отримати відповідь.";
  } finally {
    loading.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
}
</script>

<template>
  <section class="chat-panel">
    <header class="chat-header">
      <h2>Чат з AI</h2>
      <button type="button" class="btn-secondary" :disabled="loading" @click="clearChat">
        Новий чат
      </button>
    </header>

    <div ref="messagesEl" class="messages" role="log" aria-live="polite">
      <p v-if="messages.length === 0" class="empty-hint">
        Напиши повідомлення, щоб почати діалог.
      </p>
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message"
        :class="message.role"
      >
        <span class="message-label">{{ message.role === "user" ? "Ви" : "AI" }}</span>
        <p class="message-text">{{ message.content }}</p>
        <span
          v-if="message.role === 'assistant' && index === messages.length - 1 && lastProvider"
          class="provider-tag"
        >
          ({{ lastProvider }})
        </span>
      </div>
      <p v-if="loading" class="thinking">Думаю…</p>
    </div>

    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>

    <form class="composer" @submit.prevent="sendMessage">
      <textarea
        v-model="input"
        class="composer-input"
        rows="2"
        placeholder="Напиши повідомлення…"
        :disabled="loading"
        @keydown="onKeydown"
      />
      <button type="submit" class="btn-primary" :disabled="loading || !input.trim()">
        Надіслати
      </button>
    </form>
  </section>
</template>

<style scoped>
.chat-panel {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #ddd;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.chat-header h2 {
  margin: 0;
  font-size: 1.125rem;
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
}

.message.user .message-text {
  background: #dbeafe;
  color: #1e3a5f;
}

.message.assistant .message-text {
  background: #e5e7eb;
  color: #1f2937;
}

.provider-tag {
  display: block;
  font-size: 0.7rem;
  color: #888;
  margin-top: 0.25rem;
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

.composer-input:disabled {
  background: #f3f4f6;
}

.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
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

<script setup lang="ts">
import type { PrepChatMessage, PrepFailedAction } from "../composables/usePrepChat";

defineProps<{
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
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
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
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
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
  background: var(--accent);
  color: #fff;
}
.btn-primary:disabled {
  opacity: 0.55;
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

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { AgentThinkingState, LiveMessage } from "../composables/useInterviewRoom";

const props = defineProps<{
  messages: LiveMessage[];
  currentRole: "HR" | "CANDIDATE";
  connectionState: "connecting" | "connected" | "error";
  disabled?: boolean;
  errorMessage?: string | null;
  agentThinking?: AgentThinkingState | null;
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

const thinkingLabel = computed(() => {
  switch (props.agentThinking?.agentType) {
    case "AGENT_ARBITER":
      return "Arbiter";
    case "AGENT_COMPANY":
      return "Компанія";
    case "AGENT_CANDIDATE":
      return "Кандидат (AI)";
    default:
      return "Агент";
  }
});

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
        :class="{
          own: message.authorType === ownAuthorType,
          agent: message.authorType.startsWith('AGENT_'),
        }"
      >
        <span class="message-label">{{ labelFor(message.authorType) }}</span>
        <p class="message-text">{{ message.content }}</p>
      </div>
      <p v-if="agentThinking?.active" class="thinking">{{ thinkingLabel }} думає…</p>
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

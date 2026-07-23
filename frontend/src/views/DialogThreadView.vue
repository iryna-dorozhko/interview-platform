<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  deleteDialog,
  fetchDialogs,
  type DialogMessage,
  type InterviewDecisionType,
} from "../api/dialogs";
import { useDialogThread } from "../composables/useDialogThread";
import { useDialogUnread } from "../composables/useDialogUnread";
import { useAuthStore } from "../stores/auth";

const DECISION_BADGES: Record<InterviewDecisionType, string> = {
  ACCEPT: "Прийнято",
  REJECT: "Відхилено",
  ADDITIONAL_MEETING: "Додаткова зустріч",
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { markRead, refresh } = useDialogUnread();

const isCandidate = computed(() => route.path.startsWith("/candidate"));
const basePath = computed(() =>
  isCandidate.value ? "/candidate/dialogs" : "/dialogs",
);
const dialogId = computed(() => String(route.params.id));

const peerLabel = ref("Діалог");
const deleting = ref(false);
const deleteError = ref<string | null>(null);

const currentUserId = computed(() => auth.user?.id ?? null);

const {
  loadState,
  loadError,
  messages,
  draft,
  sending,
  sendError,
  peerTypingLabel,
  notifyTypingInput,
  send,
} = useDialogThread(dialogId, {
  currentUserId,
  onLoaded: async (id) => {
    peerLabel.value = "Діалог";
    try {
      const list = await fetchDialogs();
      const match = list.find((item) => item.id === id);
      if (match?.peer?.email) {
        peerLabel.value = match.peer.email;
      }
    } catch {
      // keep default label
    }
    try {
      await markRead(id);
    } catch {
      // leave unread badge until next successful mark/poll
    }
  },
});

watch(draft, (value) => {
  notifyTypingInput(value);
});

function isOwn(message: DialogMessage): boolean {
  return currentUserId.value != null && message.senderUserId === currentUserId.value;
}

function decisionBadge(type: InterviewDecisionType | null): string | null {
  if (!type) return null;
  return DECISION_BADGES[type] ?? type;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function onDelete(): Promise<void> {
  if (deleting.value) return;
  const ok = window.confirm(
    "Видалити цей діалог зі свого списку? Він знову з’явиться, якщо співрозмовник напише нове повідомлення.",
  );
  if (!ok) return;

  deleting.value = true;
  deleteError.value = null;
  try {
    await deleteDialog(dialogId.value);
    await refresh();
    await router.push(basePath.value);
  } catch (error) {
    deleteError.value =
      error instanceof Error ? error.message : "Не вдалося видалити діалог";
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div class="thread">
    <header class="header">
      <RouterLink :to="basePath" class="back-link">← До діалогів</RouterLink>
      <div class="header-row">
        <h1>{{ peerLabel }}</h1>
        <button
          v-if="loadState === 'ready'"
          type="button"
          class="btn-danger"
          :disabled="deleting"
          @click="onDelete"
        >
          Видалити
        </button>
      </div>
      <p v-if="deleteError" class="fail" role="alert">{{ deleteError }}</p>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="fail">{{ loadError }}</p>

    <template v-else>
      <div class="messages" role="log" aria-live="polite">
        <p v-if="messages.length === 0" class="muted">Поки немає повідомлень</p>
        <div
          v-for="message in messages"
          :key="message.id"
          class="bubble-row"
          :class="{ own: isOwn(message) }"
        >
          <div
            class="bubble"
            :class="{
              own: isOwn(message),
              letter: message.kind === 'DECISION_LETTER',
            }"
          >
            <span
              v-if="message.kind === 'DECISION_LETTER' && decisionBadge(message.decisionType)"
              class="badge"
              :class="message.decisionType ?? ''"
            >
              {{ decisionBadge(message.decisionType) }}
            </span>
            <p class="body">{{ message.body }}</p>
            <time class="meta" :datetime="message.createdAt">
              {{ formatTime(message.createdAt) }}
            </time>
          </div>
        </div>
        <p v-if="peerTypingLabel" class="typing">{{ peerTypingLabel }}</p>
      </div>

      <form class="composer" @submit.prevent="send">
        <label class="field">
          <span class="sr-only">Повідомлення</span>
          <textarea
            v-model="draft"
            rows="3"
            placeholder="Напишіть повідомлення…"
            :disabled="sending"
          />
        </label>
        <p v-if="sendError" class="fail" role="alert">{{ sendError }}</p>
        <button
          type="submit"
          class="btn-primary"
          :disabled="!draft.trim() || sending"
        >
          Надіслати
        </button>
      </form>
    </template>

<style scoped>
.thread {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: calc(100vh - 6rem);
}
.header {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.back-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
  width: fit-content;
}
.back-link:hover {
  text-decoration: underline;
}
h1 {
  margin: 0;
  font-size: 1.25rem;
}
.btn-danger {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid #fca5a5;
  background: #fff;
  color: var(--danger);
  cursor: pointer;
  flex-shrink: 0;
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.muted {
  color: var(--muted);
}
.typing {
  margin: 0.25rem 0 0;
  color: #666;
  font-size: 0.875rem;
  font-style: italic;
}
.fail {
  color: var(--danger);
}
.messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.bubble-row {
  display: flex;
  justify-content: flex-start;
}
.bubble-row.own {
  justify-content: flex-end;
}
.bubble {
  max-width: min(36rem, 85%);
  padding: 0.65rem 0.8rem;
  border-radius: 10px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.bubble.own {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}
.bubble.letter {
  background: #fff;
}
.badge {
  align-self: flex-start;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  background: var(--surface-muted);
  color: var(--text);
}
.badge.ACCEPT {
  background: var(--accent-soft);
  color: var(--accent);
}
.badge.REJECT {
  background: var(--danger-soft);
  color: var(--danger);
}
.badge.ADDITIONAL_MEETING {
  background: var(--warning-soft);
  color: var(--warning);
}
.body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.95rem;
  line-height: 1.45;
}
.meta {
  font-size: 0.75rem;
  color: var(--muted);
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.field textarea {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  resize: vertical;
  min-height: 4.5rem;
}
.btn-primary {
  align-self: flex-end;
  border: none;
  border-radius: 6px;
  padding: 0.45rem 0.85rem;
  font-size: 0.875rem;
  cursor: pointer;
  background: var(--accent);
  color: #fff;
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

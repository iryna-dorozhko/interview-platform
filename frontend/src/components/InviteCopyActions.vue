<script setup lang="ts">
import { ref } from "vue";
import { buildInviteLink, buildInviteMessage } from "../utils/invite-message";

const props = defineProps<{
  joinCode: string;
  displayName: string;
  scheduledAt: string | null;
}>();

const copyError = ref<string | null>(null);
const copied = ref<"code" | "link" | "text" | null>(null);

const origin = window.location.origin;

async function copyText(text: string, kind: "code" | "link" | "text"): Promise<void> {
  copyError.value = null;
  copied.value = null;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = kind;
    window.setTimeout(() => {
      if (copied.value === kind) copied.value = null;
    }, 2000);
  } catch {
    copyError.value = "Не вдалося скопіювати";
  }
}

function copyCode(): Promise<void> {
  return copyText(props.joinCode, "code");
}

function copyLink(): Promise<void> {
  return copyText(buildInviteLink(origin, props.joinCode), "link");
}

function copyMessage(): Promise<void> {
  return copyText(
    buildInviteMessage({
      displayName: props.displayName,
      joinCode: props.joinCode,
      origin,
      scheduledAt: props.scheduledAt,
    }),
    "text",
  );
}
</script>

<template>
  <div class="copy-actions">
    <button type="button" class="btn-secondary" @click="copyCode">Скопіювати код</button>
    <button type="button" class="btn-secondary" @click="copyLink">Скопіювати посилання</button>
    <button type="button" class="btn-secondary" @click="copyMessage">
      Скопіювати текст запрошення
    </button>
    <p v-if="copied === 'code'" class="success">Код скопійовано</p>
    <p v-else-if="copied === 'link'" class="success">Посилання скопійовано</p>
    <p v-else-if="copied === 'text'" class="success">Текст скопійовано</p>
    <p v-if="copyError" class="fail">{{ copyError }}</p>
  </div>
</template>

<style scoped>
.copy-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.75rem 0;
}
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid #d1d5db;
  background: #f3f4f6;
  color: #374151;
  cursor: pointer;
}
.success {
  margin: 0;
  color: #059669;
  font-size: 0.8125rem;
  text-align: center;
}
.fail {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
  text-align: center;
}
</style>

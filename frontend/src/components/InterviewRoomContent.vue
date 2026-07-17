<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import LiveChatPanel from "./LiveChatPanel.vue";
import AgentStatusPanel from "./AgentStatusPanel.vue";
import { endInterview } from "../api/interviews";
import { useInterviewRoom } from "../composables/useInterviewRoom";

const props = defineProps<{
  interviewId: string;
  currentRole: "HR" | "CANDIDATE";
  joinCode?: string | null;
  reportId?: string | null;
}>();

const {
  messages,
  connectionState,
  errorMessage,
  sendMessage,
  isReadOnly,
  agentThinking,
  interviewStatus,
  agentError,
  arbiterProcessLog,
} = useInterviewRoom(props.interviewId, props.currentRole);

const ending = ref(false);
const endSuccess = ref<string | null>(null);
const endError = ref<string | null>(null);
const endedReportId = ref<string | null>(null);

const showEndButton = computed(
  () => props.currentRole === "HR" && interviewStatus.value === "LIVE",
);

const activeReportId = computed(
  () => endedReportId.value ?? props.reportId ?? null,
);
const showReportLink = computed(
  () => activeReportId.value !== null && interviewStatus.value === "ENDED",
);

const phaseBanner = computed(() => {
  const status = interviewStatus.value;
  if (!status || status === "LIVE") return null;
  if (status === "ENDED") return "Співбесіда завершена";
  if (status === "AWAITING_CANDIDATE" && props.currentRole === "HR") {
    return props.joinCode
      ? `Очікуємо кандидата. Код: ${props.joinCode}`
      : "Очікуємо кандидата";
  }
  if (status === "READY") {
    return "Обидва готові. Очікуємо другого учасника в кімнаті";
  }
  return null;
});

async function onEndInterview(): Promise<void> {
  if (!window.confirm("Завершити співбесіду? Буде згенеровано фінальний звіт.")) return;
  ending.value = true;
  endError.value = null;
  endSuccess.value = null;
  try {
    const result = await endInterview(props.interviewId);
    endedReportId.value = result.reportId;
    endSuccess.value = `Звіт згенеровано. Рекомендація: ${result.recommendation}`;
  } catch (error) {
    endError.value = error instanceof Error ? error.message : "Не вдалося завершити співбесіду";
  } finally {
    ending.value = false;
  }
}
</script>

<template>
  <div v-if="showEndButton" class="room-toolbar">
    <button
      type="button"
      class="btn-danger"
      :disabled="ending"
      @click="onEndInterview"
    >
      {{ ending ? "Завершення…" : "Завершити співбесіду" }}
    </button>
  </div>
  <p v-if="endSuccess" class="success-banner">{{ endSuccess }}</p>
  <RouterLink
    v-if="showReportLink && activeReportId"
    :to="{ name: 'report', params: { id: activeReportId } }"
    class="report-link"
  >
    Переглянути звіт →
  </RouterLink>
  <p v-if="endError" class="error-banner">{{ endError }}</p>
  <p v-if="phaseBanner" class="phase-banner">{{ phaseBanner }}</p>
  <p v-if="agentError" class="agent-error-banner" role="alert">{{ agentError }}</p>
  <div class="room-body" :class="{ 'room-body--with-sidebar': currentRole === 'HR' }">
    <LiveChatPanel
      :messages="messages"
      :current-role="currentRole"
      :connection-state="connectionState"
      :disabled="isReadOnly"
      :error-message="errorMessage"
      :agent-thinking="agentThinking"
      @send="sendMessage"
    />
    <AgentStatusPanel
      v-if="currentRole === 'HR'"
      :agent-thinking="agentThinking"
      :process-log="arbiterProcessLog"
    />
  </div>
</template>

<style scoped>
.room-body--with-sidebar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 18rem);
  gap: 1rem;
  align-items: start;
}
@media (max-width: 48rem) {
  .room-body--with-sidebar {
    grid-template-columns: 1fr;
  }
}
.room-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}
.btn-danger {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid #fca5a5;
  background: var(--surface);
  color: var(--danger);
  cursor: pointer;
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.success-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  background: var(--accent-soft);
  color: #065f46;
  border-radius: 6px;
  font-size: 0.875rem;
}
.report-link {
  display: inline-block;
  margin-bottom: 0.75rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
}
.report-link:hover {
  text-decoration: underline;
}
.error-banner {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: 6px;
  font-size: 0.875rem;
}
.phase-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  background: var(--warning-soft);
  color: var(--warning);
  border-radius: 6px;
  font-size: 0.875rem;
}
.agent-error-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: 6px;
  font-size: 0.875rem;
}
</style>

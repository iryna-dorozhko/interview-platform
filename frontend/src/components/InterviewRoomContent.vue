<script setup lang="ts">
import { computed } from "vue";
import LiveChatPanel from "./LiveChatPanel.vue";
import { useInterviewRoom } from "../composables/useInterviewRoom";

const props = defineProps<{
  interviewId: string;
  currentRole: "HR" | "CANDIDATE";
  joinCode?: string | null;
}>();

const {
  messages,
  connectionState,
  errorMessage,
  sendMessage,
  isReadOnly,
  agentThinking,
  interviewStatus,
} = useInterviewRoom(props.interviewId, props.currentRole);

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
</script>

<template>
  <p v-if="phaseBanner" class="phase-banner">{{ phaseBanner }}</p>
  <LiveChatPanel
    :messages="messages"
    :current-role="currentRole"
    :connection-state="connectionState"
    :disabled="isReadOnly"
    :error-message="errorMessage"
    :agent-thinking="agentThinking"
    @send="sendMessage"
  />
</template>

<style scoped>
.phase-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  background: #fef3c7;
  color: #92400e;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
</style>

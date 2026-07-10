<script setup lang="ts">
import LiveChatPanel from "./LiveChatPanel.vue";
import { useInterviewRoom } from "../composables/useInterviewRoom";

const props = defineProps<{
  interviewId: string;
  currentRole: "HR" | "CANDIDATE";
}>();

const {
  messages,
  connectionState,
  errorMessage,
  sendMessage,
  isReadOnly,
} = useInterviewRoom(props.interviewId, props.currentRole);
</script>

<template>
  <LiveChatPanel
    :messages="messages"
    :current-role="currentRole"
    :connection-state="connectionState"
    :disabled="isReadOnly"
    :error-message="errorMessage"
    @send="sendMessage"
  />
</template>

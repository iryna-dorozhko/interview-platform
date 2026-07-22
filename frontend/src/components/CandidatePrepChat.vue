<script setup lang="ts">
import { onMounted } from "vue";
import {
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  finishCandidatePrepChat,
  sendCandidatePrepMessage,
  type CandidateProfile,
} from "../api/candidate-prep";
import { usePrepChat } from "../composables/usePrepChat";
import PrepChatPanel from "./PrepChatPanel.vue";

const props = defineProps<{ interviewId: string }>();
const emit = defineEmits<{ finished: []; deleted: [] }>();

const chat = usePrepChat<CandidateProfile>({
  adapters: {
    loadState: async () => {
      const state = await fetchCandidatePrepState(props.interviewId);
      return {
        messages: state.messages,
        isClosed: state.isClosed,
        profile: state.profile,
      };
    },
    sendMessage: (text) => sendCandidatePrepMessage(props.interviewId, text),
    finishChat: async () => {
      await finishCandidatePrepChat(props.interviewId);
    },
    deleteChat: () => deleteCandidatePrepChat(props.interviewId),
    isUserMessage: (msg) => msg.authorType === "HUMAN_CANDIDATE",
    humanAuthorType: "HUMAN_CANDIDATE",
    agentAuthorType: "AGENT_CANDIDATE",
  },
  onAfterLoad: (state) => {
    if (state.isClosed) {
      emit("finished");
    }
  },
  onFinished: () => emit("finished"),
  onDeleted: () => emit("deleted"),
});

const {
  loadState,
  messages,
  sending,
  isClosed,
  input,
  errorMessage,
  lastFailedAction,
  profile,
  messagesEl,
  load,
  send,
  retry,
  finish,
  deleteChat,
  onKeydown,
  isUserMessage,
} = chat;

function setMessagesEl(el: HTMLElement | null): void {
  messagesEl.value = el;
}

function setInput(value: string): void {
  input.value = value;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PrepChatPanel
    title="Чат з Candidate Agent"
    :load-state="loadState"
    :messages="messages"
    :sending="sending"
    :is-closed="isClosed"
    :input="input"
    :error-message="errorMessage"
    :last-failed-action="lastFailedAction"
    :is-user-message="isUserMessage"
    :delete-disabled="!!profile?.confirmedAt"
    :delete-title="profile?.confirmedAt ? 'Підтверджений профіль не можна видалити' : ''"
    :set-messages-el="setMessagesEl"
    @update:input="setInput"
    @send="send"
    @retry="retry"
    @finish="finish"
    @delete="deleteChat"
    @keydown="onKeydown"
  />
</template>

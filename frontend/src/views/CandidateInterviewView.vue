<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchCandidatePrepState } from "../api/candidate-prep";
import {
  fetchCandidateInterview,
  fetchCandidateQuestionnaire,
  type CandidateInterview,
} from "../api/candidate-interview";
import JoinInterviewModal from "../components/JoinInterviewModal.vue";

type LoadState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Обидва готові",
  LIVE: "В ефірі",
};

const router = useRouter();
const interview = ref<CandidateInterview | null>(null);
const loadState = ref<LoadState>("loading");
const errorMessage = ref<string | null>(null);
const showJoinModal = ref(false);
const canJoinMeeting = ref(false);

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

async function loadInterview(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    interview.value = await fetchCandidateInterview();
    const questionnaire = await fetchCandidateQuestionnaire();
    if (questionnaire) {
      const prep = await fetchCandidatePrepState(questionnaire.id);
      canJoinMeeting.value = prep.profile?.confirmedAt != null;
    } else {
      canJoinMeeting.value = false;
    }
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
}

function onJoined(joined: CandidateInterview): void {
  interview.value = joined;
  showJoinModal.value = false;
}

onMounted(loadInterview);
</script>

<template>
  <div class="page">
    <h2 class="page-title">Співбесіда</h2>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else-if="interview">
      <h1>{{ interview.displayName }}</h1>
      <p class="meta">Статус: <strong>{{ statusLabel(interview.status) }}</strong></p>
      <button
        v-if="interview.status === 'READY' || interview.status === 'LIVE'"
        type="button"
        class="btn-primary"
        @click="router.push({ name: 'candidate-interview-room' })"
      >
        Увійти в співбесіду
      </button>
      <p v-else class="muted">
        Очікуємо підтвердження профілів від обох сторін.
      </p>
    </template>

    <template v-else>
      <p class="empty">Введіть код співбесіди від HR, щоб приєднатися</p>
      <p v-if="!canJoinMeeting" class="muted">
        Спочатку створіть і підтвердіть анкету в розділі «Моя анкета».
      </p>
      <button
        type="button"
        class="btn-primary"
        :disabled="!canJoinMeeting"
        @click="showJoinModal = true"
      >
        Приєднатися до зустрічі
      </button>
    </template>

    <JoinInterviewModal :open="showJoinModal" @close="showJoinModal = false" @joined="onJoined" />
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
h1 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
}
.meta {
  margin: 0 0 1rem;
  color: #555;
  font-size: 0.875rem;
}
.muted {
  margin: 0;
  color: #6b7280;
  font-size: 0.875rem;
}
.empty {
  margin: 0 0 1rem;
  color: #555;
}
.error-banner {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: var(--danger);
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.btn-primary {
  display: inline-block;
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  text-decoration: none;
  border: 1px solid transparent;
  cursor: pointer;
  background: var(--accent);
  color: #fff;
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>

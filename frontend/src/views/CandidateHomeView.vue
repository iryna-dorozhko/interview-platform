<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchCandidatePrepState, type CandidatePrepState } from "../api/candidate-prep";
import { fetchCandidateInterview, fetchCandidateQuestionnaire, type CandidateInterview } from "../api/candidate-interview";
import JoinInterviewModal from "../components/JoinInterviewModal.vue";

type LoadState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Обидва готові",
  LIVE: "В ефірі",
};

function profileStatusLabel(
  questionnaireInterview: CandidateInterview | null,
  prep: CandidatePrepState | null,
): string {
  if (!questionnaireInterview) return "—";
  if (!prep || prep.messages.length === 0) return "Не створена";
  if (!prep.isClosed) return "В процесі";
  if (!prep.profile?.confirmedAt) return "Очікує підтвердження";
  return "Підтверджена";
}

function interviewStatusLabel(interview: CandidateInterview | null): string {
  if (!interview) return "—";
  return STATUS_LABELS[interview.status] ?? interview.status;
}

const router = useRouter();

const interview = ref<CandidateInterview | null>(null);
const questionnaire = ref<CandidateInterview | null>(null);
const prepState = ref<CandidatePrepState | null>(null);
const loadState = ref<LoadState>("loading");
const loadError = ref<string | null>(null);
const showJoinModal = ref(false);
const joinedBanner = ref<CandidateInterview | null>(null);

const interviewCount = computed(() => (interview.value ? 1 : 0));
const profileStatus = computed(() => profileStatusLabel(questionnaire.value, prepState.value));
const meetingStatus = computed(() => interviewStatusLabel(interview.value));
const canJoinMeeting = computed(
  () => interview.value === null && prepState.value?.profile?.confirmedAt != null,
);

async function loadDashboard(): Promise<void> {
  loadState.value = "loading";
  loadError.value = null;
  try {
    interview.value = await fetchCandidateInterview();
    questionnaire.value = await fetchCandidateQuestionnaire();
    if (questionnaire.value) {
      prepState.value = await fetchCandidatePrepState(questionnaire.value.id);
    } else {
      prepState.value = null;
    }
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value = error instanceof Error ? error.message : "Не вдалося завантажити дані";
  }
}

function onJoined(joined: CandidateInterview): void {
  interview.value = joined;
  showJoinModal.value = false;
  joinedBanner.value = joined;
  void loadDashboard();
}

function openProfile(): void {
  router.push({ name: "candidate-profile" });
}

onMounted(loadDashboard);
</script>

<template>
  <div class="home">
    <h2 class="page-title">Огляд</h2>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="fail">{{ loadError }}</p>

    <template v-else>
      <div class="overview-cards">
        <div class="card">
          <span class="card-value">{{ interviewCount }}</span>
          <span class="card-label">Співбесіда</span>
        </div>
        <div class="card">
          <span class="card-value card-value-text">{{ profileStatus }}</span>
          <span class="card-label">Статус анкети</span>
        </div>
        <div class="card">
          <span class="card-value card-value-text">{{ meetingStatus }}</span>
          <span class="card-label">Статус зустрічі</span>
        </div>
      </div>

      <div class="dashboard-actions">
        <button
          type="button"
          class="btn-primary"
          :disabled="!canJoinMeeting"
          :title="canJoinMeeting ? undefined : 'Спочатку створіть і підтвердіть анкету'"
          @click="showJoinModal = true"
        >
          Приєднатися до зустрічі
        </button>
        <button type="button" class="btn-primary" @click="openProfile">
          Заповнити анкету
        </button>
      </div>

      <div v-if="joinedBanner" class="joined-banner">
        <p>
          Ви приєдналися до співбесіди
          <strong>{{ joinedBanner.displayName }}</strong>
        </p>
      </div>
    </template>

    <JoinInterviewModal
      :open="showJoinModal"
      @close="showJoinModal = false"
      @joined="onJoined"
    />
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
.fail {
  color: var(--danger);
}
.overview-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}
.card-value {
  font-size: 1.75rem;
  font-weight: 600;
  color: #111827;
}
.card-value-text {
  font-size: 1rem;
  font-weight: 600;
}
.card-label {
  font-size: 0.875rem;
  color: #6b7280;
}
.dashboard-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.joined-banner {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
}
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
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

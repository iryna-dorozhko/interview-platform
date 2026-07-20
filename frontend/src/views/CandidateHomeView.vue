<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchCandidatePrepState, type CandidatePrepState } from "../api/candidate-prep";
import { fetchCandidateInterview, fetchCandidateQuestionnaire, type CandidateInterview } from "../api/candidate-interview";
import {
  acceptInvitation,
  declineInvitation,
  fetchMyInvitations,
  type CandidateInvitation,
} from "../api/candidate-invitations";
import JoinInterviewModal from "../components/JoinInterviewModal.vue";
import { consumeJoinedBanner } from "../utils/join-banner";
import { formatScheduledAtUk } from "../utils/invite-message";

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

function scheduledLabel(iso: string | null): string | null {
  return formatScheduledAtUk(iso);
}

const router = useRouter();

const interview = ref<CandidateInterview | null>(null);
const questionnaire = ref<CandidateInterview | null>(null);
const prepState = ref<CandidatePrepState | null>(null);
const invitations = ref<CandidateInvitation[]>([]);
const loadState = ref<LoadState>("loading");
const loadError = ref<string | null>(null);
const showJoinModal = ref(false);
const joinedBanner = ref<CandidateInterview | null>(null);
const acceptingId = ref<string | null>(null);
const decliningId = ref<string | null>(null);
const invitationActionError = ref<string | null>(null);

const interviewCount = computed(() => (interview.value ? 1 : 0));
const profileStatus = computed(() => profileStatusLabel(questionnaire.value, prepState.value));
const meetingStatus = computed(() => interviewStatusLabel(interview.value));
const canJoinMeeting = computed(
  () => interview.value === null && prepState.value?.profile?.confirmedAt != null,
);
const canMatchVacancies = computed(() => prepState.value?.profile?.confirmedAt != null);
const invitationActionBusy = computed(
  () => acceptingId.value !== null || decliningId.value !== null,
);

async function loadDashboard(): Promise<void> {
  loadState.value = "loading";
  loadError.value = null;
  try {
    const [interviewData, questionnaireData, invitationsData] = await Promise.all([
      fetchCandidateInterview(),
      fetchCandidateQuestionnaire(),
      fetchMyInvitations(),
    ]);
    interview.value = interviewData;
    questionnaire.value = questionnaireData;
    invitations.value = invitationsData;
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

async function onAccept(invitation: CandidateInvitation): Promise<void> {
  invitationActionError.value = null;
  acceptingId.value = invitation.id;
  try {
    const joined = await acceptInvitation(invitation.id);
    onJoined(joined);
  } catch (error) {
    invitationActionError.value =
      error instanceof Error ? error.message : "Не вдалося прийняти запрошення";
  } finally {
    acceptingId.value = null;
  }
}

async function onDecline(invitation: CandidateInvitation): Promise<void> {
  invitationActionError.value = null;
  decliningId.value = invitation.id;
  try {
    await declineInvitation(invitation.id);
    invitations.value = await fetchMyInvitations();
  } catch (error) {
    invitationActionError.value =
      error instanceof Error ? error.message : "Не вдалося відхилити запрошення";
  } finally {
    decliningId.value = null;
  }
}

function openProfile(): void {
  router.push({ name: "candidate-profile" });
}

function openMatches(): void {
  router.push({ name: "candidate-matches" });
}

function restoreJoinedBanner(): void {
  const stored = consumeJoinedBanner();
  if (stored) joinedBanner.value = stored;
}

onMounted(() => {
  restoreJoinedBanner();
  void loadDashboard();
});
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
        <button
          v-if="canMatchVacancies"
          type="button"
          class="btn-primary"
          @click="openMatches"
        >
          Підібрати вакансію
        </button>
      </div>

      <section v-if="invitations.length > 0" class="invitations-section">
        <h3 class="section-title">Запрошення</h3>
        <p v-if="invitationActionError" class="fail" role="alert">{{ invitationActionError }}</p>
        <ul class="invitation-list">
          <li v-for="invitation in invitations" :key="invitation.id" class="card invitation-card">
            <div class="invitation-info">
              <strong class="invitation-name">{{ invitation.displayName }}</strong>
              <span v-if="scheduledLabel(invitation.scheduledAt)" class="invitation-time">
                {{ scheduledLabel(invitation.scheduledAt) }}
              </span>
            </div>
            <div class="invitation-actions">
              <button
                type="button"
                class="btn-secondary"
                :disabled="invitationActionBusy"
                @click="onDecline(invitation)"
              >
                {{ decliningId === invitation.id ? "Відхилення…" : "Відхилити" }}
              </button>
              <button
                type="button"
                class="btn-primary"
                :disabled="invitationActionBusy"
                @click="onAccept(invitation)"
              >
                {{ acceptingId === invitation.id ? "Прийняття…" : "Прийняти" }}
              </button>
            </div>
          </li>
        </ul>
      </section>

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
  margin: 0 0 1.25rem;
  font-size: 1.375rem;
}
.fail {
  color: var(--danger);
}
.overview-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1.25rem;
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
.invitations-section {
  margin-bottom: 1rem;
}
.section-title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: #111827;
}
.invitation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.invitation-card {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.invitation-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}
.invitation-name {
  font-size: 0.9375rem;
  color: #111827;
}
.invitation-time {
  font-size: 0.875rem;
  color: #6b7280;
}
.invitation-actions {
  display: flex;
  flex-shrink: 0;
  gap: 0.5rem;
}
.joined-banner {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
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
  background: #f3f4f6;
  color: #374151;
  border-color: #d1d5db;
}
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

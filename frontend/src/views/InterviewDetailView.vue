<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import InviteCopyActions from "../components/InviteCopyActions.vue";
import {
  fetchInterview,
  updateInterviewInvitation,
  updateInterviewSchedule,
  type InterviewDetail,
} from "../api/interviews";
import { formatScheduledAtUk } from "../utils/invite-message";

const route = useRoute();
const interviewId = computed(() => String(route.params.id));

const interview = ref<InterviewDetail | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);
const actionError = ref<string | null>(null);

const scheduledAtLocal = ref("");
const scheduleSaving = ref(false);

const candidateEmail = ref("");
const invitationSaving = ref(false);
const replacingInvitation = ref(false);

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Обидва готові",
  LIVE: "В ефірі",
  ENDED: "Завершена",
};

const canManageInvitation = computed(
  () =>
    !interview.value?.candidateLinked &&
    (interview.value?.status === "AWAITING_CANDIDATE" || interview.value?.status === "READY"),
);

const formattedScheduledAt = computed(() =>
  interview.value ? formatScheduledAtUk(interview.value.scheduledAt) : null,
);

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function syncFormFromInterview(data: InterviewDetail): void {
  scheduledAtLocal.value = toDatetimeLocal(data.scheduledAt);
  candidateEmail.value = data.invitation?.email ?? "";
  replacingInvitation.value = false;
}

async function loadInterview(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    const data = await fetchInterview(interviewId.value);
    interview.value = data;
    syncFormFromInterview(data);
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
}

async function onSaveSchedule(): Promise<void> {
  if (!interview.value) return;

  actionError.value = null;
  scheduleSaving.value = true;
  try {
    const scheduledAt = scheduledAtLocal.value
      ? new Date(scheduledAtLocal.value).toISOString()
      : null;
    interview.value = await updateInterviewSchedule(interview.value.id, scheduledAt);
    syncFormFromInterview(interview.value);
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося оновити час співбесіди";
  } finally {
    scheduleSaving.value = false;
  }
}

async function onSaveInvitation(): Promise<void> {
  if (!interview.value) return;

  const email = candidateEmail.value.trim();
  if (!email) {
    actionError.value = "Введіть email кандидата";
    return;
  }

  actionError.value = null;
  invitationSaving.value = true;
  try {
    const { invitation } = await updateInterviewInvitation(interview.value.id, email);
    interview.value = { ...interview.value, invitation };
    syncFormFromInterview(interview.value);
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося оновити запрошення";
  } finally {
    invitationSaving.value = false;
  }
}

async function onCancelInvitation(): Promise<void> {
  if (!interview.value) return;
  if (!window.confirm("Скасувати запрошення для цього кандидата?")) return;

  actionError.value = null;
  invitationSaving.value = true;
  try {
    const { invitation } = await updateInterviewInvitation(interview.value.id, null);
    interview.value = { ...interview.value, invitation };
    syncFormFromInterview(interview.value);
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося скасувати запрошення";
  } finally {
    invitationSaving.value = false;
  }
}

function onStartReplaceInvitation(): void {
  replacingInvitation.value = true;
  candidateEmail.value = "";
}

function onCancelReplaceInvitation(): void {
  replacingInvitation.value = false;
  candidateEmail.value = interview.value?.invitation?.email ?? "";
}

watch(interviewId, loadInterview);
onMounted(loadInterview);
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink to="/interviews" class="back-link">← До списку співбесід</RouterLink>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else-if="interview">
      <h1>{{ interview.displayName }}</h1>
      <p class="meta">
        Код: <strong class="join-code">{{ interview.joinCode }}</strong>
        · Статус: <strong>{{ statusLabel(interview.status) }}</strong>
      </p>

      <p v-if="actionError" class="error-banner" role="alert">{{ actionError }}</p>

      <section class="section">
        <h2>Запрошення для кандидата</h2>
        <InviteCopyActions
          :join-code="interview.joinCode"
          :display-name="interview.displayName"
          :scheduled-at="interview.scheduledAt"
        />
      </section>

      <section class="section">
        <h2>Запланований час</h2>
        <p v-if="formattedScheduledAt" class="hint">Поточний час: {{ formattedScheduledAt }}</p>
        <p v-else class="hint muted">Час не вказано</p>
        <label class="field">
          <span>Новий час</span>
          <input
            v-model="scheduledAtLocal"
            type="datetime-local"
            :disabled="scheduleSaving"
          />
        </label>
        <div class="actions">
          <button
            type="button"
            class="btn-secondary"
            :disabled="scheduleSaving"
            @click="scheduledAtLocal = ''"
          >
            Очистити
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="scheduleSaving"
            @click="onSaveSchedule"
          >
            {{ scheduleSaving ? "Збереження…" : "Зберегти" }}
          </button>
        </div>
      </section>

      <section v-if="interview.candidateLinked" class="section">
        <h2>Кандидат</h2>
        <p class="hint">
          Кандидат уже привʼязаний до співбесіди (наприклад, з заявки). Email-запрошення не
          потрібне — він побачить зустріч у своєму кабінеті.
        </p>
      </section>

      <section v-if="canManageInvitation" class="section">
        <h2>Email-запрошення</h2>

        <template v-if="interview.invitation && !replacingInvitation">
          <p class="invitation-pending">
            Запрошення: <strong>{{ interview.invitation.email }}</strong> · очікує
          </p>
          <div class="actions">
            <button
              type="button"
              class="btn-secondary"
              :disabled="invitationSaving"
              @click="onStartReplaceInvitation"
            >
              Замінити
            </button>
            <button
              type="button"
              class="btn-danger"
              :disabled="invitationSaving"
              @click="onCancelInvitation"
            >
              {{ invitationSaving ? "Скасування…" : "Скасувати" }}
            </button>
          </div>
        </template>

        <template v-else>
          <label class="field">
            <span>Email кандидата</span>
            <input
              v-model="candidateEmail"
              type="email"
              autocomplete="off"
              :disabled="invitationSaving"
            />
          </label>
          <div class="actions">
            <button
              v-if="interview.invitation && replacingInvitation"
              type="button"
              class="btn-secondary"
              :disabled="invitationSaving"
              @click="onCancelReplaceInvitation"
            >
              Назад
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="invitationSaving"
              @click="onSaveInvitation"
            >
              {{ invitationSaving ? "Збереження…" : "Надіслати запрошення" }}
            </button>
          </div>
        </template>
      </section>

      <section v-if="interview.reportId" class="report-section">
        <h2>Фінальний звіт</h2>
        <p>
          Рекомендація:
          <strong>{{ interview.reportSummary }}</strong>
        </p>
        <RouterLink :to="{ name: 'report', params: { id: interview.reportId } }">
          Переглянути повний звіт →
        </RouterLink>
      </section>

      <section v-if="interview.status === 'ENDED'" class="report-section">
        <h2>Спільний чат</h2>
        <RouterLink :to="{ name: 'interview-room', params: { id: interview.id } }">
          Переглянути спільний чат
        </RouterLink>
      </section>

      <p v-if="interview.status === 'READY'" class="muted">
        Обидва профілі підтверджені. Спільна співбесіда буде доступна пізніше.
      </p>
      <p v-else-if="interview.status !== 'ENDED'" class="muted">
        Очікуємо підтвердження профілів від обох сторін.
      </p>
    </template>
  </main>
</template>

<style scoped>
.page {
  width: 100%;
  min-width: 0;
}
.header {
  margin-bottom: 1rem;
}
.back-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover {
  text-decoration: underline;
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
.section {
  margin: 0 0 1.5rem;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
}
.section h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}
.hint {
  margin: 0 0 0.75rem;
  color: #555;
  font-size: 0.875rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
  margin-bottom: 0.75rem;
}
.field input {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background: #fff;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.invitation-pending {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: #374151;
}
.report-section {
  margin: 0 0 1.5rem;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
}
.report-section h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}
.report-section p {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
}
.report-section a {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
}
.report-section a:hover {
  text-decoration: underline;
}
.join-code {
  font-family: monospace;
  letter-spacing: 0.05em;
}
.muted {
  margin: 0;
  color: #6b7280;
  font-size: 0.875rem;
}
.error-banner {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: var(--danger);
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.btn-primary,
.btn-secondary,
.btn-danger {
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
.btn-primary:disabled,
.btn-secondary:disabled,
.btn-danger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-secondary {
  background: #f3f4f6;
  color: #374151;
  border-color: #d1d5db;
}
.btn-danger {
  background: #fff;
  color: var(--danger);
  border-color: #fca5a5;
}
</style>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import CreateInterviewModal from "../components/CreateInterviewModal.vue";
import {
  deleteInterview,
  fetchMyInterviews,
  type CreatedInterview,
  type InterviewSummary,
} from "../api/interviews";

type ListState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Обидва готові",
  LIVE: "В ефірі",
  ENDED: "Завершена",
};

const router = useRouter();

const interviews = ref<InterviewSummary[]>([]);
const listState = ref<ListState>("loading");
const listError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const showCreateModal = ref(false);

async function loadInterviews(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    interviews.value = await fetchMyInterviews();
    listState.value = "ready";
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити список співбесід";
  }
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

function reportLabel(reportSummary: string | null): string {
  return reportSummary ?? "—";
}

function badgeClass(reportSummary: string): string {
  if (reportSummary === "HIRE") return "badge-hire";
  if (reportSummary === "MAYBE") return "badge-maybe";
  if (reportSummary === "REJECT") return "badge-reject";
  return "";
}

function goToRoom(id: string): void {
  router.push({ name: "interview-room", params: { id } });
}

function onInterviewCreated(interview: CreatedInterview): void {
  showCreateModal.value = false;
  interviews.value.unshift({
    id: interview.id,
    vacancyId: interview.vacancyId,
    vacancyTitle: "",
    displayName: interview.displayName,
    joinCode: interview.joinCode,
    status: interview.status,
    createdAt: interview.createdAt,
    scheduledAt: interview.scheduledAt,
    invitation: interview.invitation,
    candidateLinked: false,
    reportId: null,
    reportSummary: null,
  });
}

async function onDelete(id: string): Promise<void> {
  actionError.value = null;
  if (!window.confirm("Видалити співбесіду? Цю дію не можна скасувати.")) return;

  try {
    await deleteInterview(id);
    interviews.value = interviews.value.filter((i) => i.id !== id);
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося видалити співбесіду";
  }
}

onMounted(loadInterviews);
</script>

<template>
  <div class="interview-list">
    <div class="list-header">
      <h1>Співбесіди</h1>
      <button type="button" class="btn-primary" @click="showCreateModal = true">
        Створити зустріч
      </button>
    </div>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="interviews.length === 0" class="muted">
      У вас ще немає співбесід. Створіть першу кнопкою «Створити зустріч».
    </p>
    <template v-else>
      <p v-if="actionError" class="fail" role="alert">{{ actionError }}</p>
      <table class="interviews-table">
        <thead>
          <tr>
            <th>Назва</th>
            <th>Звіт</th>
            <th>Дата</th>
            <th>Статус</th>
            <th>Дії</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="interview in interviews" :key="interview.id">
            <td>
              <button type="button" class="name-link" @click="goToRoom(interview.id)">
                {{ interview.displayName }}
              </button>
            </td>
            <td>
              <RouterLink
                v-if="interview.reportId"
                :to="{ name: 'report', params: { id: interview.reportId } }"
                class="report-badge"
                :class="badgeClass(interview.reportSummary ?? '')"
              >
                {{ reportLabel(interview.reportSummary) }}
              </RouterLink>
              <span v-else>—</span>
            </td>
            <td>{{ formatDate(interview.createdAt) }}</td>
            <td>{{ statusLabel(interview.status) }}</td>
            <td class="actions-cell">
              <button
                v-if="interview.status === 'READY' || interview.status === 'LIVE'"
                type="button"
                class="btn-primary"
                @click="goToRoom(interview.id)"
              >
                Увійти в співбесіду
              </button>
              <button type="button" class="btn-danger" @click="onDelete(interview.id)">
                Видалити
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <CreateInterviewModal
      :open="showCreateModal"
      @close="showCreateModal = false"
      @created="onInterviewCreated"
    />
  </div>
</template>

<style scoped>
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.interview-list h1 {
  margin: 0;
  font-size: 1.25rem;
}
.muted {
  color: #6b7280;
}
.fail {
  color: var(--danger);
}
.interviews-table {
  width: 100%;
  border-collapse: collapse;
}
.interviews-table th,
.interviews-table td {
  text-align: left;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid #eee;
  vertical-align: middle;
}
.interviews-table th {
  font-size: 0.8rem;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.name-link {
  font-family: inherit;
  font-size: inherit;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  text-align: left;
}
.name-link:hover {
  text-decoration: underline;
}
.actions-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.btn-primary,
.btn-danger {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-danger {
  background: #fff;
  color: var(--danger);
  border-color: #fca5a5;
}
.report-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}
.report-badge.badge-hire { background: #dcfce7; color: #16a34a; }
.report-badge.badge-maybe { background: #fef9c3; color: #ca8a04; }
.report-badge.badge-reject { background: #fee2e2; color: #dc2626; }
</style>

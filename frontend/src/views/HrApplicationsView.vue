<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  createInterviewFromApplication,
  fetchHrApplication,
  fetchHrApplications,
  fetchHrNotifications,
  markNotificationRead,
  type HrApplicationDetail,
} from "../api/hr-applications";

type ListState = "loading" | "ready" | "error";
type DetailState = "idle" | "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Очікує",
  CONVERTED: "Створено співбесіду",
  WITHDRAWN: "Відкликано",
  DECLINED_BY_HR: "Відхилено HR",
};

const router = useRouter();

const applications = ref<HrApplicationDetail[]>([]);
const listState = ref<ListState>("loading");
const listError = ref<string | null>(null);

const selectedId = ref<string | null>(null);
const detail = ref<HrApplicationDetail | null>(null);
const detailState = ref<DetailState>("idle");
const detailError = ref<string | null>(null);

const scheduledAtLocal = ref("");
const creating = ref(false);
const createError = ref<string | null>(null);
const createdJoinCode = ref<string | null>(null);

const canCreateInterview = computed(
  () => detail.value?.status === "PENDING" && !creating.value,
);

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

function candidateName(app: HrApplicationDetail): string {
  return app.candidate.fullName?.trim() || "—";
}

function candidateEmail(app: HrApplicationDetail): string {
  return app.candidate.email?.trim() || "—";
}

async function loadList(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    const summaries = await fetchHrApplications();
    applications.value = await Promise.all(
      summaries.map((item) => fetchHrApplication(item.id)),
    );
    listState.value = "ready";
    if (applications.value.length > 0 && !selectedId.value) {
      selectedId.value = applications.value[0].id;
    } else if (selectedId.value) {
      const stillExists = applications.value.some((item) => item.id === selectedId.value);
      if (!stillExists) {
        selectedId.value = applications.value[0]?.id ?? null;
      } else {
        void loadDetail(selectedId.value);
      }
    }
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити заявки";
  }
}

async function loadDetail(id: string): Promise<void> {
  const cached = applications.value.find((item) => item.id === id) ?? null;
  if (cached) {
    detail.value = cached;
    detailState.value = "ready";
    createError.value = null;
    createdJoinCode.value = null;
    scheduledAtLocal.value = "";
    return;
  }

  detailState.value = "loading";
  detailError.value = null;
  detail.value = null;
  createError.value = null;
  createdJoinCode.value = null;
  scheduledAtLocal.value = "";

  try {
    detail.value = await fetchHrApplication(id);
    detailState.value = "ready";
  } catch (error) {
    detailState.value = "error";
    detailError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити заявку";
  }
}

function selectApplication(id: string): void {
  if (selectedId.value === id) return;
  selectedId.value = id;
}

async function onCreateInterview(): Promise<void> {
  if (!detail.value || detail.value.status !== "PENDING" || creating.value) return;

  creating.value = true;
  createError.value = null;
  createdJoinCode.value = null;
  try {
    const scheduledAt = scheduledAtLocal.value
      ? new Date(scheduledAtLocal.value).toISOString()
      : null;
    const result = await createInterviewFromApplication(detail.value.id, { scheduledAt });
    createdJoinCode.value = result.interview.joinCode;
    const updated: HrApplicationDetail = {
      ...detail.value,
      status: result.application.status,
      interviewId: result.application.interviewId,
    };
    detail.value = updated;
    applications.value = applications.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
  } catch (error) {
    createError.value =
      error instanceof Error ? error.message : "Не вдалося створити співбесіду";
  } finally {
    creating.value = false;
  }
}

function goToInterview(): void {
  if (!detail.value?.interviewId) return;
  router.push({ name: "interview-detail", params: { id: detail.value.interviewId } });
}

async function markUnreadNotifications(): Promise<void> {
  try {
    const notifications = await fetchHrNotifications();
    const unread = notifications.filter((item) => item.readAt == null);
    if (unread.length === 0) return;
    await Promise.all(unread.map((item) => markNotificationRead(item.id)));
  } catch {
    // Non-fatal: inbox still works if mark-read fails.
  }
}

watch(selectedId, (id) => {
  if (id) void loadDetail(id);
  else {
    detailState.value = "idle";
    detail.value = null;
  }
});

onMounted(() => {
  void loadList();
  void markUnreadNotifications();
});
</script>

<template>
  <div class="applications">
    <h2 class="page-title">Заявки кандидатів</h2>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail" role="alert">{{ listError }}</p>
    <p v-else-if="applications.length === 0" class="muted">
      Поки немає заявок. Коли кандидат прийме пропозицію вакансії, вона зʼявиться тут.
    </p>

    <div v-else class="layout">
      <section class="list-panel">
        <table class="apps-table">
          <thead>
            <tr>
              <th>Кандидат</th>
              <th>Email</th>
              <th>Вакансія</th>
              <th>%</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="app in applications"
              :key="app.id"
              :class="{ selected: app.id === selectedId }"
              @click="selectApplication(app.id)"
            >
              <td>{{ candidateName(app) }}</td>
              <td>{{ candidateEmail(app) }}</td>
              <td>{{ app.vacancyTitle }}</td>
              <td>{{ app.matchScore }}%</td>
              <td>{{ statusLabel(app.status) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint">Натисніть рядок, щоб відкрити деталі.</p>
      </section>

      <section class="detail-panel">
        <p v-if="detailState === 'loading'">Завантаження деталей…</p>
        <p v-else-if="detailState === 'error'" class="fail" role="alert">{{ detailError }}</p>
        <template v-else-if="detailState === 'ready' && detail">
          <h3 class="detail-title">{{ detail.vacancyTitle }}</h3>
          <dl class="meta">
            <div>
              <dt>Імʼя</dt>
              <dd>{{ candidateName(detail) }}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{{ candidateEmail(detail) }}</dd>
            </div>
            <div>
              <dt>Відповідність</dt>
              <dd>{{ detail.matchScore }}%</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>{{ statusLabel(detail.status) }}</dd>
            </div>
            <div>
              <dt>Дата</dt>
              <dd>{{ formatDate(detail.createdAt) }}</dd>
            </div>
          </dl>

          <div class="summary-block">
            <h4>Коротко про кандидата</h4>
            <p class="summary-text">{{ detail.candidateSummary }}</p>
          </div>

          <form
            v-if="detail.status === 'PENDING'"
            class="create-form"
            @submit.prevent="onCreateInterview"
          >
            <label class="field">
              <span>Запланований час (необовʼязково)</span>
              <input
                v-model="scheduledAtLocal"
                type="datetime-local"
                :disabled="creating"
              />
            </label>
            <p v-if="createError" class="fail" role="alert">{{ createError }}</p>
            <button type="submit" class="btn-primary" :disabled="!canCreateInterview">
              {{ creating ? "Створення…" : "Створити співбесіду" }}
            </button>
          </form>

          <div v-else class="converted">
            <p v-if="createdJoinCode" class="join-code">Код: {{ createdJoinCode }}</p>
            <p v-else-if="detail.interviewId" class="muted">
              Співбесіду вже створено з цієї заявки.
            </p>
            <button
              v-if="detail.interviewId"
              type="button"
              class="btn-secondary"
              @click="goToInterview"
            >
              Відкрити співбесіду
            </button>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
.muted {
  color: #6b7280;
}
.fail {
  color: var(--danger);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.apps-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.apps-table th,
.apps-table td {
  text-align: left;
  padding: 0.55rem 0.4rem;
  border-bottom: 1px solid #eee;
  vertical-align: middle;
}
.apps-table th {
  font-size: 0.75rem;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.apps-table tbody tr {
  cursor: pointer;
}
.apps-table tbody tr:hover {
  background: #f9fafb;
}
.apps-table tbody tr.selected {
  background: var(--accent-soft);
}
.hint {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: #6b7280;
}
.detail-panel {
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}
.detail-title {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
}
.meta {
  display: grid;
  gap: 0.5rem;
  margin: 0 0 1rem;
}
.meta div {
  display: grid;
  grid-template-columns: 7rem 1fr;
  gap: 0.5rem;
  font-size: 0.875rem;
}
.meta dt {
  margin: 0;
  color: #6b7280;
}
.meta dd {
  margin: 0;
  font-weight: 500;
}
.summary-block h4 {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
}
.summary-text {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: #374151;
  white-space: pre-wrap;
}
.create-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.875rem;
}
.field input {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background: #fff;
}
.converted {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}
.join-code {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.1em;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  width: fit-content;
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
</style>

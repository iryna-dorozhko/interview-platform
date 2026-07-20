<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import CreateVacancyModal from "../components/CreateVacancyModal.vue";
import { fetchHrNotifications } from "../api/hr-applications";
import { fetchMyInterviews, type InterviewSummary } from "../api/interviews";
import { fetchMyVacancies, type VacancySummary } from "../api/vacancies";

type LoadState = "loading" | "ready" | "error";

type ActivityItem = {
  id: string;
  kind: "vacancy" | "interview";
  label: string;
  createdAt: string;
};

const router = useRouter();

const vacancies = ref<VacancySummary[]>([]);
const interviews = ref<InterviewSummary[]>([]);
const unreadNotifications = ref(0);
const loadState = ref<LoadState>("loading");
const loadError = ref<string | null>(null);

const showVacancyModal = ref(false);

const awaitingCandidateCount = computed(
  () => interviews.value.filter((i) => i.status === "AWAITING_CANDIDATE").length,
);

const recentActivity = computed<ActivityItem[]>(() => {
  const vacancyItems: ActivityItem[] = vacancies.value.map((v) => ({
    id: v.id,
    kind: "vacancy",
    label: v.title,
    createdAt: v.createdAt,
  }));
  const interviewItems: ActivityItem[] = interviews.value.map((i) => ({
    id: i.id,
    kind: "interview",
    label: i.displayName,
    createdAt: i.createdAt,
  }));

  return [...vacancyItems, ...interviewItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
});

async function loadDashboard(): Promise<void> {
  loadState.value = "loading";
  loadError.value = null;
  try {
    const [vacancyList, interviewList, notifications] = await Promise.all([
      fetchMyVacancies(),
      fetchMyInterviews(),
      fetchHrNotifications(),
    ]);
    vacancies.value = vacancyList;
    interviews.value = interviewList;
    unreadNotifications.value = notifications.filter((item) => item.readAt == null).length;
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити дані";
  }
}

function onVacancyCreated(vacancyId: string): void {
  showVacancyModal.value = false;
  router.push({ name: "vacancy-prep", params: { id: vacancyId } });
}

function activityTypeLabel(kind: ActivityItem["kind"]): string {
  return kind === "vacancy" ? "Анкета" : "Співбесіда";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
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
          <span class="card-value">{{ vacancies.length }}</span>
          <span class="card-label">Анкет</span>
        </div>
        <div class="card">
          <span class="card-value">{{ interviews.length }}</span>
          <span class="card-label">Співбесід</span>
        </div>
        <div class="card">
          <span class="card-value">{{ awaitingCandidateCount }}</span>
          <span class="card-label">Очікують кандидата</span>
        </div>
        <div class="card">
          <span class="card-value">{{ unreadNotifications }}</span>
          <span class="card-label">Нові заявки</span>
        </div>
      </div>

      <div class="dashboard-actions">
        <button type="button" class="btn-primary" @click="showVacancyModal = true">
          Створити нову анкету
        </button>
        <RouterLink class="btn-secondary-link" :to="{ name: 'hr-applications' }">
          Заявки кандидатів
          <span v-if="unreadNotifications > 0" class="badge">{{ unreadNotifications }}</span>
        </RouterLink>
      </div>

      <section v-if="recentActivity.length > 0" class="recent">
        <h3>Останні дії</h3>
        <ul class="activity-list">
          <li v-for="item in recentActivity" :key="`${item.kind}-${item.id}`" class="activity-item">
            <span class="activity-type">{{ activityTypeLabel(item.kind) }}</span>
            <span class="activity-label">{{ item.label }}</span>
            <span class="activity-date">{{ formatDate(item.createdAt) }}</span>
          </li>
        </ul>
      </section>
    </template>

    <CreateVacancyModal
      :open="showVacancyModal"
      @close="showVacancyModal = false"
      @created="onVacancyCreated"
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
.btn-secondary-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid #d1d5db;
  background: #f3f4f6;
  color: #374151;
  text-decoration: none;
}
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
}
.recent {
  margin-top: 1.5rem;
}
.recent h3 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}
.activity-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.activity-item {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: baseline;
  padding: 0.6rem 0;
  border-bottom: 1px solid #eee;
  font-size: 0.875rem;
}
.activity-type {
  color: #6b7280;
  min-width: 5.5rem;
}
.activity-label {
  flex: 1;
  font-weight: 500;
}
.activity-date {
  color: #6b7280;
}
</style>

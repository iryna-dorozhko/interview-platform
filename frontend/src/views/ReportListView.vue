<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  fetchReports,
  type ReportListFilters,
  type ReportSummary,
} from "../api/reports";
import { fetchMyVacancies, type VacancySummary } from "../api/vacancies";

type ListState = "loading" | "ready" | "error";

const RECOMMENDATION_LABELS: Record<string, string> = {
  HIRE: "Найняти",
  MAYBE: "Під питанням",
  REJECT: "Відхилити",
};

const reports = ref<ReportSummary[]>([]);
const vacancies = ref<VacancySummary[]>([]);
const listState = ref<ListState>("loading");
const listError = ref<string | null>(null);

const vacancyId = ref("");
const recommendation = ref("");
const email = ref("");
const dateFrom = ref("");
const dateTo = ref("");

const hasActiveFilters = computed(
  () =>
    Boolean(vacancyId.value) ||
    Boolean(recommendation.value) ||
    Boolean(email.value.trim()) ||
    Boolean(dateFrom.value) ||
    Boolean(dateTo.value),
);

function recommendationLabel(value: string): string {
  return RECOMMENDATION_LABELS[value] ?? value;
}

function badgeClass(value: string): string {
  if (value === "HIRE") return "badge-hire";
  if (value === "MAYBE") return "badge-maybe";
  if (value === "REJECT") return "badge-reject";
  return "";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

function currentFilters(): ReportListFilters {
  const filters: ReportListFilters = {};
  if (vacancyId.value) filters.vacancyId = vacancyId.value;
  if (recommendation.value === "HIRE" || recommendation.value === "MAYBE" || recommendation.value === "REJECT") {
    filters.recommendation = recommendation.value;
  }
  const trimmed = email.value.trim();
  if (trimmed) filters.email = trimmed;
  if (dateFrom.value) filters.dateFrom = dateFrom.value;
  if (dateTo.value) filters.dateTo = dateTo.value;
  return filters;
}

async function loadReports(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    reports.value = await fetchReports(currentFilters());
    listState.value = "ready";
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити список звітів";
  }
}

function resetFilters(): void {
  vacancyId.value = "";
  recommendation.value = "";
  email.value = "";
  dateFrom.value = "";
  dateTo.value = "";
}

let emailTimer: ReturnType<typeof setTimeout> | null = null;

watch([vacancyId, recommendation, dateFrom, dateTo], () => {
  void loadReports();
});

watch(email, () => {
  if (emailTimer) clearTimeout(emailTimer);
  emailTimer = setTimeout(() => {
    void loadReports();
  }, 300);
});

onMounted(async () => {
  try {
    vacancies.value = await fetchMyVacancies();
  } catch {
    // dropdown empty; reports can still load
  }
  await loadReports();
});
</script>

<template>
  <div class="report-list">
    <div class="list-header">
      <h1>Звіти</h1>
      <button
        v-if="hasActiveFilters"
        type="button"
        class="btn-reset"
        @click="resetFilters"
      >
        Скинути фільтри
      </button>
    </div>

    <div class="filters" aria-label="Фільтри звітів">
      <label class="filter-field">
        <span class="filter-label">Вакансія</span>
        <select v-model="vacancyId">
          <option value="">Усі</option>
          <option v-for="v in vacancies" :key="v.id" :value="v.id">
            {{ v.title }}
          </option>
        </select>
      </label>
      <label class="filter-field">
        <span class="filter-label">Рекомендація</span>
        <select v-model="recommendation">
          <option value="">Усі</option>
          <option value="HIRE">Найняти</option>
          <option value="MAYBE">Під питанням</option>
          <option value="REJECT">Відхилити</option>
        </select>
      </label>
      <label class="filter-field">
        <span class="filter-label">Пошта</span>
        <input v-model="email" type="search" placeholder="пошук…" />
      </label>
      <label class="filter-field">
        <span class="filter-label">Від</span>
        <input v-model="dateFrom" type="date" />
      </label>
      <label class="filter-field">
        <span class="filter-label">До</span>
        <input v-model="dateTo" type="date" />
      </label>
    </div>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="reports.length === 0" class="muted">
      <template v-if="hasActiveFilters">
        Нічого не знайдено за цими фільтрами.
      </template>
      <template v-else>
        Ще немає звітів. Вони з’являться після завершення співбесід.
      </template>
    </p>
    <table v-else class="reports-table">
      <thead>
        <tr>
          <th>Пошта</th>
          <th>Вакансія</th>
          <th>Оцінка</th>
          <th>Рекомендація</th>
          <th>Дата</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="report in reports" :key="report.id">
          <td>
            <RouterLink
              v-if="report.candidateEmail"
              :to="{ name: 'report', params: { id: report.id } }"
              class="email-link"
            >
              {{ report.candidateEmail }}
            </RouterLink>
            <RouterLink
              v-else
              :to="{ name: 'report', params: { id: report.id } }"
              class="email-link"
            >
              —
            </RouterLink>
          </td>
          <td>{{ report.vacancyTitle }}</td>
          <td>{{ report.matchScore }}%</td>
          <td>
            <RouterLink
              :to="{ name: 'report', params: { id: report.id } }"
              class="report-badge"
              :class="badgeClass(report.recommendation)"
            >
              {{ recommendationLabel(report.recommendation) }}
            </RouterLink>
          </td>
          <td>{{ formatDate(report.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.report-list h1 {
  margin: 0;
  font-size: 1.25rem;
}
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 8rem;
}
.filter-label {
  font-size: 0.75rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.filter-field select,
.filter-field input {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--surface);
  color: var(--text);
}
.btn-reset {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.muted {
  color: var(--muted);
}
.fail {
  color: var(--danger);
}
.reports-table {
  width: 100%;
  border-collapse: collapse;
}
.reports-table th,
.reports-table td {
  text-align: left;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.reports-table th {
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.email-link {
  color: var(--accent);
  text-decoration: none;
}
.email-link:hover {
  text-decoration: underline;
}
.report-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}
.report-badge.badge-hire {
  background: #dcfce7;
  color: #16a34a;
}
.report-badge.badge-maybe {
  background: #fef9c3;
  color: #ca8a04;
}
.report-badge.badge-reject {
  background: #fee2e2;
  color: #dc2626;
}
</style>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchMyInterviews, type InterviewSummary } from "../api/interviews";

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

function goToDetail(id: string): void {
  router.push({ name: "interview-detail", params: { id } });
}

onMounted(loadInterviews);
</script>

<template>
  <div class="interview-list">
    <h1>Співбесіди</h1>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="interviews.length === 0" class="muted">
      У вас ще немає співбесід. Створіть першу на головній сторінці.
    </p>
    <template v-else>
      <table class="interviews-table">
        <thead>
          <tr>
            <th>Назва</th>
            <th>Код</th>
            <th>Дата</th>
            <th>Статус</th>
            <th>Звіт</th>
            <th>Дії</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="interview in interviews" :key="interview.id">
            <td>{{ interview.displayName }}</td>
            <td class="code-cell">{{ interview.joinCode }}</td>
            <td>{{ formatDate(interview.createdAt) }}</td>
            <td>{{ statusLabel(interview.status) }}</td>
            <td>{{ reportLabel(interview.reportSummary) }}</td>
            <td>
              <button type="button" class="btn-primary" @click="goToDetail(interview.id)">
                Відкрити
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.interview-list h1 {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
.muted {
  color: #6b7280;
}
.fail {
  color: #b00020;
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
.code-cell {
  font-family: monospace;
  letter-spacing: 0.05em;
}
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  background: #2563eb;
  color: #fff;
}
</style>

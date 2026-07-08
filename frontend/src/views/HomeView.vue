<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createInterview,
  fetchMyInterviews,
  type CreatedInterview,
  type InterviewSummary,
} from "../api/interviews";
import { useAuthStore } from "../stores/auth";

type ListState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Готова",
  LIVE: "В ефірі",
  ENDED: "Завершена",
};

const auth = useAuthStore();
const router = useRouter();

function logout(): void {
  auth.logout();
  router.push({ name: "login" });
}

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

const creatingInterview = ref(false);
const createInterviewError = ref<string | null>(null);
const createdInterview = ref<CreatedInterview | null>(null);

async function onCreateInterview(): Promise<void> {
  createInterviewError.value = null;
  creatingInterview.value = true;
  try {
    const interview = await createInterview();
    createdInterview.value = interview;
    interviews.value.unshift(interview);
  } catch (error) {
    createInterviewError.value =
      error instanceof Error ? error.message : "Не вдалося створити співбесіду";
  } finally {
    creatingInterview.value = false;
  }
}

function goToCreatedInterviewPrep(): void {
  if (!createdInterview.value) return;
  router.push({ name: "company-prep", params: { interviewId: createdInterview.value.id } });
}

function goToPrep(interviewId: string): void {
  router.push({ name: "company-prep", params: { interviewId } });
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

onMounted(loadInterviews);
</script>

<template>
  <main class="page">
    <header class="header">
      <div>
        <h1>Interview Platform</h1>
        <p class="subtitle">HR — ваші співбесіди</p>
      </div>
      <div class="user-bar">
        <span>{{ auth.user?.email }}</span>
        <button type="button" @click="logout">Вийти</button>
      </div>
    </header>

    <div class="dashboard-actions">
      <button
        type="button"
        class="btn-primary"
        :disabled="creatingInterview"
        @click="onCreateInterview"
      >
        {{ creatingInterview ? "Створення…" : "Створити співбесіду" }}
      </button>
      <p v-if="createInterviewError" class="fail">{{ createInterviewError }}</p>
    </div>

    <div v-if="createdInterview" class="created-banner">
      <p>
        Співбесіду створено! Код для кандидата:
        <strong class="created-code">{{ createdInterview.joinCode }}</strong>
      </p>
      <button type="button" class="btn-primary" @click="goToCreatedInterviewPrep">
        Перейти до анкети →
      </button>
    </div>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="interviews.length === 0">
      У вас ще немає створених співбесід. Створіть першу!
    </p>
    <table v-else class="interviews-table">
      <thead>
        <tr>
          <th>Код</th>
          <th>Статус</th>
          <th>Дата створення</th>
          <th>Дія</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="interview in interviews" :key="interview.id">
          <td class="code-cell">{{ interview.joinCode }}</td>
          <td>{{ statusLabel(interview.status) }}</td>
          <td>{{ formatDate(interview.createdAt) }}</td>
          <td>
            <button
              v-if="interview.status === 'DRAFT'"
              type="button"
              class="btn-primary"
              @click="goToPrep(interview.id)"
            >
              Пройти анкету
            </button>
            <button
              v-else
              type="button"
              class="btn-disabled"
              disabled
              title="Скоро з'явиться"
            >
              Відкрити
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}
.subtitle { color: #555; }
.fail { color: #b00020; }
.dashboard-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 1rem 0;
}
.created-banner {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}
.created-code {
  font-family: monospace;
  font-size: 1.1rem;
  letter-spacing: 0.1em;
}
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}
.btn-primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
.btn-disabled {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: #e5e7eb;
  color: #6b7280;
  cursor: not-allowed;
}
.interviews-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}
.interviews-table th,
.interviews-table td {
  text-align: left;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid #eee;
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
</style>

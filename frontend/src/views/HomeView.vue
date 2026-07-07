<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchHealth, type HealthResponse } from "../api/health";
import { createInterview, fetchMyInterviews, type CreatedInterview } from "../api/interviews";
import ChatPanel from "../components/ChatPanel.vue";
import { useAuthStore } from "../stores/auth";

type LoadState = "loading" | "ready" | "error";

const auth = useAuthStore();
const router = useRouter();
const loadState = ref<LoadState>("loading");
const health = ref<HealthResponse | null>(null);
const errorMessage = ref<string | null>(null);

function statusLabel(ok: boolean | undefined): string {
  if (ok === undefined) return "…";
  return ok ? "OK" : "FAIL";
}

function statusClass(ok: boolean | undefined): string {
  if (ok === undefined) return "pending";
  return ok ? "ok" : "fail";
}

function logout(): void {
  auth.logout();
  router.push({ name: "login" });
}

const prepNavError = ref<string | null>(null);

async function goToCompanyPrep(): Promise<void> {
  prepNavError.value = null;
  try {
    const interviews = await fetchMyInterviews();
    if (interviews.length === 0) {
      prepNavError.value = "Спочатку створіть співбесіду.";
      return;
    }
    router.push({ name: "company-prep", params: { interviewId: interviews[0].id } });
  } catch {
    prepNavError.value = "Не вдалося завантажити список співбесід.";
  }
}

const creatingInterview = ref(false);
const createInterviewError = ref<string | null>(null);
const createdInterview = ref<CreatedInterview | null>(null);

async function onCreateInterview(): Promise<void> {
  createInterviewError.value = null;
  creatingInterview.value = true;
  try {
    createdInterview.value = await createInterview();
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

onMounted(async () => {
  try {
    health.value = await fetchHealth();
    loadState.value = "ready";
  } catch {
    loadState.value = "error";
    errorMessage.value = "Не вдалося підключитися до API";
  }
});
</script>

<template>
  <main class="page">
    <header class="header">
      <div>
        <h1>Interview Platform</h1>
        <p class="subtitle">HR — статус системи та чат з AI</p>
      </div>
      <div class="user-bar">
        <span>{{ auth.user?.email }}</span>
        <button type="button" @click="logout">Вийти</button>
      </div>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="fail">{{ errorMessage }}</p>

    <template v-else>
      <ul class="status-list">
        <li>
          <span>Backend API</span>
          <strong :class="statusClass(health?.ok)">{{ statusLabel(health?.ok) }}</strong>
        </li>
        <li>
          <span>PostgreSQL</span>
          <strong :class="statusClass(health?.database.ok)">
            {{ statusLabel(health?.database.ok) }}
          </strong>
        </li>
        <li>
          <span>Seed HR ({{ health?.seed.email }})</span>
          <strong :class="statusClass(health?.seed.ok)">
            {{ statusLabel(health?.seed.ok) }}
          </strong>
        </li>
      </ul>
      <div class="prep-nav">
        <button type="button" class="btn-primary" @click="goToCompanyPrep">Анкета компанії</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="creatingInterview"
          @click="onCreateInterview"
        >
          {{ creatingInterview ? "Створення…" : "Створити співбесіду" }}
        </button>
        <p v-if="prepNavError" class="fail">{{ prepNavError }}</p>
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

      <ChatPanel />
    </template>
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
.status-list { list-style: none; padding: 0; }
.status-list li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}
.ok { color: #0a7a2f; }
.fail { color: #b00020; }
.pending { color: #666; }
.prep-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
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
</style>

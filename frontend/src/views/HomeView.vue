<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchHealth, type HealthResponse } from "../api/health";
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
</style>

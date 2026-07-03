<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchHealth, type HealthResponse } from "./api/health";

type LoadState = "loading" | "ready" | "error";

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

onMounted(async () => {
  try {
    health.value = await fetchHealth();
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = "Не вдалося підключитися до API";
    console.error(error);
  }
});
</script>

<template>
  <main class="page">
    <h1>Interview Platform</h1>
    <p class="subtitle">Day 1 — статус системи</p>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="fail">{{ errorMessage }}</p>

    <ul v-else class="status-list">
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
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 32rem;
  margin: 2rem auto;
  padding: 0 1rem;
}

.subtitle {
  color: #555;
}

.status-list {
  list-style: none;
  padding: 0;
}

.status-list li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}

.ok {
  color: #0a7a2f;
}

.fail {
  color: #b00020;
}

.pending {
  color: #666;
}
</style>

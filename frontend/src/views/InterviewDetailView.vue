<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { fetchInterview, type InterviewDetail } from "../api/interviews";

const route = useRoute();
const interviewId = computed(() => String(route.params.id));

const interview = ref<InterviewDetail | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Обидва готові",
  LIVE: "В ефірі",
  ENDED: "Завершена",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

async function loadInterview(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    interview.value = await fetchInterview(interviewId.value);
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
}

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
  font-family: system-ui, sans-serif;
  max-width: 40rem;
}
.header {
  margin-bottom: 1rem;
}
.back-link {
  color: #2563eb;
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
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: #b00020;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.btn-primary {
  display: inline-block;
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  text-decoration: none;
  background: #2563eb;
  color: #fff;
}
</style>

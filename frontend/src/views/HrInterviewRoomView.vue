<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import InterviewRoomContent from "../components/InterviewRoomContent.vue";
import { fetchInterview } from "../api/interviews";

const route = useRoute();
const interviewId = computed(() => String(route.params.id));
const joinCode = ref<string | null>(null);
const reportId = ref<string | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    const interview = await fetchInterview(interviewId.value);
    joinCode.value = interview.joinCode;
    reportId.value = interview.reportId;
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
});
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink :to="{ name: 'interviews' }" class="back-link">← До списку співбесід</RouterLink>
    </header>
    <h1>Жива кімната</h1>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ loadError }}</p>

    <InterviewRoomContent
      v-else
      :interview-id="interviewId"
      current-role="HR"
      :join-code="joinCode"
      :report-id="reportId"
    />
  </main>
</template>

<style scoped>
.page {
  font-family: var(--font);
  max-width: 40rem;
}
.header {
  margin-bottom: 1rem;
}
.back-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover {
  text-decoration: underline;
}
h1 {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
.error-banner {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
</style>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import InterviewRoomContent from "../components/InterviewRoomContent.vue";
import { fetchCandidateInterview } from "../api/candidate-interview";

const interviewId = ref<string | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    const interview = await fetchCandidateInterview();
    if (!interview) {
      loadState.value = "error";
      loadError.value = "Спочатку приєднайтеся до співбесіди";
      return;
    }
    interviewId.value = interview.id;
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
      <RouterLink to="/candidate/interview" class="back-link">← Назад до співбесіди</RouterLink>
    </header>
    <h1>Жива кімната</h1>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ loadError }}</p>

    <InterviewRoomContent
      v-else-if="interviewId"
      :interview-id="interviewId"
      current-role="CANDIDATE"
    />
  </main>
</template>

<style scoped>
.page {
  width: 100%;
  min-width: 0;
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

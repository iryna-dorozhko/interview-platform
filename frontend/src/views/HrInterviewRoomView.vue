<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import InterviewRoomContent from "../components/InterviewRoomContent.vue";

const route = useRoute();
const interviewId = computed(() => String(route.params.id));
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink :to="`/interviews/${interviewId}`" class="back-link">
        ← Назад до співбесіди
      </RouterLink>
    </header>
    <h1>Жива кімната</h1>
    <InterviewRoomContent :interview-id="interviewId" current-role="HR" />
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
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
</style>

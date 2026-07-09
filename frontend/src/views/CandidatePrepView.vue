<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const interviewId = computed(() => String(route.params.interviewId));
</script>

<template>
  <main class="page">
    <h1>Мій профіль / Анкета</h1>
    <p>Interview: {{ interviewId }}</p>
  </main>
</template>

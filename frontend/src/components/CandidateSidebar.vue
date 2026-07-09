<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();

function isActive(prefix: string): boolean {
  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}

function isHomeActive(): boolean {
  return route.name === "candidate-home";
}
</script>

<template>
  <nav class="sidebar" aria-label="Candidate navigation">
    <RouterLink to="/candidate" class="nav-item" :class="{ active: isHomeActive() }" title="Головна">
      <span class="icon" aria-hidden="true">🏠</span>
      <span class="label">Головна</span>
    </RouterLink>
    <RouterLink
      to="/candidate/profile"
      class="nav-item"
      :class="{ active: isActive('/candidate/profile') }"
      title="Моя анкета"
    >
      <span class="icon" aria-hidden="true">📋</span>
      <span class="label">Моя анкета</span>
    </RouterLink>
    <RouterLink
      to="/candidate/interview"
      class="nav-item"
      :class="{ active: isActive('/candidate/interview') }"
      title="Співбесіда"
    >
      <span class="icon" aria-hidden="true">🎤</span>
      <span class="label">Співбесіда</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid #e5e7eb;
  min-width: 5rem;
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem;
  border-radius: 0.375rem;
  text-decoration: none;
  color: #374151;
  font-size: 0.75rem;
}
.nav-item.active {
  background: #dbeafe;
  color: #1d4ed8;
}
.icon {
  font-size: 1.25rem;
}
</style>

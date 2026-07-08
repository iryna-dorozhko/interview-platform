<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();

function isActive(prefix: string): boolean {
  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}

function isHomeActive(): boolean {
  return route.name === "home";
}
</script>

<template>
  <nav class="sidebar" aria-label="HR navigation">
    <RouterLink to="/" class="nav-item" :class="{ active: isHomeActive() }" title="Головна">
      <span class="icon" aria-hidden="true">🏠</span>
      <span class="label">Головна</span>
    </RouterLink>
    <RouterLink to="/vacancies" class="nav-item" :class="{ active: isActive('/vacancies') }" title="Профіль вакансії">
      <span class="icon" aria-hidden="true">📋</span>
      <span class="label">Анкети</span>
    </RouterLink>
    <RouterLink to="/interviews" class="nav-item" :class="{ active: isActive('/interviews') }" title="Список співбесід">
      <span class="icon" aria-hidden="true">🎤</span>
      <span class="label">Співбесіди</span>
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

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
    <RouterLink to="/" class="nav-item" :class="{ active: isHomeActive() }">
      Головна
    </RouterLink>
    <RouterLink
      to="/company-profile"
      class="nav-item"
      :class="{ active: isActive('/company-profile') }"
    >
      Профіль компанії
    </RouterLink>
    <RouterLink to="/vacancies" class="nav-item" :class="{ active: isActive('/vacancies') }">
      Вакансії
    </RouterLink>
    <RouterLink to="/interviews" class="nav-item" :class="{ active: isActive('/interviews') }">
      Співбесіди
    </RouterLink>
    <RouterLink
      to="/applications"
      class="nav-item"
      :class="{ active: isActive('/applications') }"
    >
      Заявки
    </RouterLink>
    <RouterLink to="/reports" class="nav-item" :class="{ active: isActive('/reports') }">
      Звіти
    </RouterLink>
    <RouterLink to="/dialogs" class="nav-item" :class="{ active: isActive('/dialogs') }">
      Діалоги
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid var(--border);
  background: var(--surface-muted);
  flex: 0 0 var(--sidebar-width);
  min-width: var(--sidebar-width);
}
.nav-item {
  display: block;
  padding: 0.55rem 0.65rem;
  border-radius: 6px;
  text-decoration: none;
  color: #374151;
  font-size: 0.9rem;
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
</style>

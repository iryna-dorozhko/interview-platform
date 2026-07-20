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
    <RouterLink to="/candidate" class="nav-item" :class="{ active: isHomeActive() }">
      Головна
    </RouterLink>
    <RouterLink
      to="/candidate/profile"
      class="nav-item"
      :class="{ active: isActive('/candidate/profile') }"
    >
      Моя анкета
    </RouterLink>
    <RouterLink
      to="/candidate/interview"
      class="nav-item"
      :class="{ active: isActive('/candidate/interview') }"
    >
      Співбесіда
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

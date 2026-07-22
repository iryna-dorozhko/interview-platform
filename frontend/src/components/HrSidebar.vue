<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  formatUnreadBadge,
  useDialogUnread,
} from "../composables/useDialogUnread";

const route = useRoute();
const { unreadCount } = useDialogUnread();
const dialogBadge = computed(() =>
  unreadCount.value > 0 ? formatUnreadBadge(unreadCount.value) : null,
);

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
      <span>Діалоги</span>
      <span v-if="dialogBadge" class="nav-badge">{{ dialogBadge }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1.1rem 0.9rem;
  border-right: 1px solid var(--border);
  background: var(--surface-muted);
  flex: 0 0 var(--sidebar-width);
  min-width: var(--sidebar-width);
}
.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.65rem 0.8rem;
  border-radius: 6px;
  text-decoration: none;
  color: #374151;
  font-size: 0.95rem;
  line-height: 1.35;
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
}
</style>

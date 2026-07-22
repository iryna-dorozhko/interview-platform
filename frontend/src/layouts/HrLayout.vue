<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { RouterView, useRouter } from "vue-router";
import HrSidebar from "../components/HrSidebar.vue";
import { useDialogUnread } from "../composables/useDialogUnread";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const { startPolling, stopPolling } = useDialogUnread();

onMounted(() => startPolling());
onUnmounted(() => stopPolling());

function logout(): void {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="hr-shell">
    <header class="header">
      <div>
        <h1>Interview Platform</h1>
        <p class="subtitle">HR — кабінет</p>
      </div>
      <div class="user-bar">
        <span>{{ auth.user?.email }}</span>
        <button type="button" @click="logout">Вийти</button>
      </div>
    </header>
    <div class="body">
      <HrSidebar />
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.hr-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.9rem 1.25rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.header h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.subtitle {
  margin: 0.3rem 0 0;
  color: var(--muted);
  font-size: 0.9375rem;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.user-bar button {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}
.body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.content {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: var(--content-padding-y) var(--content-padding-x);
}
</style>

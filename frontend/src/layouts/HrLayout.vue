<script setup lang="ts">
import { RouterView, useRouter } from "vue-router";
import HrSidebar from "../components/HrSidebar.vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

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
  font-family: system-ui, sans-serif;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}
.header h1 {
  margin: 0;
  font-size: 1.25rem;
}
.subtitle {
  margin: 0.25rem 0 0;
  color: #555;
  font-size: 0.875rem;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}
.body {
  display: flex;
  flex: 1;
}
.content {
  flex: 1;
  padding: 1.5rem;
  max-width: 56rem;
}
</style>

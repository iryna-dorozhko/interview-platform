<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

function logout(): void {
  auth.logout();
  router.push("/candidate/login");
}
</script>

<template>
  <main class="page">
    <h1>Кабінет кандидата</h1>
    <p>Поки що порожньо. Наступним кроком тут буде анкета кандидата.</p>
    <button type="button" @click="logout">Вийти</button>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 24rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
button {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  font-size: 1rem;
  cursor: pointer;
}
</style>

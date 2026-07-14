<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../api/client";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref("hr@test.com");
const password = ref("");
const loading = ref(false);
const errorMessage = ref<string | null>(null);

function sanitizeRedirect(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
    ? value
    : fallback;
}

async function onSubmit(): Promise<void> {
  errorMessage.value = null;
  loading.value = true;
  try {
    await auth.loginHr(email.value.trim(), password.value);
    await router.push(sanitizeRedirect(route.query.redirect, "/"));
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        errorMessage.value = "Доступ лише для HR";
      } else if (error.status === 401) {
        errorMessage.value = "Невірний email або пароль";
      } else {
        errorMessage.value = error.message;
      }
    } else {
      errorMessage.value = "Не вдалося підключитися до сервера";
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="page">
    <h1>Вхід HR</h1>
    <form class="form" @submit.prevent="onSubmit">
      <label>
        Email
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label>
        Пароль
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <button type="submit" :disabled="loading">
        {{ loading ? "Вхід…" : "Увійти" }}
      </button>
    </form>
    <p class="helper">
      Кандидат?
      <RouterLink to="/candidate/login">Увійти як кандидат</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.page {
  max-width: 24rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
input {
  padding: 0.5rem;
  font-size: 1rem;
}
.error {
  color: var(--danger);
}
button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  cursor: pointer;
  background: var(--accent);
  color: #fff;
  border: 1px solid transparent;
  border-radius: 0.375rem;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.helper {
  margin-top: 1.5rem;
  font-size: 0.875rem;
  color: #6b7280;
}
</style>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError } from "../api/client";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const loading = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  errorMessage.value = null;
  loading.value = true;
  try {
    await auth.registerCandidate(email.value.trim(), password.value);
    await router.push("/candidate");
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409) {
        errorMessage.value = "Email вже зареєстровано";
      } else if (error.status === 400) {
        errorMessage.value = "Невірні дані";
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
    <h1>Реєстрація кандидата</h1>
    <form class="form" @submit.prevent="onSubmit">
      <label>
        Email
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label>
        Пароль
        <input v-model="password" type="password" autocomplete="new-password" required />
      </label>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <button type="submit" :disabled="loading">
        {{ loading ? "Реєстрація…" : "Зареєструватися" }}
      </button>
    </form>
    <p class="helper">
      Вже є акаунт?
      <RouterLink to="/candidate/login">Увійти</RouterLink>
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
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.helper {
  margin-top: 1.5rem;
  font-size: 0.875rem;
  color: #6b7280;
}
</style>

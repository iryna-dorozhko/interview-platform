<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

const demoInterviewId = computed(() => import.meta.env.VITE_DEMO_INTERVIEW_ID?.trim() ?? "");
const hasDemoInterview = computed(() => demoInterviewId.value.length > 0);

function openQuestionnaire(): void {
  if (!hasDemoInterview.value) return;
  router.push({ name: "candidate-prep", params: { interviewId: demoInterviewId.value } });
}

function logout(): void {
  auth.logout();
  router.push("/candidate/login");
}
</script>

<template>
  <main class="page">
    <h1>Кабінет кандидата</h1>
    <p class="intro">Заповніть анкету перед співбесідою — Candidate Agent допоможе зібрати інформацію про ваш досвід.</p>

    <div class="actions">
      <button type="button" class="btn-primary" :disabled="!hasDemoInterview" @click="openQuestionnaire">
        Моя анкета
      </button>
      <button type="button" class="btn-secondary" @click="logout">Вийти</button>
    </div>

    <p v-if="!hasDemoInterview" class="hint">
      Додайте <code>VITE_DEMO_INTERVIEW_ID</code> у <code>frontend/.env</code> (id з виводу
      <code>npm --workspace backend run db:seed</code>, <code>joinCode=TEST01</code>) або відкрийте
      <code>/candidate/prep/:interviewId</code> вручну.
    </p>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 32rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.intro {
  color: #374151;
  line-height: 1.5;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-primary {
  background: #16a34a;
  color: #fff;
}
.btn-primary:disabled {
  background: #86efac;
  cursor: not-allowed;
}
.btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.hint {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #f3f4f6;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: #4b5563;
  line-height: 1.5;
}
code {
  font-size: 0.8125rem;
  background: #e5e7eb;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
}
</style>

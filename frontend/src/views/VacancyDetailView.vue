<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { fetchVacancy, type VacancyDetail } from "../api/vacancies";

const route = useRoute();
const router = useRouter();
const vacancyId = computed(() => String(route.params.id));

const vacancy = ref<VacancyDetail | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  CONFIRMED: "Підтверджена",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

function goToPrep(): void {
  router.push({ name: "vacancy-prep", params: { id: vacancyId.value } });
}

async function loadVacancy(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    vacancy.value = await fetchVacancy(vacancyId.value);
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити анкету";
  }
}

onMounted(loadVacancy);
</script>

<template>
  <main class="page">
    <header class="header">
      <RouterLink to="/vacancies" class="back-link">← До списку анкет</RouterLink>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else-if="vacancy">
      <h1>{{ vacancy.title }}</h1>
      <p class="meta">
        Статус: <strong>{{ statusLabel(vacancy.status) }}</strong>
        · Створено {{ formatDate(vacancy.createdAt) }}
      </p>

      <section v-if="vacancy.profile" class="profile-view">
        <h2>Профіль вакансії</h2>
        <dl>
          <dt>Посада</dt>
          <dd>{{ vacancy.profile.role }}</dd>
          <dt>Вимоги</dt>
          <dd>
            <ul>
              <li v-for="(item, i) in vacancy.profile.requirements" :key="i">{{ item }}</li>
            </ul>
          </dd>
          <dt>Культура</dt>
          <dd>
            <ul>
              <li v-for="(item, i) in vacancy.profile.culture" :key="i">{{ item }}</li>
            </ul>
          </dd>
          <dt>Очікування</dt>
          <dd>
            <ul>
              <li v-for="(item, i) in vacancy.profile.expectations" :key="i">{{ item }}</li>
            </ul>
          </dd>
        </dl>
        <p v-if="vacancy.profile.confirmedAt" class="confirmed-banner">
          ✓ Підтверджено {{ new Date(vacancy.profile.confirmedAt).toLocaleString("uk-UA") }}
        </p>
      </section>

      <section v-else class="empty-profile">
        <p>Профіль ще не сформовано.</p>
        <button v-if="vacancy.status === 'DRAFT'" type="button" class="btn-primary" @click="goToPrep">
          Пройти анкету
        </button>
      </section>

      <div v-if="vacancy.status === 'DRAFT'" class="actions">
        <button type="button" class="btn-secondary" @click="goToPrep">
          Редагувати анкету
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
}
.header {
  margin-bottom: 1rem;
}
.back-link {
  color: #2563eb;
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover {
  text-decoration: underline;
}
h1 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
}
.meta {
  margin: 0 0 1.5rem;
  color: #555;
  font-size: 0.875rem;
}
.error-banner {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: #b00020;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.profile-view dl {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.5rem 1rem;
  margin: 1rem 0;
}
.profile-view dt {
  font-weight: 600;
  color: #374151;
}
.profile-view dd {
  margin: 0;
}
.profile-view ul {
  margin: 0;
  padding-left: 1.25rem;
}
.confirmed-banner {
  margin: 1rem 0 0;
  padding: 0.5rem 0.75rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
}
.empty-profile {
  margin: 1rem 0;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 0.375rem;
  border: 1px solid #e5e7eb;
}
.empty-profile p {
  margin: 0 0 0.75rem;
  color: #555;
}
.actions {
  margin-top: 1.5rem;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
}
.btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
</style>

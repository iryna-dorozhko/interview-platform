<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  deleteVacancy,
  fetchMyVacancies,
  updateVacancyTitle,
  type VacancySummary,
} from "../api/vacancies";

type ListState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  CONFIRMED: "Підтверджена",
};

const router = useRouter();

const vacancies = ref<VacancySummary[]>([]);
const listState = ref<ListState>("loading");
const listError = ref<string | null>(null);
const actionError = ref<string | null>(null);

async function loadVacancies(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    vacancies.value = await fetchMyVacancies();
    listState.value = "ready";
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити список анкет";
  }
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

function goToPrep(id: string): void {
  router.push({ name: "vacancy-prep", params: { id } });
}

function goToDetail(id: string): void {
  router.push({ name: "vacancy-detail", params: { id } });
}

async function onEditTitle(vacancy: VacancySummary): Promise<void> {
  actionError.value = null;
  const nextTitle = window.prompt("Нова назва анкети:", vacancy.title);
  if (nextTitle === null) return;

  const trimmed = nextTitle.trim();
  if (trimmed.length < 2) {
    actionError.value = "Назва має містити щонайменше 2 символи";
    return;
  }
  if (trimmed === vacancy.title) return;

  try {
    const updated = await updateVacancyTitle(vacancy.id, trimmed);
    const index = vacancies.value.findIndex((item) => item.id === vacancy.id);
    if (index !== -1) {
      vacancies.value[index] = updated;
    }
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося оновити назву";
  }
}

async function onDelete(vacancy: VacancySummary): Promise<void> {
  actionError.value = null;
  if (!window.confirm(`Видалити анкету «${vacancy.title}»? Цю дію не можна скасувати.`)) {
    return;
  }

  try {
    await deleteVacancy(vacancy.id);
    vacancies.value = vacancies.value.filter((item) => item.id !== vacancy.id);
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : "Не вдалося видалити анкету";
  }
}

onMounted(loadVacancies);
</script>

<template>
  <div class="vacancy-list">
    <h1>Вакансії</h1>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="vacancies.length === 0" class="muted">
      У вас ще немає анкет. Створіть першу на головній сторінці.
    </p>
    <template v-else>
      <p v-if="actionError" class="fail" role="alert">{{ actionError }}</p>
      <table class="vacancies-table">
        <thead>
          <tr>
            <th>Назва</th>
            <th>Дата</th>
            <th>Статус</th>
            <th>Дії</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vacancy in vacancies" :key="vacancy.id">
            <td>{{ vacancy.title }}</td>
            <td>{{ formatDate(vacancy.createdAt) }}</td>
            <td>{{ statusLabel(vacancy.status) }}</td>
            <td class="actions-cell">
              <button
                v-if="vacancy.status === 'DRAFT'"
                type="button"
                class="btn-primary"
                @click="goToPrep(vacancy.id)"
              >
                Пройти анкету
              </button>
              <button
                v-else-if="vacancy.status === 'CONFIRMED'"
                type="button"
                class="btn-primary"
                @click="goToDetail(vacancy.id)"
              >
                Переглянути
              </button>
              <button type="button" class="btn-secondary" @click="onEditTitle(vacancy)">
                Редагувати назву
              </button>
              <button type="button" class="btn-danger" @click="onDelete(vacancy)">
                Видалити
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.vacancy-list h1 {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
.muted {
  color: #6b7280;
}
.fail {
  color: var(--danger);
}
.vacancies-table {
  width: 100%;
  border-collapse: collapse;
}
.vacancies-table th,
.vacancies-table td {
  text-align: left;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid #eee;
  vertical-align: middle;
}
.vacancies-table th {
  font-size: 0.8rem;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.actions-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.btn-primary,
.btn-secondary,
.btn-danger {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.btn-danger {
  background: #fff;
  color: var(--danger);
  border-color: #fca5a5;
}
</style>

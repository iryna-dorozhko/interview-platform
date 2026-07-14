<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { createInterview, type CreatedInterview } from "../api/interviews";
import { fetchMyVacancies, type VacancySummary } from "../api/vacancies";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  created: [interview: CreatedInterview];
}>();

const router = useRouter();

const step = ref<"form" | "code">("form");
const createdInterview = ref<CreatedInterview | null>(null);
const confirmedVacancies = ref<VacancySummary[]>([]);
const selectedVacancyId = ref("");
const loading = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);
const loadError = ref<string | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;

    step.value = "form";
    createdInterview.value = null;
    selectedVacancyId.value = "";
    error.value = null;
    loadError.value = null;
    submitting.value = false;
    loading.value = true;
    confirmedVacancies.value = [];

    try {
      const vacancies = await fetchMyVacancies();
      confirmedVacancies.value = vacancies.filter((v) => v.status === "CONFIRMED");
      if (confirmedVacancies.value.length > 0) {
        selectedVacancyId.value = confirmedVacancies.value[0].id;
      }
    } catch (err) {
      loadError.value =
        err instanceof Error ? err.message : "Не вдалося завантажити список анкет";
    } finally {
      loading.value = false;
    }
  },
);

function onClose(): void {
  if (submitting.value) return;
  emit("close");
}

function finishCreated(): void {
  if (!createdInterview.value) return;
  emit("created", createdInterview.value);
  emit("close");
}

function onContinue(): void {
  if (!createdInterview.value) return;
  router.push({ name: "interview-room", params: { id: createdInterview.value.id } });
  finishCreated();
}

async function onSubmit(): Promise<void> {
  if (!selectedVacancyId.value) return;

  error.value = null;
  submitting.value = true;
  try {
    const interview = await createInterview(selectedVacancyId.value);
    createdInterview.value = interview;
    step.value = "code";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не вдалося створити співбесіду";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="onClose">
    <div class="modal" role="dialog" aria-labelledby="create-interview-title">
      <template v-if="step === 'code' && createdInterview">
        <h2 id="create-interview-title">Код для кандидата</h2>
        <p class="join-code">{{ createdInterview.joinCode }}</p>
        <p class="hint">Надішліть цей код кандидату</p>
        <div class="actions">
          <button type="button" class="btn-secondary" @click="finishCreated">Закрити</button>
          <button type="button" class="btn-primary" @click="onContinue">Далі</button>
        </div>
      </template>

      <template v-else>
        <h2 id="create-interview-title">Створити зустріч</h2>

        <p v-if="loading">Завантаження…</p>
        <p v-else-if="loadError" class="fail">{{ loadError }}</p>
        <p v-else-if="confirmedVacancies.length === 0" class="empty-message">
          Спочатку створіть і підтвердіть анкету
        </p>
        <form v-else @submit.prevent="onSubmit">
          <label class="field">
            <span>Анкета</span>
            <select v-model="selectedVacancyId" :disabled="submitting">
              <option v-for="vacancy in confirmedVacancies" :key="vacancy.id" :value="vacancy.id">
                {{ vacancy.title }}
              </option>
            </select>
          </label>
          <p v-if="error" class="fail">{{ error }}</p>
          <div class="actions">
            <button type="button" class="btn-secondary" :disabled="submitting" @click="onClose">
              Скасувати
            </button>
            <button type="submit" class="btn-primary" :disabled="submitting">
              {{ submitting ? "Створення…" : "Створити" }}
            </button>
          </div>
        </form>

        <div v-if="!loading && (loadError || confirmedVacancies.length === 0)" class="actions">
          <button type="button" class="btn-secondary" @click="onClose">Закрити</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}
.modal {
  background: #fff;
  border-radius: 0.5rem;
  padding: 1.25rem;
  width: 100%;
  max-width: 24rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}
.modal h2 {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}
.join-code {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-align: center;
  padding: 1rem 0;
}
.hint {
  margin: 0 0 0.5rem;
  color: #555;
  font-size: 0.875rem;
  text-align: center;
}
.empty-message {
  margin: 0;
  color: #555;
  font-size: 0.875rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
}
.field select {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background: #fff;
}
.fail {
  margin: 0.75rem 0 0;
  color: var(--danger);
  font-size: 0.875rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
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
  background: var(--accent);
  color: #fff;
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-secondary {
  background: #f3f4f6;
  color: #374151;
  border-color: #d1d5db;
}
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

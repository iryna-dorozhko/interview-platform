<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  createAdditionalInterview,
  fetchAdditionalMeetingCandidates,
  type AdditionalMeetingCandidate,
  type CreatedInterview,
} from "../api/interviews";
import { formatScheduledAtUk } from "../utils/invite-message";
import InviteCopyActions from "./InviteCopyActions.vue";

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
const candidates = ref<AdditionalMeetingCandidate[]>([]);
const selectedCandidateUserId = ref("");
const scheduledAtLocal = ref("");
const loading = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);
const loadError = ref<string | null>(null);

const formattedScheduledAt = computed(() =>
  createdInterview.value ? formatScheduledAtUk(createdInterview.value.scheduledAt) : null,
);

const selectedCandidate = computed(
  () => candidates.value.find((c) => c.candidateUserId === selectedCandidateUserId.value) ?? null,
);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;

    step.value = "form";
    createdInterview.value = null;
    selectedCandidateUserId.value = "";
    scheduledAtLocal.value = "";
    error.value = null;
    loadError.value = null;
    submitting.value = false;
    loading.value = true;
    candidates.value = [];

    try {
      candidates.value = await fetchAdditionalMeetingCandidates();
      if (candidates.value.length > 0) {
        selectedCandidateUserId.value = candidates.value[0].candidateUserId;
      }
    } catch (err) {
      loadError.value =
        err instanceof Error
          ? err.message
          : "Не вдалося завантажити кандидатів для додаткової зустрічі";
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
  if (!selectedCandidateUserId.value) return;

  error.value = null;
  submitting.value = true;
  try {
    const interview = await createAdditionalInterview({
      candidateUserId: selectedCandidateUserId.value,
      ...(scheduledAtLocal.value
        ? { scheduledAt: new Date(scheduledAtLocal.value).toISOString() }
        : {}),
    });
    createdInterview.value = interview;
    step.value = "code";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не вдалося створити додаткову зустріч";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="onClose">
    <div class="modal" role="dialog" aria-labelledby="create-additional-interview-title">
      <template v-if="step === 'code' && createdInterview">
        <h2 id="create-additional-interview-title">Код для кандидата</h2>
        <p class="join-code">{{ createdInterview.joinCode }}</p>
        <p v-if="formattedScheduledAt" class="hint">Запланований час: {{ formattedScheduledAt }}</p>
        <InviteCopyActions
          :join-code="createdInterview.joinCode"
          :display-name="createdInterview.displayName"
          :scheduled-at="createdInterview.scheduledAt"
          interview-kind="ADDITIONAL_MEETING"
        />
        <p v-if="createdInterview.invitation" class="invitation-info">
          Запрошення: {{ createdInterview.invitation.email }} · очікує
        </p>
        <div class="actions">
          <button type="button" class="btn-secondary" @click="finishCreated">Закрити</button>
          <button type="button" class="btn-primary" @click="onContinue">Далі</button>
        </div>
      </template>

      <template v-else>
        <h2 id="create-additional-interview-title">Створити додаткову зустріч</h2>

        <p v-if="loading">Завантаження…</p>
        <p v-else-if="loadError" class="fail">{{ loadError }}</p>
        <p v-else-if="candidates.length === 0" class="empty-message">
          Немає кандидатів із рішенням «Додаткова зустріч»
        </p>
        <form v-else @submit.prevent="onSubmit">
          <label class="field">
            <span>Кандидат</span>
            <select v-model="selectedCandidateUserId" :disabled="submitting">
              <option
                v-for="candidate in candidates"
                :key="candidate.candidateUserId"
                :value="candidate.candidateUserId"
              >
                {{ candidate.candidateEmail }} — {{ candidate.vacancyTitle }}
              </option>
            </select>
          </label>
          <p v-if="selectedCandidate" class="hint-inline">
            Вакансія: {{ selectedCandidate.vacancyTitle }}
          </p>
          <label class="field">
            <span>Запланований час</span>
            <input v-model="scheduledAtLocal" type="datetime-local" :disabled="submitting" />
          </label>
          <p v-if="error" class="fail">{{ error }}</p>
          <div class="actions">
            <button type="button" class="btn-secondary" :disabled="submitting" @click="onClose">
              Скасувати
            </button>
            <button
              type="submit"
              class="btn-primary"
              :disabled="!selectedCandidateUserId || submitting"
            >
              {{ submitting ? "Створення…" : "Створити додаткову зустріч" }}
            </button>
          </div>
        </form>

        <div v-if="!loading && (loadError || candidates.length === 0)" class="actions">
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
.hint-inline {
  margin: 0;
  color: #555;
  font-size: 0.8125rem;
}
.invitation-info {
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
form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
}
.field select,
.field input {
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

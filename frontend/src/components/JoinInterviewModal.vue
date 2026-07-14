<script setup lang="ts">
import { ref, watch } from "vue";
import { joinInterviewByCode, type CandidateInterview } from "../api/candidate-interview";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  joined: [interview: CandidateInterview];
}>();

const joinCode = ref("");
const submitting = ref(false);
const error = ref<string | null>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    joinCode.value = "";
    error.value = null;
    submitting.value = false;
  },
);

function onClose(): void {
  if (submitting.value) return;
  emit("close");
}

async function onSubmit(): Promise<void> {
  const code = joinCode.value.trim();
  if (!code) return;

  error.value = null;
  submitting.value = true;
  try {
    const interview = await joinInterviewByCode(code);
    emit("joined", interview);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не вдалося приєднатися до співбесіди";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="onClose">
    <div class="modal" role="dialog" aria-labelledby="join-interview-title">
      <h2 id="join-interview-title">Приєднатися до зустрічі</h2>
      <form @submit.prevent="onSubmit">
        <label class="field">
          <span>Код співбесіди</span>
          <input
            v-model="joinCode"
            type="text"
            maxlength="6"
            autocomplete="off"
            placeholder="TEST01"
            :disabled="submitting"
          />
        </label>
        <p v-if="error" class="fail">{{ error }}</p>
        <div class="actions">
          <button type="button" class="btn-secondary" :disabled="submitting" @click="onClose">
            Скасувати
          </button>
          <button type="submit" class="btn-primary" :disabled="submitting || !joinCode.trim()">
            {{ submitting ? "Приєднання…" : "Приєднатися до співбесіди" }}
          </button>
        </div>
      </form>
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
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
}
.field input {
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
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

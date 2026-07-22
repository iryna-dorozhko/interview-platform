<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  confirmCompanyPrepProfile,
  deleteCompanyPrepChat,
  fetchCompanyPrepState,
  finishCompanyPrepChat,
  sendCompanyPrepMessage,
  updateCompanyPrepProfile,
  type HrCompanyProfile,
} from "../api/company-prep";
import { usePrepChat } from "../composables/usePrepChat";
import PrepChatPanel from "../components/PrepChatPanel.vue";

const router = useRouter();

const editableProfile = ref<HrCompanyProfile | null>(null);
const viewingHistory = ref(false);
const saving = ref(false);
const confirming = ref(false);

type ArrayField = "culture" | "companyDirection" | "policies" | "workFormat" | "onboardingApproach";

const chat = usePrepChat<HrCompanyProfile>({
  adapters: {
    loadState: async () => {
      const state = await fetchCompanyPrepState();
      return {
        messages: state.messages,
        isClosed: state.isClosed,
        profile: state.profile,
      };
    },
    sendMessage: (text) => sendCompanyPrepMessage(text),
    finishChat: () => finishCompanyPrepChat(),
    deleteChat: () => deleteCompanyPrepChat(),
    isUserMessage: (msg) => msg.authorType === "HUMAN_HR",
    humanAuthorType: "HUMAN_HR",
    agentAuthorType: "AGENT_COMPANY",
  },
  onAfterLoad: (state) => {
    syncEditableProfile(state.profile);
    viewingHistory.value = false;
  },
  onFinished: () => {
    syncEditableProfile(chat.profile.value);
    viewingHistory.value = false;
  },
  onDeleted: () => {
    syncEditableProfile(null);
    viewingHistory.value = false;
  },
});

const {
  loadState,
  errorMessage,
  messages,
  isClosed,
  profile,
  input,
  sending,
  lastFailedAction,
  messagesEl,
  load,
  send,
  retry,
  finish,
  deleteChat,
  onKeydown,
  isUserMessage,
} = chat;

function syncEditableProfile(next: HrCompanyProfile | null): void {
  profile.value = next;
  editableProfile.value = next ? { ...next } : null;
}

function setMessagesEl(el: HTMLElement | null): void {
  messagesEl.value = el;
}

function setInput(value: string): void {
  input.value = value;
}

function textToArray(text: string): string[] {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getArrayField(field: ArrayField): string {
  return editableProfile.value?.[field].join("\n") ?? "";
}

function onArrayFieldInput(field: ArrayField, event: Event): void {
  if (!editableProfile.value) return;
  const target = event.target as HTMLTextAreaElement;
  editableProfile.value[field] = textToArray(target.value);
}

function onCompanyNameInput(event: Event): void {
  if (!editableProfile.value) return;
  const target = event.target as HTMLInputElement;
  editableProfile.value.companyName = target.value;
}

async function onSaveProfileEdits(): Promise<void> {
  if (!editableProfile.value) return;
  errorMessage.value = null;
  saving.value = true;
  try {
    const payload: Partial<Omit<HrCompanyProfile, "confirmedAt">> = {
      culture: editableProfile.value.culture,
      companyDirection: editableProfile.value.companyDirection,
      policies: editableProfile.value.policies,
      workFormat: editableProfile.value.workFormat,
      onboardingApproach: editableProfile.value.onboardingApproach,
    };
    const companyName = editableProfile.value.companyName?.trim();
    if (companyName) {
      payload.companyName = companyName;
    }
    const { profile: updated } = await updateCompanyPrepProfile(payload);
    syncEditableProfile(updated);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося зберегти профіль";
  } finally {
    saving.value = false;
  }
}

async function onConfirmProfile(): Promise<void> {
  if (!window.confirm("Підтвердити профіль компанії? Редагування залишиться доступним.")) {
    return;
  }

  errorMessage.value = null;
  confirming.value = true;
  try {
    const response = await confirmCompanyPrepProfile();
    syncEditableProfile(response.profile);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося підтвердити профіль";
  } finally {
    confirming.value = false;
  }
}

function backToChat(): void {
  viewingHistory.value = true;
}

function backToProfile(): void {
  viewingHistory.value = false;
}

function goHome(): void {
  router.push({ name: "vacancies" });
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>Профіль компанії</h1>
      <button type="button" class="btn-secondary" @click="goHome">← До списку анкет</button>
    </header>

    <p class="page-hint">
      Заповніть один раз відповіді про культуру, напрям і політики компанії — вони автоматично
      підтягуватимуться до кожної вакансії.
    </p>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else>
      <section v-if="isClosed && profile && !viewingHistory" class="profile-view">
        <h2>Зібраний профіль компанії</h2>

        <form
          v-if="editableProfile"
          class="profile-form"
          @submit.prevent="onSaveProfileEdits"
        >
          <label class="field">
            <span class="field-label">Назва компанії</span>
            <input
              class="field-input"
              type="text"
              :value="editableProfile.companyName ?? ''"
              @input="onCompanyNameInput"
            />
          </label>
          <label class="field">
            <span class="field-label">Культура</span>
            <textarea
              class="field-input"
              rows="3"
              :value="getArrayField('culture')"
              @input="onArrayFieldInput('culture', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">Напрям компанії</span>
            <textarea
              class="field-input"
              rows="3"
              :value="getArrayField('companyDirection')"
              @input="onArrayFieldInput('companyDirection', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">Політики</span>
            <textarea
              class="field-input"
              rows="3"
              :value="getArrayField('policies')"
              @input="onArrayFieldInput('policies', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">Формат роботи</span>
            <textarea
              class="field-input"
              rows="3"
              :value="getArrayField('workFormat')"
              @input="onArrayFieldInput('workFormat', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">Онбординг</span>
            <textarea
              class="field-input"
              rows="3"
              :value="getArrayField('onboardingApproach')"
              @input="onArrayFieldInput('onboardingApproach', $event)"
            />
          </label>
        </form>

        <dl v-else>
          <dt>Назва компанії</dt>
          <dd>{{ profile.companyName?.trim() || "Компанія" }}</dd>
          <dt>Культура</dt>
          <dd><ul><li v-for="(item, i) in profile.culture" :key="i">{{ item }}</li></ul></dd>
          <dt>Напрям компанії</dt>
          <dd><ul><li v-for="(item, i) in profile.companyDirection" :key="i">{{ item }}</li></ul></dd>
          <dt>Політики</dt>
          <dd><ul><li v-for="(item, i) in profile.policies" :key="i">{{ item }}</li></ul></dd>
          <dt>Формат роботи</dt>
          <dd><ul><li v-for="(item, i) in profile.workFormat" :key="i">{{ item }}</li></ul></dd>
          <dt>Онбординг</dt>
          <dd><ul><li v-for="(item, i) in profile.onboardingApproach" :key="i">{{ item }}</li></ul></dd>
        </dl>

        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>

        <div class="actions">
          <button type="button" class="btn-secondary" @click="backToChat">← Назад до чату</button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="!!profile.confirmedAt"
            :title="profile.confirmedAt ? 'Підтверджений профіль не можна видалити' : ''"
            @click="deleteChat"
          >
            Видалити чат
          </button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="saving || !editableProfile"
            @click="onSaveProfileEdits"
          >
            {{ saving ? "Збереження…" : "Зберегти зміни" }}
          </button>
          <button
            v-if="!profile.confirmedAt"
            type="button"
            class="btn-primary"
            :disabled="confirming || saving"
            @click="onConfirmProfile"
          >
            Підтвердити профіль
          </button>
          <p v-else class="confirmed-banner">✓ Профіль компанії підтверджено</p>
        </div>
      </section>

      <PrepChatPanel
        v-else
        title="Чат з Company Agent"
        :load-state="loadState"
        :messages="messages"
        :sending="sending"
        :is-closed="isClosed"
        :input="input"
        :error-message="errorMessage"
        :last-failed-action="lastFailedAction"
        :is-user-message="isUserMessage"
        :set-messages-el="setMessagesEl"
        @update:input="setInput"
        @send="send"
        @retry="retry"
        @finish="finish"
        @delete="deleteChat"
        @keydown="onKeydown"
      >
        <template #actions>
          <button type="button" class="btn-secondary" :disabled="sending" @click="deleteChat">
            Видалити чат
          </button>
          <button
            v-if="!isClosed"
            type="button"
            class="btn-primary"
            :disabled="sending"
            @click="finish"
          >
            Завершити чат
          </button>
          <button v-else type="button" class="btn-secondary" @click="backToProfile">
            Показати профіль
          </button>
        </template>
      </PrepChatPanel>
    </template>
  </main>
</template>

<style scoped>
.page {
  width: 100%;
  min-width: 0;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  gap: 0.5rem;
}
.header h1 {
  margin: 0;
  font-size: 1.25rem;
}
.page-hint {
  margin: -0.75rem 0 1.25rem;
  font-size: 0.8125rem;
  color: var(--muted, #6b7280);
  line-height: 1.45;
}
.error-banner {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: var(--danger);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
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
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.profile-view dl {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.5rem 1rem;
  margin: 1rem 0;
}
.profile-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 1rem 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-label {
  font-weight: 600;
  color: #374151;
  font-size: 0.875rem;
}
.field-input {
  font-family: inherit;
  font-size: 0.95rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  resize: vertical;
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
.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.confirmed-banner {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
}
</style>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
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

type ArrayField = "culture" | "companyDirection" | "policies" | "workFormat" | "onboardingApproach";

type ProfileSection = {
  field: ArrayField;
  title: string;
  description?: string;
};

const profileSections: ProfileSection[] = [
  {
    field: "culture",
    title: "Культура",
    description: "Як прийнято взаємодіяти в команді",
  },
  {
    field: "companyDirection",
    title: "Напрям компанії",
    description: "Ринок і фокус продуктів",
  },
  {
    field: "policies",
    title: "Політики",
    description: "Правила, які важливо знати кандидату",
  },
  { field: "workFormat", title: "Формат роботи" },
  { field: "onboardingApproach", title: "Онбординг" },
];

const editingSections = reactive<Record<ArrayField, boolean>>({
  culture: false,
  companyDirection: false,
  policies: false,
  workFormat: false,
  onboardingApproach: false,
});

function resetEditingSections(): void {
  for (const section of profileSections) {
    editingSections[section.field] = false;
  }
}

function toggleSectionEdit(field: ArrayField): void {
  editingSections[field] = !editingSections[field];
}

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
  resetEditingSections();
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
        <template v-if="editableProfile">
          <div class="company-hero">
            <p class="eyebrow">Компанія</p>
            <input
              class="name-input"
              type="text"
              :value="editableProfile.companyName ?? ''"
              aria-label="Назва компанії"
              @input="onCompanyNameInput"
            />
          </div>

          <article v-for="section in profileSections" :key="section.field" class="section">
            <div class="section-head">
              <h3>{{ section.title }}</h3>
              <button type="button" class="btn-ghost" @click="toggleSectionEdit(section.field)">
                {{ editingSections[section.field] ? "Готово" : "Редагувати" }}
              </button>
            </div>
            <p v-if="section.description" class="section-desc">{{ section.description }}</p>
            <ul v-if="!editingSections[section.field]" class="bullet-list">
              <li v-for="(item, i) in editableProfile[section.field]" :key="i">{{ item }}</li>
              <li v-if="editableProfile[section.field].length === 0" class="empty">Порожньо</li>
            </ul>
            <textarea
              v-else
              class="section-input"
              rows="4"
              :value="getArrayField(section.field)"
              @input="onArrayFieldInput(section.field, $event)"
            />
          </article>
        </template>

        <template v-else>
          <div class="company-hero">
            <p class="eyebrow">Компанія</p>
            <p class="name">{{ profile.companyName?.trim() || "Компанія" }}</p>
          </div>
          <article v-for="section in profileSections" :key="section.field" class="section">
            <div class="section-head">
              <h3>{{ section.title }}</h3>
            </div>
            <p v-if="section.description" class="section-desc">{{ section.description }}</p>
            <ul class="bullet-list">
              <li v-for="(item, i) in profile[section.field]" :key="i">{{ item }}</li>
            </ul>
          </article>
        </template>

        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>

        <div class="actions">
          <button type="button" class="btn-secondary" @click="backToChat">← Назад до чату</button>
          <button type="button" class="btn-secondary" @click="deleteChat">
            Видалити чат
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="saving || !editableProfile"
            @click="onSaveProfileEdits"
          >
            {{ saving ? "Збереження…" : "Зберегти зміни" }}
          </button>
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
  margin-left: 2cm;
  font-size: 1.0625rem;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  gap: 0.5rem;
}
.header .btn-secondary {
  margin-right: 4cm;
}
.header h1 {
  margin: 0;
  font-size: 1.25em;
}
.page-hint {
  margin: -0.75rem 0 1.25rem;
  font-size: 0.8125em;
  color: var(--muted, #6b7280);
  line-height: 1.45;
}
.error-banner {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: var(--danger);
  border-radius: 0.375rem;
  font-size: 0.875em;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875em;
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
.btn-ghost {
  font-family: inherit;
  background: transparent;
  color: var(--accent);
  border: none;
  padding: 0.25rem 0.4rem;
  font-size: 0.8125em;
  font-weight: 500;
  cursor: pointer;
}
.btn-ghost:hover {
  text-decoration: underline;
}
.profile-view {
  max-width: 28rem;
}
.company-hero {
  margin-bottom: 0.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.eyebrow {
  margin: 0 0 0.25rem;
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  font-weight: 600;
}
.name {
  margin: 0;
  font-size: 1.5em;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.name-input {
  font-family: inherit;
  font-size: 1.5em;
  font-weight: 600;
  letter-spacing: -0.02em;
  border: none;
  border-bottom: 2px solid var(--accent-border);
  background: transparent;
  width: 100%;
  max-width: 28rem;
  padding: 0.15rem 0;
  color: var(--text);
}
.name-input:focus {
  outline: none;
  border-bottom-color: var(--accent);
}
.section {
  padding: 0.9rem 0;
  border-bottom: 1px solid var(--border);
}
.section:last-of-type {
  border-bottom: none;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.45rem;
}
.section-head h3 {
  margin: 0;
  font-size: 1em;
  font-weight: 600;
}
.section-desc {
  margin: 0 0 0.65rem;
  font-size: 0.8125em;
  color: var(--muted);
}
.bullet-list {
  margin: 0;
  padding-left: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.bullet-list li {
  font-size: 1em;
  line-height: 1.45;
  color: #1f2937;
}
.bullet-list .empty {
  list-style: none;
  margin-left: -1.15rem;
  color: var(--muted);
  font-style: italic;
}
.section-input {
  width: 100%;
  font-family: inherit;
  font-size: 1em;
  line-height: 1.45;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--accent-border);
  border-radius: var(--radius);
  background: var(--accent-soft);
  resize: vertical;
  color: var(--text);
}
.section-input:focus {
  outline: 2px solid var(--accent-focus);
  outline-offset: 1px;
}
.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 1.25rem;
}
</style>

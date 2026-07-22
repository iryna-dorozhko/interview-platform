<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { fetchVacancy } from "../api/vacancies";
import {
  confirmPrepProfile,
  deletePrepChat,
  fetchPrepState,
  finishPrepChat,
  sendPrepMessage,
  updatePrepProfile,
  type CompanyProfile,
} from "../api/prep";
import { usePrepChat } from "../composables/usePrepChat";
import PrepChatPanel from "../components/PrepChatPanel.vue";

const route = useRoute();
const router = useRouter();
const vacancyId = computed(() => String(route.params.id));

const title = ref("");
const missingCompanyProfile = ref(false);
const viewingHistory = ref(false);
const vacancyStatus = ref<string | null>(null);

const editableProfile = ref<CompanyProfile | null>(null);
const canEditProfile = ref(true);
const editingConfirmed = ref(false);
const saving = ref(false);
const confirming = ref(false);

type ArrayProfileField = keyof Pick<
  CompanyProfile,
  | "expectations"
  | "culture"
  | "companyDirection"
  | "policies"
  | "workFormat"
  | "onboardingApproach"
  | "workConditions"
>;

type VacancySectionId =
  | "critical"
  | "desired"
  | ArrayProfileField
  | "compensation";

type VacancySection = {
  id: VacancySectionId;
  title: string;
  description?: string;
  kind: "list" | "text";
};

const vacancySections: VacancySection[] = [
  {
    id: "critical",
    title: "Критичні вимоги",
    description: "Без чого кандидат не підійде",
    kind: "list",
  },
  {
    id: "desired",
    title: "Бажані вимоги",
    description: "Буде плюсом, але не обов’язково",
    kind: "list",
  },
  { id: "expectations", title: "Очікування", kind: "list" },
  { id: "compensation", title: "Зарплата", kind: "text" },
  {
    id: "workConditions",
    title: "Умови роботи",
    description: "Один пункт на рядок, можна з префіксами",
    kind: "list",
  },
  { id: "culture", title: "Культура", kind: "list" },
  { id: "companyDirection", title: "Напрям компанії", kind: "list" },
  { id: "policies", title: "Політики", kind: "list" },
  { id: "workFormat", title: "Формат роботи", kind: "list" },
  { id: "onboardingApproach", title: "Онбординг", kind: "list" },
];

const editingSections = reactive<Record<VacancySectionId, boolean>>({
  critical: false,
  desired: false,
  expectations: false,
  compensation: false,
  workConditions: false,
  culture: false,
  companyDirection: false,
  policies: false,
  workFormat: false,
  onboardingApproach: false,
});

const isProfileEditable = computed(
  () =>
    !!editableProfile.value &&
    !!profile.value &&
    (!profile.value.confirmedAt || editingConfirmed.value),
);

function resetEditingSections(): void {
  for (const section of vacancySections) {
    editingSections[section.id] = false;
  }
}

function toggleSectionEdit(id: VacancySectionId): void {
  editingSections[id] = !editingSections[id];
}

function textToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function syncEditableProfile(next: CompanyProfile | null): void {
  if (!next) {
    editableProfile.value = null;
    resetEditingSections();
    return;
  }
  editableProfile.value = {
    ...next,
    requirements: {
      critical: next.requirements?.critical ?? [],
      desired: next.requirements?.desired ?? [],
    },
    workConditions: next.workConditions ?? [],
    compensation: next.compensation ?? null,
  };
  resetEditingSections();
}

const chat = usePrepChat<CompanyProfile>({
  adapters: {
    loadState: async () => {
      const [vacancy, state] = await Promise.all([
        fetchVacancy(vacancyId.value),
        fetchPrepState(vacancyId.value),
      ]);
      title.value = vacancy.title;
      canEditProfile.value = state.canEditProfile;
      editingConfirmed.value = false;
      missingCompanyProfile.value = state.missingCompanyProfile;
      viewingHistory.value = false;
      return {
        messages: state.messages,
        isClosed: state.isClosed,
        profile: state.profile,
      };
    },
    sendMessage: (text) => sendPrepMessage(vacancyId.value, text),
    finishChat: () => finishPrepChat(vacancyId.value),
    deleteChat: () => deletePrepChat(vacancyId.value),
    isUserMessage: (msg) => msg.authorType === "HUMAN_HR",
    humanAuthorType: "HUMAN_HR",
    agentAuthorType: "AGENT_COMPANY",
  },
  shouldAutoGreet: (state) =>
    !missingCompanyProfile.value && !state.isClosed && state.messages.length === 0,
  onFinished: () => {
    viewingHistory.value = false;
  },
  onDeleted: () => {
    editableProfile.value = null;
    resetEditingSections();
    viewingHistory.value = false;
    vacancyStatus.value = null;
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

function setMessagesEl(el: HTMLElement | null): void {
  messagesEl.value = el;
}

function setInput(value: string): void {
  input.value = value;
}

function setCompensationDisplayText(text: string): void {
  if (!editableProfile.value) return;
  editableProfile.value.compensation = { displayText: text.trim() };
}

function displayProfile(): CompanyProfile | null {
  return isProfileEditable.value ? editableProfile.value : profile.value;
}

function getSectionList(id: VacancySectionId): string[] {
  const source = displayProfile();
  if (!source) return [];
  if (id === "critical") return source.requirements.critical ?? [];
  if (id === "desired") return source.requirements.desired ?? [];
  if (id === "compensation") return [];
  return source[id];
}

function getSectionText(id: VacancySectionId): string {
  const source = displayProfile();
  if (!source) return "";
  if (id === "compensation") return source.compensation?.displayText ?? "";
  if (id === "critical") return (source.requirements.critical ?? []).join("\n");
  if (id === "desired") return (source.requirements.desired ?? []).join("\n");
  return source[id].join("\n");
}

function onRequirementsInput(kind: "critical" | "desired", event: Event): void {
  if (!editableProfile.value) return;
  const lines = textToArray((event.target as HTMLTextAreaElement).value);
  editableProfile.value.requirements = {
    ...editableProfile.value.requirements,
    [kind]: lines,
  };
}

function setArrayField(field: ArrayProfileField, text: string): void {
  if (!editableProfile.value) return;
  editableProfile.value[field] = textToArray(text);
}

function onSectionListInput(id: VacancySectionId, event: Event): void {
  if (!editableProfile.value) return;
  const text = (event.target as HTMLTextAreaElement).value;
  if (id === "critical") {
    onRequirementsInput("critical", event);
    return;
  }
  if (id === "desired") {
    onRequirementsInput("desired", event);
    return;
  }
  if (id === "compensation") return;
  setArrayField(id, text);
}

function onSectionTextInput(id: VacancySectionId, event: Event): void {
  if (id === "compensation") {
    setCompensationDisplayText((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }
}

function onRoleInput(event: Event): void {
  if (!editableProfile.value) return;
  editableProfile.value.role = (event.target as HTMLInputElement).value;
}

watch(profile, (next) => {
  if (next && (!next.confirmedAt || editingConfirmed.value)) {
    syncEditableProfile(next);
  } else if (!next) {
    editableProfile.value = null;
    resetEditingSections();
  }
});

function startEditingConfirmed(): void {
  if (!profile.value?.confirmedAt || !canEditProfile.value) return;
  errorMessage.value = null;
  editingConfirmed.value = true;
  syncEditableProfile(profile.value);
}

function cancelEditingConfirmed(): void {
  editingConfirmed.value = false;
  editableProfile.value = null;
  resetEditingSections();
  errorMessage.value = null;
}

async function onSaveProfileEdits(): Promise<void> {
  if (!editableProfile.value) return;
  saving.value = true;
  errorMessage.value = null;
  try {
    const { profile: updated } = await updatePrepProfile(vacancyId.value, {
      role: editableProfile.value.role,
      requirements: editableProfile.value.requirements,
      expectations: editableProfile.value.expectations,
      culture: editableProfile.value.culture,
      companyDirection: editableProfile.value.companyDirection,
      policies: editableProfile.value.policies,
      workFormat: editableProfile.value.workFormat,
      onboardingApproach: editableProfile.value.onboardingApproach,
      workConditions: editableProfile.value.workConditions,
      compensation: editableProfile.value.compensation,
    });
    profile.value = updated;
    if (updated.confirmedAt) {
      editingConfirmed.value = false;
      editableProfile.value = null;
      resetEditingSections();
    } else {
      syncEditableProfile(updated);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося оновити профіль";
  } finally {
    saving.value = false;
  }
}

async function onConfirmProfile(): Promise<void> {
  if (
    !window.confirm(
      "Профіль буде опубліковано для співбесід і матчінгу. Підтвердити?"
    )
  ) {
    return;
  }

  errorMessage.value = null;
  confirming.value = true;
  try {
    const response = await confirmPrepProfile(vacancyId.value);
    profile.value = response.profile;
    editingConfirmed.value = false;
    editableProfile.value = null;
    resetEditingSections();
    vacancyStatus.value = response.vacancyStatus;
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
      <h1>Анкета: {{ title || "…" }}</h1>
      <button type="button" class="btn-secondary" @click="goHome">← До списку анкет</button>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else>
      <section v-if="missingCompanyProfile" class="gate-banner">
        <p>Спочатку заповніть профіль компанії.</p>
        <RouterLink to="/company-profile" class="btn-primary">Перейти до профілю компанії</RouterLink>
      </section>

      <section v-else-if="isClosed && profile && !viewingHistory" class="profile-view">
        <div class="company-hero">
          <p class="eyebrow">Посада</p>
          <input
            v-if="isProfileEditable && editableProfile"
            class="name-input"
            type="text"
            :value="editableProfile.role"
            aria-label="Посада"
            @input="onRoleInput"
          />
          <p v-else class="name">{{ profile.role }}</p>
        </div>

        <article v-for="section in vacancySections" :key="section.id" class="section">
          <div class="section-head">
            <h3>{{ section.title }}</h3>
            <button
              v-if="isProfileEditable"
              type="button"
              class="btn-ghost"
              @click="toggleSectionEdit(section.id)"
            >
              {{ editingSections[section.id] ? "Готово" : "Редагувати" }}
            </button>
          </div>
          <p v-if="section.description" class="section-desc">{{ section.description }}</p>

          <template v-if="section.kind === 'text'">
            <p v-if="!editingSections[section.id] || !isProfileEditable" class="text-value">
              {{ getSectionText(section.id) || "не вказано" }}
            </p>
            <textarea
              v-else
              class="section-input"
              rows="2"
              :value="getSectionText(section.id)"
              @input="onSectionTextInput(section.id, $event)"
            />
          </template>
          <template v-else>
            <ul v-if="!editingSections[section.id] || !isProfileEditable" class="bullet-list">
              <li v-for="(item, i) in getSectionList(section.id)" :key="i">{{ item }}</li>
              <li v-if="getSectionList(section.id).length === 0" class="empty">Порожньо</li>
            </ul>
            <textarea
              v-else
              class="section-input"
              rows="4"
              :value="getSectionText(section.id)"
              @input="onSectionListInput(section.id, $event)"
            />
          </template>
        </article>

        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>

        <p
          v-if="profile.confirmedAt && !editingConfirmed && vacancyStatus === 'CONFIRMED'"
          class="confirmed-banner"
        >
          ✓ Анкета підтверджена
        </p>
        <p
          v-else-if="profile.confirmedAt && !editingConfirmed"
          class="confirmed-banner"
        >
          ✓ Підтверджено {{ profile.confirmedAt ? new Date(profile.confirmedAt).toLocaleString("uk-UA") : "" }}
        </p>

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
            v-if="!profile.confirmedAt"
            type="button"
            class="btn-secondary"
            :disabled="saving"
            @click="onSaveProfileEdits"
          >
            {{ saving ? "Збереження…" : "Зберегти зміни" }}
          </button>
          <button
            v-if="!profile.confirmedAt"
            type="button"
            class="btn-primary"
            :disabled="confirming"
            @click="onConfirmProfile"
          >
            Підтвердити профіль
          </button>
          <template v-else-if="editingConfirmed">
            <button
              type="button"
              class="btn-secondary"
              :disabled="saving"
              @click="cancelEditingConfirmed"
            >
              Скасувати
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="saving"
              @click="onSaveProfileEdits"
            >
              {{ saving ? "Збереження…" : "Зберегти зміни" }}
            </button>
          </template>
          <button
            v-else
            type="button"
            class="btn-secondary"
            :disabled="!canEditProfile"
            :title="
              canEditProfile
                ? ''
                : 'Неможливо змінити анкету: є активна співбесіда (READY/LIVE).'
            "
            @click="startEditingConfirmed"
          >
            Змінити
          </button>
        </div>
        <p v-if="profile.confirmedAt && !editingConfirmed && !canEditProfile" class="hint">
          Неможливо змінити анкету: є активна співбесіда (READY/LIVE).
        </p>
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
  font-size: 1.0625rem;
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
  font-size: 1.25em;
}
.gate-banner {
  padding: 1rem;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.gate-banner p {
  margin: 0;
  color: #92400e;
}
.gate-banner .btn-primary {
  align-self: flex-start;
  text-decoration: none;
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
.text-value {
  margin: 0;
  font-size: 1em;
  line-height: 1.45;
  color: #1f2937;
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
.confirmed-banner {
  margin: 1.25rem 0 0;
  padding: 0.5rem 0.75rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  font-size: 0.875em;
  font-weight: 600;
}
.confirmed-banner + .actions {
  margin-top: 0.75rem;
}
.hint {
  margin: 0.5rem 0 0;
  font-size: 0.875em;
  color: var(--color-text-muted, #64748b);
}
</style>

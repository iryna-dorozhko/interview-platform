<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
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
  type PrepMessage,
} from "../api/prep";

const route = useRoute();
const router = useRouter();
const vacancyId = computed(() => String(route.params.id));

const title = ref("");
const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const messages = ref<PrepMessage[]>([]);
const isClosed = ref(false);
const profile = ref<CompanyProfile | null>(null);
const missingCompanyProfile = ref(false);
const viewingHistory = ref(false);
const vacancyStatus = ref<string | null>(null);

const editableProfile = ref<CompanyProfile | null>(null);
const saving = ref(false);

const input = ref("");
const sending = ref(false);
const confirming = ref(false);
const lastReadyForConfirmation = ref(false);
const messagesEl = ref<HTMLElement | null>(null);

function textToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function syncEditableProfile(next: CompanyProfile | null): void {
  if (!next) {
    editableProfile.value = null;
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
}

function getCompensationDisplayText(): string {
  return editableProfile.value?.compensation?.displayText ?? "";
}

function setCompensationDisplayText(text: string): void {
  if (!editableProfile.value) return;
  editableProfile.value.compensation = { displayText: text.trim() };
}

watch(profile, (next) => {
  if (next && !next.confirmedAt) {
    syncEditableProfile(next);
  } else if (!next) {
    editableProfile.value = null;
  }
});

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function loadPrepState(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    const [vacancy, state] = await Promise.all([
      fetchVacancy(vacancyId.value),
      fetchPrepState(vacancyId.value),
    ]);
    title.value = vacancy.title;
    messages.value = state.messages;
    isClosed.value = state.isClosed;
    profile.value = state.profile;
    missingCompanyProfile.value = state.missingCompanyProfile;
    viewingHistory.value = false;
    loadState.value = "ready";

    if (
      !state.missingCompanyProfile &&
      !state.isClosed &&
      state.messages.length === 0
    ) {
      await triggerGreeting();
    }
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завантажити анкету";
  }
}

async function triggerGreeting(): Promise<void> {
  sending.value = true;
  try {
    const response = await sendPrepMessage(vacancyId.value);
    messages.value.push({
      id: `local_${Date.now()}`,
      authorType: "AGENT_COMPANY",
      content: response.message,
      createdAt: new Date().toISOString(),
    });
    lastReadyForConfirmation.value = response.readyForConfirmation;
    await scrollToBottom();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
  } finally {
    sending.value = false;
  }
}

async function sendMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || sending.value) return;

  errorMessage.value = null;
  input.value = "";
  messages.value.push({
    id: `local_${Date.now()}`,
    authorType: "HUMAN_HR",
    content: text,
    createdAt: new Date().toISOString(),
  });
  await scrollToBottom();

  sending.value = true;
  try {
    const response = await sendPrepMessage(vacancyId.value, text);
    messages.value.push({
      id: `local_${Date.now()}_reply`,
      authorType: "AGENT_COMPANY",
      content: response.message,
      createdAt: new Date().toISOString(),
    });
    lastReadyForConfirmation.value = response.readyForConfirmation;
    await scrollToBottom();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
  } finally {
    sending.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
}

async function onDeleteChat(): Promise<void> {
  if (!window.confirm("Видалити всю історію чату? Цю дію не можна скасувати.")) return;

  errorMessage.value = null;
  try {
    await deletePrepChat(vacancyId.value);
    messages.value = [];
    isClosed.value = false;
    profile.value = null;
    editableProfile.value = null;
    viewingHistory.value = false;
    lastReadyForConfirmation.value = false;
    vacancyStatus.value = null;
    if (!missingCompanyProfile.value) {
      await triggerGreeting();
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
}

async function onFinishChat(): Promise<void> {
  if (!lastReadyForConfirmation.value) {
    const proceed = window.confirm("Даних може бути недостатньо. Все одно завершити й сформувати профіль?");
    if (!proceed) return;
  }

  errorMessage.value = null;
  sending.value = true;
  try {
    const response = await finishPrepChat(vacancyId.value);
    profile.value = response.profile;
    syncEditableProfile(response.profile);
    isClosed.value = true;
    viewingHistory.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завершити чат";
  } finally {
    sending.value = false;
  }
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
    syncEditableProfile(updated);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося оновити профіль";
  } finally {
    saving.value = false;
  }
}

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

function getArrayField(field: ArrayProfileField): string {
  return editableProfile.value?.[field].join("\n") ?? "";
}

function onArrayFieldInput(field: ArrayProfileField, event: Event): void {
  setArrayField(field, (event.target as HTMLTextAreaElement).value);
}

async function onConfirmProfile(): Promise<void> {
  if (
    !window.confirm(
      "Профіль буде зафіксовано. Подальше редагування стане неможливим. Підтвердити?"
    )
  ) {
    return;
  }

  errorMessage.value = null;
  confirming.value = true;
  try {
    const response = await confirmPrepProfile(vacancyId.value);
    profile.value = response.profile;
    editableProfile.value = null;
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

onMounted(loadPrepState);
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
        <p>Спочатку заповніть і підтвердіть профіль компанії.</p>
        <RouterLink to="/company-profile" class="btn-primary">Перейти до профілю компанії</RouterLink>
      </section>

      <section v-else-if="isClosed && profile && !viewingHistory" class="profile-view">
        <h2>Зібраний профіль вакансії</h2>

        <form v-if="!profile.confirmedAt && editableProfile" class="profile-form" @submit.prevent="onSaveProfileEdits">
          <label class="field">
            <span class="field-label">Посада</span>
            <input v-model="editableProfile.role" type="text" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">Критичні вимоги</span>
            <textarea
              class="field-input"
              rows="3"
              :value="(editableProfile.requirements.critical ?? []).join('\n')"
              @input="onRequirementsInput('critical', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">Бажані вимоги</span>
            <textarea
              class="field-input"
              rows="3"
              :value="(editableProfile.requirements.desired ?? []).join('\n')"
              @input="onRequirementsInput('desired', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">Очікування</span>
            <textarea
              class="field-input"
              rows="3"
              :value="getArrayField('expectations')"
              @input="onArrayFieldInput('expectations', $event)"
            />
          </label>
          <h3 class="section-heading">Умови роботи</h3>
          <label class="field">
            <span class="field-label">Зарплата</span>
            <input
              type="text"
              class="field-input"
              :value="getCompensationDisplayText()"
              @input="setCompensationDisplayText(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="field">
            <span class="field-label">Умови (один пункт на рядок, з префіксами)</span>
            <textarea
              class="field-input"
              rows="6"
              :value="getArrayField('workConditions')"
              @input="onArrayFieldInput('workConditions', $event)"
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
          <dt>Посада</dt>
          <dd>{{ profile.role }}</dd>
          <dt>Критичні вимоги</dt>
          <dd><ul><li v-for="(item, i) in profile.requirements.critical" :key="'c' + i">{{ item }}</li></ul></dd>
          <dt>Бажані вимоги</dt>
          <dd><ul><li v-for="(item, i) in profile.requirements.desired" :key="'d' + i">{{ item }}</li></ul></dd>
          <dt>Очікування</dt>
          <dd><ul><li v-for="(item, i) in profile.expectations" :key="i">{{ item }}</li></ul></dd>
          <dt>Зарплата</dt>
          <dd>{{ profile.compensation?.displayText ?? "не вказано" }}</dd>
          <dt>Умови роботи</dt>
          <dd><ul><li v-for="(item, i) in profile.workConditions" :key="i">{{ item }}</li></ul></dd>
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
            @click="onDeleteChat"
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
          <p v-else-if="vacancyStatus === 'CONFIRMED'" class="confirmed-banner">
            ✓ Анкета підтверджена
          </p>
          <p v-else class="confirmed-banner">
            ✓ Підтверджено {{ profile.confirmedAt ? new Date(profile.confirmedAt).toLocaleString("uk-UA") : "" }}
          </p>
        </div>
      </section>

      <section v-else class="chat-view">
        <div class="chat-header">
          <h2>Чат з Company Agent</h2>
          <div class="chat-actions">
            <button type="button" class="btn-secondary" :disabled="sending" @click="onDeleteChat">
              Видалити чат
            </button>
            <button
              v-if="!isClosed"
              type="button"
              class="btn-primary"
              :disabled="sending"
              @click="onFinishChat"
            >
              Завершити чат
            </button>
            <button v-else type="button" class="btn-secondary" @click="backToProfile">
              Показати профіль
            </button>
          </div>
        </div>

        <div ref="messagesEl" class="messages" role="log" aria-live="polite">
          <div
            v-for="message in messages"
            :key="message.id"
            class="message"
            :class="message.authorType === 'HUMAN_HR' ? 'user' : 'assistant'"
          >
            <span class="message-label">{{ message.authorType === "HUMAN_HR" ? "Ви" : "Агент" }}</span>
            <p class="message-text">{{ message.content }}</p>
          </div>
          <p v-if="sending" class="thinking">Думаю…</p>
        </div>

        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>

        <form v-if="!isClosed" class="composer" @submit.prevent="sendMessage">
          <textarea
            v-model="input"
            class="composer-input"
            rows="2"
            placeholder="Напишіть відповідь…"
            :disabled="sending"
            @keydown="onKeydown"
          />
          <button type="submit" class="btn-primary" :disabled="sending || !input.trim()">
            Надіслати
          </button>
        </form>
      </section>
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
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  gap: 0.5rem;
}
.chat-actions {
  display: flex;
  gap: 0.5rem;
}
.messages {
  max-height: calc(100vh - 14rem);
  min-height: 20rem;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: #fafafa;
  margin-bottom: 0.75rem;
}
.message {
  margin-bottom: 0.75rem;
  max-width: 85%;
}
.message.user {
  margin-left: auto;
  text-align: right;
}
.message.assistant {
  margin-right: auto;
  text-align: left;
}
.message-label {
  display: block;
  font-size: 0.75rem;
  color: #666;
  margin-bottom: 0.25rem;
}
.message-text {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  white-space: pre-wrap;
  word-break: break-word;
  display: inline-block;
}
.message.user .message-text {
  background: var(--accent-soft);
  color: var(--accent);
}
.message.assistant .message-text {
  background: #e5e7eb;
  color: #1f2937;
}
.thinking {
  margin: 0;
  color: #666;
  font-size: 0.875rem;
  font-style: italic;
}
.error-banner {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: var(--danger);
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.composer {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}
.composer-input {
  flex: 1;
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  resize: vertical;
  min-height: 2.5rem;
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
.profile-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 1rem 0;
}
.section-heading {
  margin: 0.5rem 0 0;
  font-size: 1rem;
  font-weight: 600;
  color: #374151;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field-label {
  font-weight: 600;
  color: #374151;
  font-size: 0.875rem;
}
.field-input {
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  resize: vertical;
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

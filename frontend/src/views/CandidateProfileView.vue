<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchCandidateQuestionnaire, startCandidateQuestionnaire, type CandidateInterview } from "../api/candidate-interview";
import {
  confirmCandidatePrepProfile,
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  updateCandidatePrepProfile,
  type CandidatePrepState,
  type CandidateProfile,
} from "../api/candidate-prep";
import CandidatePrepChat from "../components/CandidatePrepChat.vue";
import PrepChatPanel from "../components/PrepChatPanel.vue";
import type { PrepChatMessage } from "../composables/usePrepChat";

const router = useRouter();

type LoadState = "loading" | "ready" | "error";

type CandidateSectionId = "phone" | "experience" | "skillsStrong" | "skillsGrowth" | "goals" | "summary";

type CandidateSection = {
  id: CandidateSectionId;
  title: string;
  kind: "list" | "text";
};

const candidateSections: CandidateSection[] = [
  { id: "phone", title: "Телефон", kind: "text" },
  { id: "experience", title: "Досвід", kind: "list" },
  { id: "skillsStrong", title: "Сильні навички", kind: "list" },
  { id: "skillsGrowth", title: "Зони росту", kind: "list" },
  { id: "goals", title: "Цілі", kind: "list" },
  { id: "summary", title: "Резюме", kind: "text" },
];

const editingSections = reactive<Record<CandidateSectionId, boolean>>({
  phone: false,
  experience: false,
  skillsStrong: false,
  skillsGrowth: false,
  goals: false,
  summary: false,
});

const interview = ref<CandidateInterview | null>(null);
const prepState = ref<CandidatePrepState | null>(null);
const editableProfile = ref<CandidateProfile | null>(null);
const loadState = ref<LoadState>("loading");
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const showPrepChat = ref(false);
const viewingHistory = ref(false);
const confirming = ref(false);
const saving = ref(false);
const starting = ref(false);

const profile = computed((): CandidateProfile | null => prepState.value?.profile ?? null);
const messageCount = computed(() => prepState.value?.messages.length ?? 0);
const isClosed = computed(() => prepState.value?.isClosed ?? false);
const hasMessages = computed(() => messageCount.value > 0);
const isConfirmed = computed(() => !!profile.value?.confirmedAt);

function resetEditingSections(): void {
  for (const section of candidateSections) {
    editingSections[section.id] = false;
  }
}

function toggleSectionEdit(id: CandidateSectionId): void {
  editingSections[id] = !editingSections[id];
}

function syncEditableFromState(): void {
  const next = prepState.value?.profile ?? null;
  editableProfile.value =
    next && !next.confirmedAt
      ? {
          ...next,
          skills: { strong: [...next.skills.strong], growth: [...next.skills.growth] },
          experience: [...next.experience],
          goals: [...next.goals],
        }
      : null;
  resetEditingSections();
}

function textToArray(text: string): string[] {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function displayProfile(): CandidateProfile | null {
  return editableProfile.value ?? profile.value;
}

function getSectionList(id: CandidateSectionId): string[] {
  const source = displayProfile();
  if (!source) return [];
  if (id === "experience") return source.experience;
  if (id === "skillsStrong") return source.skills.strong;
  if (id === "skillsGrowth") return source.skills.growth;
  if (id === "goals") return source.goals;
  return [];
}

function getSectionText(id: CandidateSectionId): string {
  const source = displayProfile();
  if (!source) return "";
  if (id === "phone") return source.phone ?? "";
  if (id === "summary") return source.summary;
  return getSectionList(id).join("\n");
}

function onSectionListInput(id: CandidateSectionId, event: Event): void {
  if (!editableProfile.value) return;
  const lines = textToArray((event.target as HTMLTextAreaElement).value);
  if (id === "experience") editableProfile.value.experience = lines;
  if (id === "skillsStrong") editableProfile.value.skills.strong = lines;
  if (id === "skillsGrowth") editableProfile.value.skills.growth = lines;
  if (id === "goals") editableProfile.value.goals = lines;
}

function onSectionTextInput(id: CandidateSectionId, event: Event): void {
  if (!editableProfile.value) return;
  const value = (event.target as HTMLTextAreaElement | HTMLInputElement).value;
  if (id === "phone") editableProfile.value.phone = value || null;
  if (id === "summary") editableProfile.value.summary = value;
}

function onFullNameInput(event: Event): void {
  if (!editableProfile.value) return;
  editableProfile.value.fullName = (event.target as HTMLInputElement).value;
}

function onEmailInput(event: Event): void {
  if (!editableProfile.value) return;
  editableProfile.value.email = (event.target as HTMLInputElement).value;
}

function formatConfirmedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("uk-UA");
}

async function loadProfile(): Promise<void> {
  loadState.value = "loading";
  loadError.value = null;
  viewingHistory.value = false;
  try {
    interview.value = await fetchCandidateQuestionnaire();
    if (interview.value) {
      prepState.value = await fetchCandidatePrepState(interview.value.id);
    } else {
      prepState.value = null;
    }
    syncEditableFromState();
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value = error instanceof Error ? error.message : "Не вдалося завантажити дані";
  }
}

async function startPrepChat(): Promise<void> {
  if (interview.value) {
    showPrepChat.value = true;
    return;
  }

  actionError.value = null;
  starting.value = true;
  try {
    interview.value = await startCandidateQuestionnaire();
    showPrepChat.value = true;
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "Не вдалося створити анкету";
  } finally {
    starting.value = false;
  }
}

async function onPrepFinished(): Promise<void> {
  showPrepChat.value = false;
  await loadProfile();
}

async function onPrepDeleted(): Promise<void> {
  await loadProfile();
}

async function onSaveProfileEdits(): Promise<void> {
  if (!interview.value || !editableProfile.value) return;
  actionError.value = null;
  saving.value = true;
  try {
    const { profile: updated } = await updateCandidatePrepProfile(interview.value.id, {
      fullName: editableProfile.value.fullName,
      email: editableProfile.value.email,
      phone: editableProfile.value.phone,
      experience: editableProfile.value.experience,
      skills: editableProfile.value.skills,
      goals: editableProfile.value.goals,
      summary: editableProfile.value.summary,
    });
    if (prepState.value) {
      prepState.value = { ...prepState.value, profile: updated };
    }
    syncEditableFromState();
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "Не вдалося зберегти профіль";
  } finally {
    saving.value = false;
  }
}

async function onConfirmProfile(): Promise<void> {
  if (!interview.value) return;
  if (
    !window.confirm(
      "Профіль буде зафіксовано. Подальше редагування стане неможливим. Підтвердити?",
    )
  ) {
    return;
  }
  actionError.value = null;
  confirming.value = true;
  try {
    await confirmCandidatePrepProfile(interview.value.id);
    await loadProfile();
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "Не вдалося підтвердити профіль";
  } finally {
    confirming.value = false;
  }
}

async function onDeletePrep(): Promise<void> {
  if (!interview.value) return;
  if (!window.confirm("Видалити всю історію чату? Цю дію не можна скасувати.")) return;
  actionError.value = null;
  try {
    await deleteCandidatePrepChat(interview.value.id);
    await loadProfile();
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
}

async function onRestartConfirmed(): Promise<void> {
  if (!interview.value) return;
  if (
    !window.confirm(
      "Підтверджений профіль буде видалено. Доведеться пройти анкету заново. Продовжити?",
    )
  ) {
    return;
  }
  actionError.value = null;
  try {
    await deleteCandidatePrepChat(interview.value.id);
    viewingHistory.value = false;
    showPrepChat.value = true;
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
}

function backToChat(): void {
  viewingHistory.value = true;
}

function backToProfile(): void {
  viewingHistory.value = false;
}

function isPrepUserMessage(msg: PrepChatMessage): boolean {
  return msg.authorType === "HUMAN_CANDIDATE";
}

function openMatches(): void {
  router.push({ name: "candidate-matches" });
}

onMounted(loadProfile);
</script>

<template>
  <div class="page">
    <h2 class="page-title">Моя анкета</h2>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ loadError }}</p>

    <template v-else>
      <p v-if="actionError" class="error-banner">{{ actionError }}</p>

      <CandidatePrepChat
        v-if="showPrepChat && interview"
        :interview-id="interview.id"
        @finished="onPrepFinished"
        @deleted="onPrepDeleted"
      />

      <template v-else-if="!interview">
        <p class="empty">Анкета ще не створена</p>
        <button type="button" class="btn-primary" :disabled="starting" @click="startPrepChat">
          {{ starting ? "Створення…" : "Створити анкету" }}
        </button>
      </template>

      <template v-else-if="!hasMessages">
        <section class="empty-profile">
          <p>Анкета ще не створена</p>
          <button type="button" class="btn-primary" :disabled="starting" @click="startPrepChat">
            {{ starting ? "Створення…" : "Створити анкету" }}
          </button>
        </section>
      </template>

      <template v-else-if="!isClosed">
        <p class="status">Анкета в процесі ({{ messageCount }} повідомлень)</p>
        <div class="actions">
          <button type="button" class="btn-primary" @click="startPrepChat">Продовжити анкету</button>
          <button type="button" class="btn-secondary" @click="onDeletePrep">Видалити анкету</button>
        </div>
      </template>

      <template v-else-if="viewingHistory && profile && prepState">
        <PrepChatPanel
          title="Чат з Candidate Agent"
          load-state="ready"
          :messages="prepState.messages"
          :sending="false"
          :is-closed="true"
          input=""
          :error-message="null"
          :last-failed-action="null"
          :is-user-message="isPrepUserMessage"
          @update:input="() => undefined"
          @send="() => undefined"
          @retry="() => undefined"
          @finish="() => undefined"
          @delete="() => undefined"
          @keydown="() => undefined"
        >
          <template #actions>
            <button type="button" class="btn-secondary" @click="backToProfile">
              Показати анкету
            </button>
          </template>
        </PrepChatPanel>
      </template>

      <template v-else-if="profile && !isConfirmed && editableProfile">
        <section class="profile-view">
          <div class="company-hero">
            <p class="eyebrow">Кандидат</p>
            <input
              class="name-input"
              type="text"
              :value="editableProfile.fullName"
              aria-label="Ім'я"
              @input="onFullNameInput"
            />
            <label class="contact-field">
              <span class="section-desc">Email</span>
              <input
                class="contact-input"
                type="email"
                :value="editableProfile.email"
                @input="onEmailInput"
              />
            </label>
          </div>

          <article v-for="section in candidateSections" :key="section.id" class="section">
            <div class="section-head">
              <h3>{{ section.title }}</h3>
              <button type="button" class="btn-ghost" @click="toggleSectionEdit(section.id)">
                {{ editingSections[section.id] ? "Готово" : "Редагувати" }}
              </button>
            </div>
            <template v-if="section.kind === 'text'">
              <p v-if="!editingSections[section.id]" class="text-value">
                {{ getSectionText(section.id) || "не вказано" }}
              </p>
              <textarea
                v-else
                class="section-input"
                rows="3"
                :value="getSectionText(section.id)"
                @input="onSectionTextInput(section.id, $event)"
              />
            </template>
            <template v-else>
              <ul v-if="!editingSections[section.id]" class="bullet-list">
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
        </section>
        <div class="actions">
          <button type="button" class="btn-secondary" @click="backToChat">
            ← Назад до чату
          </button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="saving"
            @click="onSaveProfileEdits"
          >
            {{ saving ? "Збереження…" : "Зберегти зміни" }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="confirming || saving"
            @click="onConfirmProfile"
          >
            Підтвердити профіль
          </button>
          <button type="button" class="btn-secondary" @click="onDeletePrep">Видалити анкету</button>
        </div>
      </template>

      <template v-else-if="profile && isConfirmed">
        <section class="profile-view">
          <div class="company-hero">
            <p class="eyebrow">Кандидат</p>
            <p class="name">{{ profile.fullName }}</p>
            <p class="contact-line">{{ profile.email }}</p>
            <p v-if="profile.phone" class="contact-line">{{ profile.phone }}</p>
          </div>
          <article
            v-for="section in candidateSections.filter((s) => s.id !== 'phone')"
            :key="section.id"
            class="section"
          >
            <div class="section-head">
              <h3>{{ section.title }}</h3>
            </div>
            <template v-if="section.kind === 'text'">
              <p class="text-value">{{ getSectionText(section.id) || "не вказано" }}</p>
            </template>
            <ul v-else class="bullet-list">
              <li v-for="(item, i) in getSectionList(section.id)" :key="i">{{ item }}</li>
            </ul>
          </article>
          <p class="confirmed-banner">
            ✓ Підтверджено {{ formatConfirmedAt(profile.confirmedAt) }}
          </p>
        </section>
        <div class="actions">
          <button type="button" class="btn-secondary" @click="backToChat">
            ← Назад до чату
          </button>
          <button type="button" class="btn-primary" @click="openMatches">
            Підібрати вакансію
          </button>
          <button type="button" class="btn-secondary" @click="onRestartConfirmed">Почати заново</button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
.error-banner {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: var(--danger);
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.empty {
  margin: 0 0 1rem;
  color: #555;
}
.status {
  margin: 0 0 1rem;
  color: #555;
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
.btn-ghost {
  font-family: inherit;
  background: transparent;
  color: var(--accent);
  border: none;
  padding: 0.25rem 0.4rem;
  font-size: 0.8125rem;
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
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  font-weight: 600;
}
.name {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.name-input {
  font-family: inherit;
  font-size: 1.5rem;
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
.contact-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.85rem;
}
.contact-input {
  font-family: inherit;
  font-size: 0.9375rem;
  padding: 0.4rem 0;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
}
.contact-input:focus {
  outline: none;
  border-bottom-color: var(--accent);
}
.contact-line {
  margin: 0.35rem 0 0;
  font-size: 0.9375rem;
  color: #374151;
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
  font-size: 0.9375rem;
  font-weight: 600;
}
.section-desc {
  margin: 0 0 0.65rem;
  font-size: 0.75rem;
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
  font-size: 0.9375rem;
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
  font-size: 0.9375rem;
  line-height: 1.45;
  color: #1f2937;
  white-space: pre-wrap;
}
.section-input {
  width: 100%;
  font-family: inherit;
  font-size: 0.9375rem;
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
.confirmed-banner {
  margin: 1rem 0 0;
  padding: 0.5rem 0.75rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 1.25rem;
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
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

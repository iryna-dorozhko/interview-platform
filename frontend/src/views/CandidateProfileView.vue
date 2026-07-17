<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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

type LoadState = "loading" | "ready" | "error";

const interview = ref<CandidateInterview | null>(null);
const prepState = ref<CandidatePrepState | null>(null);
const editableProfile = ref<CandidateProfile | null>(null);
const loadState = ref<LoadState>("loading");
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const showPrepChat = ref(false);
const confirming = ref(false);
const saving = ref(false);
const starting = ref(false);

const profile = computed((): CandidateProfile | null => prepState.value?.profile ?? null);
const messageCount = computed(() => prepState.value?.messages.length ?? 0);
const isClosed = computed(() => prepState.value?.isClosed ?? false);
const hasMessages = computed(() => messageCount.value > 0);
const isConfirmed = computed(() => !!profile.value?.confirmedAt);

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
}

function textToArray(text: string): string[] {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function onPhoneInput(event: Event): void {
  if (!editableProfile.value) return;
  const target = event.target as HTMLInputElement;
  editableProfile.value.phone = target.value || null;
}

function onExperienceInput(event: Event): void {
  if (!editableProfile.value) return;
  const target = event.target as HTMLTextAreaElement;
  editableProfile.value.experience = textToArray(target.value);
}

function onSkillsStrongInput(event: Event): void {
  if (!editableProfile.value) return;
  const target = event.target as HTMLTextAreaElement;
  editableProfile.value.skills.strong = textToArray(target.value);
}

function onSkillsGrowthInput(event: Event): void {
  if (!editableProfile.value) return;
  const target = event.target as HTMLTextAreaElement;
  editableProfile.value.skills.growth = textToArray(target.value);
}

function onGoalsInput(event: Event): void {
  if (!editableProfile.value) return;
  const target = event.target as HTMLTextAreaElement;
  editableProfile.value.goals = textToArray(target.value);
}

function formatConfirmedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("uk-UA");
}

async function loadProfile(): Promise<void> {
  loadState.value = "loading";
  loadError.value = null;
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
    showPrepChat.value = true;
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
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

      <template v-else-if="profile && !isConfirmed && editableProfile">
        <section class="profile-view">
          <h2>Профіль кандидата</h2>
          <form class="profile-form" @submit.prevent="onSaveProfileEdits">
            <h3 class="subsection-title">Контактні дані</h3>
            <label class="field">
              <span class="field-label">Ім'я</span>
              <input v-model="editableProfile.fullName" type="text" class="field-input" />
            </label>
            <label class="field">
              <span class="field-label">Email</span>
              <input v-model="editableProfile.email" type="email" class="field-input" />
            </label>
            <label class="field">
              <span class="field-label">Телефон</span>
              <input
                :value="editableProfile.phone ?? ''"
                type="text"
                class="field-input"
                @input="onPhoneInput"
              />
            </label>
            <h3 class="subsection-title">Анкета</h3>
            <label class="field">
              <span class="field-label">Досвід</span>
              <textarea
                class="field-input"
                rows="3"
                :value="editableProfile.experience.join('\n')"
                @input="onExperienceInput"
              />
            </label>
            <label class="field">
              <span class="field-label">Сильні навички</span>
              <textarea
                class="field-input"
                rows="3"
                :value="editableProfile.skills.strong.join('\n')"
                @input="onSkillsStrongInput"
              />
            </label>
            <label class="field">
              <span class="field-label">Зони росту</span>
              <textarea
                class="field-input"
                rows="3"
                :value="editableProfile.skills.growth.join('\n')"
                @input="onSkillsGrowthInput"
              />
            </label>
            <label class="field">
              <span class="field-label">Цілі</span>
              <textarea
                class="field-input"
                rows="3"
                :value="editableProfile.goals.join('\n')"
                @input="onGoalsInput"
              />
            </label>
            <label class="field">
              <span class="field-label">Резюме</span>
              <textarea v-model="editableProfile.summary" class="field-input" rows="3" />
            </label>
          </form>
        </section>
        <div class="actions">
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
          <h2>Профіль кандидата</h2>
          <h3 class="subsection-title">Контактні дані</h3>
          <dl>
            <dt>Ім'я</dt>
            <dd>{{ profile.fullName }}</dd>
            <dt>Email</dt>
            <dd>{{ profile.email }}</dd>
            <dt>Телефон</dt>
            <dd>{{ profile.phone ?? "—" }}</dd>
          </dl>
          <dl>
            <dt>Досвід</dt>
            <dd>
              <ul>
                <li v-for="(item, i) in profile.experience" :key="i">{{ item }}</li>
              </ul>
            </dd>
            <dt>Сильні навички</dt>
            <dd>
              <ul>
                <li v-for="(item, i) in profile.skills.strong" :key="i">{{ item }}</li>
              </ul>
            </dd>
            <dt>Зони росту</dt>
            <dd>
              <ul>
                <li v-for="(item, i) in profile.skills.growth" :key="i">{{ item }}</li>
              </ul>
            </dd>
            <dt>Цілі</dt>
            <dd>
              <ul>
                <li v-for="(item, i) in profile.goals" :key="i">{{ item }}</li>
              </ul>
            </dd>
            <dt>Резюме</dt>
            <dd>{{ profile.summary }}</dd>
          </dl>
          <p class="confirmed-banner">
            ✓ Підтверджено {{ formatConfirmedAt(profile.confirmedAt) }}
          </p>
        </section>
        <div class="actions">
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
.subsection-title {
  margin: 1.25rem 0 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: #374151;
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
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
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
.btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
</style>

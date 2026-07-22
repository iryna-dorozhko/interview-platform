<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  draftDecisionLetter,
  fetchReport,
  sendDecision,
  type FinalReport,
  type InterviewDecisionType,
} from "../api/reports";

const route = useRoute();
const reportId = computed(() => String(route.params.id));

const report = ref<FinalReport | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const RECOMMENDATION_LABELS: Record<string, string> = {
  HIRE: "Найняти",
  MAYBE: "Під питанням",
  REJECT: "Відхилити",
};

const DECISION_LABELS: Record<InterviewDecisionType, string> = {
  ACCEPT: "Прийняти",
  REJECT: "Відхилити",
  ADDITIONAL_MEETING: "Додаткова зустріч",
};

const modalOpen = ref(false);
const modalType = ref<InterviewDecisionType | null>(null);
const draftBody = ref("");
const modalState = ref<"loading" | "edit" | "error" | "sent">("loading");
const modalError = ref<string | null>(null);
const sentDialogId = ref<string | null>(null);

const renderedMarkdown = computed(() => {
  if (!report.value) return "";
  const html = marked.parse(report.value.reportMarkdown, { async: false }) as string;
  return DOMPurify.sanitize(html);
});

function recommendationLabel(value: string): string {
  return RECOMMENDATION_LABELS[value] ?? value;
}

function badgeClass(value: string): string {
  if (value === "HIRE") return "badge-hire";
  if (value === "MAYBE") return "badge-maybe";
  if (value === "REJECT") return "badge-reject";
  return "badge-neutral";
}

async function openDecision(type: InterviewDecisionType): Promise<void> {
  modalType.value = type;
  modalOpen.value = true;
  modalState.value = "loading";
  modalError.value = null;
  draftBody.value = "";
  sentDialogId.value = null;
  try {
    const draft = await draftDecisionLetter(reportId.value, type);
    draftBody.value = draft.body;
    modalState.value = "edit";
  } catch (error) {
    modalState.value = "error";
    modalError.value =
      error instanceof Error ? error.message : "Не вдалося згенерувати лист";
  }
}

async function submitDecision(): Promise<void> {
  if (!modalType.value) return;
  modalState.value = "loading";
  modalError.value = null;
  try {
    const result = await sendDecision(reportId.value, modalType.value, draftBody.value);
    sentDialogId.value = result.dialogId;
    if (report.value) report.value.latestDecision = result.decision;
    modalState.value = "sent";
  } catch (error) {
    modalState.value = "edit";
    modalError.value =
      error instanceof Error ? error.message : "Не вдалося надіслати";
  }
}

function closeModal(): void {
  modalOpen.value = false;
  modalType.value = null;
  modalError.value = null;
}

async function loadReport(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    report.value = await fetchReport(reportId.value);
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити звіт";
  }
}

onMounted(loadReport);
</script>

<template>
  <main class="report-page">
    <header class="header">
      <RouterLink to="/interviews" class="back-link">← До списку співбесід</RouterLink>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else-if="report">
      <h1>Звіт про співбесіду</h1>

      <div class="summary-row">
        <div class="score-card">
          <span class="score-value">{{ report.matchScore }}%</span>
          <span class="score-label">Відповідність</span>
        </div>
        <div class="recommendation-card" :class="badgeClass(report.recommendation)">
          <span class="recommendation-value">{{ recommendationLabel(report.recommendation) }}</span>
          <span class="recommendation-label">Рекомендація</span>
        </div>
      </div>

      <section class="decision-block">
        <p v-if="report.latestDecision" class="latest-decision">
          Поточне рішення:
          <strong>{{ DECISION_LABELS[report.latestDecision.type] }}</strong>
        </p>
        <div class="decision-actions">
          <button type="button" class="btn-primary" @click="openDecision('ACCEPT')">
            {{ DECISION_LABELS.ACCEPT }}
          </button>
          <button type="button" class="btn-secondary" @click="openDecision('ADDITIONAL_MEETING')">
            {{ DECISION_LABELS.ADDITIONAL_MEETING }}
          </button>
          <button type="button" class="btn-danger" @click="openDecision('REJECT')">
            {{ DECISION_LABELS.REJECT }}
          </button>
        </div>
      </section>

      <div class="cards-row">
        <section class="info-card strengths">
          <h2>Сильні сторони</h2>
          <ul>
            <li v-for="(item, index) in report.strengths" :key="index">{{ item }}</li>
          </ul>
        </section>
        <section class="info-card risks">
          <h2>Ризики</h2>
          <ul>
            <li v-for="(item, index) in report.risks" :key="index">{{ item }}</li>
          </ul>
        </section>
      </div>

      <section class="report-body" v-html="renderedMarkdown" />
    </template>

    <div v-if="modalOpen" class="modal-overlay" @click.self="closeModal">
      <div class="modal" role="dialog" aria-labelledby="decision-modal-title">
        <h2 id="decision-modal-title">
          {{ modalType ? DECISION_LABELS[modalType] : "Рішення" }}
        </h2>

        <p v-if="modalState === 'loading'">Завантаження…</p>

        <template v-else-if="modalState === 'error'">
          <p class="error-banner">{{ modalError }}</p>
          <div class="actions">
            <button type="button" class="btn-secondary" @click="closeModal">Закрити</button>
          </div>
        </template>

        <template v-else-if="modalState === 'sent'">
          <p class="success-message">Рішення надіслано кандидату.</p>
          <RouterLink
            v-if="sentDialogId"
            :to="'/dialogs/' + sentDialogId"
            class="dialog-link"
            @click="closeModal"
          >
            Відкрити діалог
          </RouterLink>
          <div class="actions">
            <button type="button" class="btn-secondary" @click="closeModal">Закрити</button>
          </div>
        </template>

        <template v-else-if="modalState === 'edit'">
          <label class="field">
            <span>Текст листа</span>
            <textarea v-model="draftBody" rows="10" />
          </label>
          <p v-if="modalError" class="error-banner">{{ modalError }}</p>
          <div class="actions">
            <button type="button" class="btn-secondary" @click="closeModal">Скасувати</button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!draftBody.trim()"
              @click="submitDecision"
            >
              Надіслати
            </button>
          </div>
        </template>
      </div>
    </div>
  </main>
</template>

<style scoped>
.report-page {
  width: 100%;
  min-width: 0;
}
.header {
  margin-bottom: 1rem;
}
.back-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover {
  text-decoration: underline;
}
.error-banner {
  color: var(--danger);
  background: var(--danger-soft);
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
}
.summary-row {
  display: flex;
  gap: 1rem;
  margin: 1.5rem 0;
}
.score-card,
.recommendation-card {
  flex: 1;
  padding: 1.25rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.score-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--accent);
}
.score-label,
.recommendation-label {
  font-size: 0.875rem;
  color: var(--muted);
}
.recommendation-value {
  font-size: 1.25rem;
  font-weight: 700;
}
.badge-hire {
  background: #dcfce7;
  border-color: #86efac;
  color: #16a34a;
}
.badge-maybe {
  background: #fef9c3;
  border-color: #fde047;
  color: #ca8a04;
}
.badge-reject {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #dc2626;
}
.decision-block {
  margin: 0 0 1.5rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface);
}
.latest-decision {
  margin: 0 0 0.75rem;
  color: var(--text);
  font-size: 0.9375rem;
}
.decision-actions {
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
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}
.btn-danger {
  background: var(--surface);
  color: var(--danger);
  border-color: #fca5a5;
}
.cards-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.info-card {
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
}
.info-card h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}
.info-card ul {
  margin: 0;
  padding-left: 1.25rem;
}
.info-card li {
  margin-bottom: 0.25rem;
}
.strengths {
  background: #f0fdf4;
}
.risks {
  background: #fff7ed;
}
.report-body :deep(h2) {
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  font-size: 1.125rem;
}
.report-body :deep(p) {
  margin: 0.5rem 0;
  line-height: 1.6;
}
.report-body :deep(ul) {
  padding-left: 1.25rem;
}
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
  background: var(--surface);
  border-radius: 0.5rem;
  padding: 1.25rem;
  width: 100%;
  max-width: 32rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}
.modal h2 {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.field textarea {
  font-family: inherit;
  font-size: 0.9375rem;
  color: var(--text);
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  resize: vertical;
  min-height: 10rem;
}
.field textarea:focus {
  outline: 2px solid var(--accent-focus);
  outline-offset: 1px;
}
.success-message {
  margin: 0 0 0.75rem;
  color: var(--text);
}
.dialog-link {
  display: inline-block;
  margin-bottom: 1rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.9375rem;
}
.dialog-link:hover {
  text-decoration: underline;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>

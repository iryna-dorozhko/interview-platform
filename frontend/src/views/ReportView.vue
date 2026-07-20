<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { fetchReport, type FinalReport } from "../api/reports";

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
  background: #fee2e2;
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
  border: 1px solid #e5e7eb;
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
  color: #6b7280;
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
.cards-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.info-card {
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
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
</style>

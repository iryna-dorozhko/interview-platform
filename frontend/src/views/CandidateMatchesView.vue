<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  acceptMatch,
  fetchActiveApplication,
  fetchNextMatch,
  rejectMatch,
  type ActiveApplication,
  type CandidateMatchOffer,
} from "../api/candidate-matches";

type ViewState = "loading" | "pending" | "offer" | "empty" | "error";

const viewState = ref<ViewState>("loading");
const errorMessage = ref<string | null>(null);
const application = ref<ActiveApplication | null>(null);
const offers = ref<CandidateMatchOffer[]>([]);
const actionBusy = ref(false);
const rejectingVacancyId = ref<string | null>(null);

function applyOffers(next: CandidateMatchOffer[]): void {
  offers.value = next;
  viewState.value = next.length > 0 ? "offer" : "empty";
}

async function loadMatches(): Promise<void> {
  viewState.value = "loading";
  errorMessage.value = null;
  application.value = null;
  offers.value = [];

  try {
    const active = await fetchActiveApplication();
    if (active?.status === "PENDING") {
      application.value = active;
      viewState.value = "pending";
      return;
    }

    const { offers: nextOffers } = await fetchNextMatch();
    applyOffers(nextOffers);
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити підбір";
  }
}

async function onReject(vacancyId: string): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  rejectingVacancyId.value = vacancyId;
  errorMessage.value = null;
  try {
    const { offers: nextOffers } = await rejectMatch(vacancyId);
    applyOffers(nextOffers);
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося відхилити вакансію";
  } finally {
    actionBusy.value = false;
    rejectingVacancyId.value = null;
  }
}

async function onAccept(vacancyId: string): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  errorMessage.value = null;
  try {
    const { application: created } = await acceptMatch(vacancyId);
    application.value = created;
    offers.value = [];
    viewState.value = "pending";
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося подати заявку";
  } finally {
    actionBusy.value = false;
  }
}

onMounted(() => {
  void loadMatches();
});
</script>

<template>
  <div class="page">
    <h2 class="page-title">Підбір вакансій</h2>

    <p v-if="viewState === 'loading'">Завантаження…</p>

    <p v-else-if="viewState === 'error'" class="fail" role="alert">{{ errorMessage }}</p>

    <section v-else-if="viewState === 'pending'" class="status-card">
      <p class="status-text">Заявку надіслано. Очікуйте відповіді HR.</p>
      <p v-if="application" class="status-meta">
        Відповідність: {{ application.matchScore }}%
      </p>
    </section>

    <p v-else-if="viewState === 'empty'" class="empty">Немає підходящих вакансій</p>

    <section v-else-if="viewState === 'offer' && offers.length > 0" class="offers-list">
      <article
        v-for="item in offers"
        :key="item.vacancyId"
        class="offer-row"
      >
        <div class="offer-main">
          <div class="offer-details">
            <h3 class="offer-title">{{ item.title }}</h3>
            <p v-if="item.salaryDisplay" class="offer-meta">💰 {{ item.salaryDisplay }}</p>
            <p v-if="item.workFormatDisplay" class="offer-meta">🏢 {{ item.workFormatDisplay }}</p>
          </div>
          <span class="offer-score-badge">{{ item.matchScore }}%</span>
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn-secondary"
            :disabled="actionBusy"
            @click="onReject(item.vacancyId)"
          >
            {{
              rejectingVacancyId === item.vacancyId
                ? "Зачекайте…"
                : "Відхилити"
            }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="actionBusy"
            @click="onAccept(item.vacancyId)"
          >
            {{ actionBusy ? "Зачекайте…" : "Прийняти" }}
          </button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1.25rem;
  font-size: 1.375rem;
}
.fail {
  color: var(--danger);
}
.empty {
  margin: 0;
  color: #555;
}
.status-card {
  padding: 1.25rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}
.status-text {
  margin: 0;
  font-weight: 600;
  color: #166534;
}
.status-meta {
  margin: 0.5rem 0 0;
  color: #6b7280;
  font-size: 0.875rem;
}
.offers-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
  gap: 1rem;
}
.offer-row {
  padding: 1.25rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}
.offer-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.offer-details {
  min-width: 0;
}
.offer-meta {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: #6b7280;
}
.offer-title {
  margin: 0;
  font-size: 1.125rem;
  color: #111827;
}
.offer-score-badge {
  flex-shrink: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #166534;
  background: #dcfce7;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
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
.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-secondary {
  background: #f3f4f6;
  color: #374151;
  border-color: #d1d5db;
}
</style>

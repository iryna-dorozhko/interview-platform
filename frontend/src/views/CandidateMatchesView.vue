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
const offer = ref<CandidateMatchOffer | null>(null);
const actionBusy = ref(false);

function applyOffer(next: CandidateMatchOffer): void {
  if (next.vacancyId == null || next.title == null || next.matchScore == null) {
    offer.value = null;
    viewState.value = "empty";
    return;
  }
  offer.value = next;
  viewState.value = "offer";
}

async function loadMatches(): Promise<void> {
  viewState.value = "loading";
  errorMessage.value = null;
  application.value = null;
  offer.value = null;

  try {
    const active = await fetchActiveApplication();
    if (active?.status === "PENDING") {
      application.value = active;
      viewState.value = "pending";
      return;
    }

    const next = await fetchNextMatch();
    applyOffer(next);
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити підбір";
  }
}

async function onReject(): Promise<void> {
  if (!offer.value?.vacancyId || actionBusy.value) return;
  actionBusy.value = true;
  errorMessage.value = null;
  try {
    const next = await rejectMatch(offer.value.vacancyId);
    applyOffer(next);
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося відхилити вакансію";
  } finally {
    actionBusy.value = false;
  }
}

async function onAccept(): Promise<void> {
  if (!offer.value?.vacancyId || actionBusy.value) return;
  actionBusy.value = true;
  errorMessage.value = null;
  try {
    const { application: created } = await acceptMatch(offer.value.vacancyId);
    application.value = created;
    offer.value = null;
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

    <section v-else-if="viewState === 'offer' && offer" class="offer-card">
      <h3 class="offer-title">{{ offer.title }}</h3>
      <p class="offer-score">Відповідність: {{ offer.matchScore }}%</p>
      <div class="actions">
        <button
          type="button"
          class="btn-secondary"
          :disabled="actionBusy"
          @click="onReject"
        >
          {{ actionBusy ? "Зачекайте…" : "Відхилити" }}
        </button>
        <button type="button" class="btn-primary" :disabled="actionBusy" @click="onAccept">
          {{ actionBusy ? "Зачекайте…" : "Прийняти" }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
.fail {
  color: var(--danger);
}
.empty {
  margin: 0;
  color: #555;
}
.status-card,
.offer-card {
  padding: 1rem;
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
.offer-title {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
  color: #111827;
}
.offer-score {
  margin: 0 0 1rem;
  font-size: 0.95rem;
  color: #374151;
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

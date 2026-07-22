<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createDialog,
  fetchDialogs,
  type DialogListItem,
} from "../api/dialogs";
import { formatUnreadBadge } from "../composables/useDialogUnread";
import {
  fetchHrApplication,
  fetchHrApplications,
} from "../api/hr-applications";
import { fetchMyInterviews } from "../api/interviews";

type ListState = "loading" | "ready" | "error";

type EligibleCandidate = {
  id: string;
  email: string;
};

const route = useRoute();
const router = useRouter();

const isCandidate = computed(() => route.path.startsWith("/candidate"));
const basePath = computed(() =>
  isCandidate.value ? "/candidate/dialogs" : "/dialogs",
);

const dialogs = ref<DialogListItem[]>([]);
const listState = ref<ListState>("loading");
const listError = ref<string | null>(null);

const showNewModal = ref(false);
const eligible = ref<EligibleCandidate[]>([]);
const eligibleState = ref<ListState>("ready");
const eligibleError = ref<string | null>(null);
const selectedCandidateId = ref("");
const creating = ref(false);
const createError = ref<string | null>(null);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function previewText(dialog: DialogListItem): string {
  if (!dialog.lastMessage) return "Немає повідомлень";
  const body = dialog.lastMessage.body.trim();
  if (body.length <= 80) return body;
  return `${body.slice(0, 80)}…`;
}

async function loadDialogs(): Promise<void> {
  listState.value = "loading";
  listError.value = null;
  try {
    dialogs.value = await fetchDialogs();
    listState.value = "ready";
  } catch (error) {
    listState.value = "error";
    listError.value =
      error instanceof Error ? error.message : "Не вдалося завантажити діалоги";
  }
}

function openDialog(id: string): void {
  void router.push(`${basePath.value}/${id}`);
}

async function openNewModal(): Promise<void> {
  showNewModal.value = true;
  selectedCandidateId.value = "";
  createError.value = null;
  eligibleError.value = null;
  eligibleState.value = "loading";
  try {
    const [interviews, summaries] = await Promise.all([
      fetchMyInterviews(),
      fetchHrApplications(),
    ]);
    const byId = new Map<string, string>();
    for (const interview of interviews) {
      if (!interview.candidateUserId) continue;
      const email =
        interview.invitation?.email?.trim() ||
        interview.displayName?.trim() ||
        interview.candidateUserId;
      if (!byId.has(interview.candidateUserId)) {
        byId.set(interview.candidateUserId, email);
      }
    }
    const applications = await Promise.all(
      summaries.map((item) => fetchHrApplication(item.id)),
    );
    for (const application of applications) {
      const id = application.candidate.id;
      if (!id || byId.has(id)) continue;
      const email =
        application.candidate.email?.trim() ||
        application.candidate.fullName?.trim() ||
        id;
      byId.set(id, email);
    }
    eligible.value = [...byId.entries()].map(([id, email]) => ({ id, email }));
    eligibleState.value = "ready";
  } catch (error) {
    eligibleState.value = "error";
    eligibleError.value =
      error instanceof Error
        ? error.message
        : "Не вдалося завантажити кандидатів";
  }
}

function closeNewModal(): void {
  showNewModal.value = false;
  createError.value = null;
}

async function submitNewDialog(): Promise<void> {
  if (!selectedCandidateId.value || creating.value) return;
  creating.value = true;
  createError.value = null;
  try {
    const { id } = await createDialog(selectedCandidateId.value);
    showNewModal.value = false;
    await router.push(`${basePath.value}/${id}`);
  } catch (error) {
    createError.value =
      error instanceof Error ? error.message : "Не вдалося створити діалог";
  } finally {
    creating.value = false;
  }
}

onMounted(loadDialogs);
</script>

<template>
  <div class="dialog-list">
    <div class="list-header">
      <h1>Діалоги</h1>
      <button
        v-if="!isCandidate"
        type="button"
        class="btn-primary"
        @click="openNewModal"
      >
        Новий діалог
      </button>
    </div>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="dialogs.length === 0" class="muted">Поки немає діалогів</p>
    <ul v-else class="rows" role="list">
      <li v-for="dialog in dialogs" :key="dialog.id">
        <button
          type="button"
          class="row"
          :class="{ unread: dialog.unreadCount > 0 }"
          @click="openDialog(dialog.id)"
        >
          <span class="peer">{{ dialog.peer.email }}</span>
          <span class="preview">{{ previewText(dialog) }}</span>
          <span class="meta">
            <span v-if="dialog.unreadCount > 0" class="row-badge">{{
              formatUnreadBadge(dialog.unreadCount)
            }}</span>
            <span class="time">{{ formatDate(dialog.updatedAt) }}</span>
          </span>
        </button>
      </li>
    </ul>

    <div
      v-if="showNewModal"
      class="modal-overlay"
      @click.self="closeNewModal"
    >
      <div class="modal" role="dialog" aria-labelledby="new-dialog-title">
        <h2 id="new-dialog-title">Новий діалог</h2>
        <p v-if="eligibleState === 'loading'">Завантаження кандидатів…</p>
        <p v-else-if="eligibleState === 'error'" class="fail">{{ eligibleError }}</p>
        <template v-else>
          <p v-if="eligible.length === 0" class="muted">
            Немає кандидатів із співбесід або заявок.
          </p>
          <label v-else class="field">
            <span>Кандидат</span>
            <select v-model="selectedCandidateId">
              <option disabled value="">Оберіть кандидата</option>
              <option
                v-for="candidate in eligible"
                :key="candidate.id"
                :value="candidate.id"
              >
                {{ candidate.email }}
              </option>
            </select>
          </label>
          <p v-if="createError" class="fail" role="alert">{{ createError }}</p>
          <div class="actions">
            <button type="button" class="btn-secondary" @click="closeNewModal">
              Скасувати
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!selectedCandidateId || creating"
              @click="submitNewDialog"
            >
              Створити
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-list {
  width: 100%;
  min-width: 0;
}
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
h1 {
  margin: 0;
  font-size: 1.25rem;
}
.muted {
  color: var(--muted);
}
.fail {
  color: var(--danger);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}
.row {
  display: grid;
  grid-template-columns: minmax(8rem, 14rem) 1fr auto;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 0.25rem;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.row:hover {
  background: var(--surface-muted);
}
.row.unread .peer {
  font-weight: 700;
}
.peer {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.row-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
}
.time {
  color: var(--muted);
  font-size: 0.85rem;
  white-space: nowrap;
}
.btn-primary,
.btn-secondary {
  border: none;
  border-radius: 6px;
  padding: 0.45rem 0.85rem;
  font-size: 0.875rem;
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
  background: var(--surface-muted);
  color: var(--text);
  border: 1px solid var(--border);
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 50;
}
.modal {
  width: min(28rem, 100%);
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.modal h2 {
  margin: 0;
  font-size: 1.1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.875rem;
}
.field select {
  font: inherit;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
}
</style>

# Candidate Prep Chat History View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let candidates open a read-only prep chat history with Candidate Agent from `/candidate/profile` after finish and after confirm, using the same `viewingHistory` UX as HR vacancy prep.

**Architecture:** Frontend-only change in `CandidateProfileView.vue`. Add a `viewingHistory` flag; when true, render existing `PrepChatPanel` with already-loaded `prepState.messages` and `isClosed=true`. Do not mount `CandidatePrepChat` for history (it emits `finished` when closed and the parent would hide the chat). No backend/API changes.

**Tech Stack:** Vue 3 (`ref`/`computed`), existing `PrepChatPanel`, candidate prep API types already on the page.

**Spec:** `docs/superpowers/specs/2026-07-23-candidate-view-prep-chat-history-design.md`

## Global Constraints

- Audience: candidate only; do not change HR prep views.
- Entry: same page `/candidate/profile` (`CandidateProfileView`).
- Available after finish **and** after confirm.
- Button copy: `← Назад до чату` (profile → history), `Показати анкету` (history → profile).
- History mode: read-only — no composer, no delete/send in the history `#actions` slot.
- Do not mount `CandidatePrepChat` for history viewing.
- Reuse `PrepChatPanel`; reuse `prepState.messages` (no extra fetch).
- No new routes, REST endpoints, Prisma models, or live-chat changes.
- No Vue SFC unit-test harness in this repo for views — verify manually in the browser (see checklist). Frontend `npm test` only covers selected composables; do not add a view test unless you also add a harness (out of scope).

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/views/CandidateProfileView.vue` | `viewingHistory` state, toggles, profile buttons, conditional history `PrepChatPanel` |
| `frontend/src/components/PrepChatPanel.vue` | Reuse as-is (no changes) |
| `frontend/src/components/CandidatePrepChat.vue` | Unchanged; still only for active (open) prep chat via `showPrepChat` |

No new files.

---

### Task 1: `viewingHistory` + read-only history panel on candidate profile

**Files:**
- Modify: `frontend/src/views/CandidateProfileView.vue`

**Interfaces:**
- Consumes: `prepState.messages`, `isClosed`, `profile`, `PrepChatPanel` props (`loadState`, `messages`, `sending`, `isClosed`, `input`, `errorMessage`, `lastFailedAction`, `isUserMessage`)
- Produces: `viewingHistory: Ref<boolean>`; `backToChat()` / `backToProfile()`; history UI branch

- [ ] **Step 1: Import `PrepChatPanel` and add state helpers**

In `<script setup>`, add import next to `CandidatePrepChat`:

```ts
import PrepChatPanel from "../components/PrepChatPanel.vue";
import type { PrepChatMessage } from "../composables/usePrepChat";
```

After `const showPrepChat = ref(false);` add:

```ts
const viewingHistory = ref(false);
```

Add helpers (near `openMatches`):

```ts
function backToChat(): void {
  viewingHistory.value = true;
}

function backToProfile(): void {
  viewingHistory.value = false;
}

function isPrepUserMessage(msg: PrepChatMessage): boolean {
  return msg.authorType === "HUMAN_CANDIDATE";
}
```

- [ ] **Step 2: Reset `viewingHistory` on load / delete / restart**

At the start of successful path in `loadProfile` (after setting `prepState`, before `loadState = "ready"`), or at the beginning of `loadProfile`:

```ts
viewingHistory.value = false;
```

Prefer setting it once at the top of `loadProfile` so every reload (finish, confirm, delete→reload) returns to the profile view:

```ts
async function loadProfile(): Promise<void> {
  loadState.value = "loading";
  loadError.value = null;
  viewingHistory.value = false;
  // ... existing fetch logic unchanged
}
```

In `onRestartConfirmed`, after a successful delete and before/when setting `showPrepChat`:

```ts
viewingHistory.value = false;
showPrepChat.value = true;
```

(`onDeletePrep` already calls `loadProfile`, which resets the flag.)

In `onPrepFinished`, keep `showPrepChat.value = false` then `await loadProfile()` (reset happens inside `loadProfile`).

- [ ] **Step 3: Template — history branch + buttons on both profile states**

Keep `CandidatePrepChat` as the first branch when `showPrepChat && interview`.

After the in-progress (`!isClosed`) block and **before** the editable-profile block, insert history mode:

```vue
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
```

In the **editable** profile actions (`profile && !isConfirmed && editableProfile`), add as the first button in `.actions`:

```vue
          <button type="button" class="btn-secondary" @click="backToChat">
            ← Назад до чату
          </button>
```

In the **confirmed** profile actions (`profile && isConfirmed`), add the same button (before «Підібрати вакансію» is fine):

```vue
          <button type="button" class="btn-secondary" @click="backToChat">
            ← Назад до чату
          </button>
```

Do **not** put «← Назад до чату» inside the history panel actions — only «Показати анкету» there.

- [ ] **Step 4: Typecheck**

Run from `frontend/`:

```bash
npm run lint
```

Expected: exit 0 (no new `vue-tsc` errors in `CandidateProfileView.vue`).

- [ ] **Step 5: Manual verify**

With frontend + backend running, as a candidate:

1. Complete prep (finish) until the editable profile shows → **«← Назад до чату»** visible → click → read-only messages, no composer → **«Показати анкету»** returns to profile; confirm/save/delete still work.
2. Confirm profile → same history toggle works; confirmed CTA («Підібрати вакансію», «Почати заново») still on profile screen only.
3. «Почати заново» after confirm → active `CandidatePrepChat` opens; history mode is off.
4. Active open chat (`showPrepChat`) still works as before until finish.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/CandidateProfileView.vue
git commit -m "$(cat <<'EOF'
feat(fe): let candidates view prep chat history after profile

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Button on same page after finish | Task 1 Step 3 (editable actions) |
| Button after confirm | Task 1 Step 3 (confirmed actions) |
| Read-only `PrepChatPanel` + «Показати анкету» | Task 1 Step 3 |
| `viewingHistory` reset on load/confirm/delete/restart | Task 1 Step 2 |
| No `CandidatePrepChat` for history | Task 1 Step 3 (separate branch) |
| No backend changes | Global constraints |
| Empty messages still allow history view | Task 1 (button always when closed profile; empty list OK) |
| Manual verify checklist | Task 1 Step 5 |

No placeholders. Single file change. Types match `PrepChatPanel` / `PrepChatMessage` / `CandidatePrepAuthorType`.

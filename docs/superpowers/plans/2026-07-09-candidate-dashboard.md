# Candidate Dashboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести кабінет кандидата до HR-патерну — layout з sidebar, dashboard на головній, модалка join-by-code, окремі сторінки «Моя анкета» та «Співбесіда».

**Architecture:** Дзеркало `HrLayout` / `HrSidebar` у `CandidateLayout` / `CandidateSidebar` з nested routes під `/candidate`. Існуючі API (`candidate/interview`, `candidate-prep`) без нових endpoint-ів; єдина backend-зміна — дозволити `DELETE /api/candidate-prep/:id` після `confirmedAt`. `JoinInterviewModal` копіює патерн `CreateInterviewModal`.

**Tech Stack:** Express + Prisma (backend), Node `node:test`/`assert`, Vue 3 `<script setup>` + TypeScript (frontend, `vue-tsc` + manual check).

**Spec:** `docs/superpowers/specs/2026-07-09-candidate-dashboard-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/routes/candidate-prep.ts` | DELETE handler — прибрати 409 для confirmed profile |
| `backend/src/routes/candidate-prep.test.ts` | Оновити тест confirmed DELETE → 200 |
| `frontend/src/layouts/CandidateLayout.vue` | Header + sidebar shell |
| `frontend/src/components/CandidateSidebar.vue` | 3 nav items |
| `frontend/src/components/JoinInterviewModal.vue` | Join-by-code modal |
| `frontend/src/views/CandidateHomeView.vue` | Dashboard cards + action buttons |
| `frontend/src/views/CandidateProfileView.vue` | Profile view / delete / restart |
| `frontend/src/views/CandidateInterviewView.vue` | Interview status page |
| `frontend/src/views/CandidatePrepView.vue` | Update back-link target |
| `frontend/src/router/index.ts` | Nested routes under CandidateLayout |

---

### Task 1: Allow DELETE after confirmed profile

**Files:**
- Modify: `backend/src/routes/candidate-prep.ts`
- Modify: `backend/src/routes/candidate-prep.test.ts`

- [ ] **Step 1: Replace the failing test**

In `backend/src/routes/candidate-prep.test.ts`, replace the test `"DELETE /candidate-prep/:interviewId returns 409 when profile is confirmed"` with:

```ts
test("DELETE /candidate-prep/:interviewId removes session, messages, and confirmed profile", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: {},
        skills: {},
        goals: {},
        summary: "summary",
        confirmedAt: new Date("2026-07-08T09:00:00.000Z"),
      },
    ],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "AGENT_CANDIDATE",
    content: "Привіт!",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(fakePrisma.__sessions.length, 0);
    assert.equal(fakePrisma.__messages.length, 0);
    assert.equal(fakePrisma.__profiles.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `node --import tsx --test src/routes/candidate-prep.test.ts`

Expected: FAIL — test `"DELETE /candidate-prep/:interviewId removes session, messages, and confirmed profile"` returns status `409` instead of `200`.

- [ ] **Step 3: Remove confirmedAt guard**

In `backend/src/routes/candidate-prep.ts`, delete lines 321–325:

```ts
    const existingProfile = await prisma.candidateProfile.findUnique({ where: { interviewId } });
    if (existingProfile?.confirmedAt) {
      res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
      return;
    }
```

The DELETE handler should go straight from the interview-not-found check into the try/catch delete block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/routes/candidate-prep.test.ts`

Expected: all tests PASS.

Run full suite: `npm test` (from `backend/`)

Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-prep.ts backend/src/routes/candidate-prep.test.ts
git commit -m "feat: allow candidate prep reset after profile confirmation"
```

---

### Task 2: CandidateLayout and CandidateSidebar

**Files:**
- Create: `frontend/src/layouts/CandidateLayout.vue`
- Create: `frontend/src/components/CandidateSidebar.vue`

- [ ] **Step 1: Create CandidateLayout.vue**

```vue
<script setup lang="ts">
import { RouterView, useRouter } from "vue-router";
import CandidateSidebar from "../components/CandidateSidebar.vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

function logout(): void {
  auth.logout();
  router.push({ name: "candidate-login" });
}
</script>

<template>
  <div class="candidate-shell">
    <header class="header">
      <div>
        <h1>Interview Platform</h1>
        <p class="subtitle">Кандидат — кабінет</p>
      </div>
      <div class="user-bar">
        <span>{{ auth.user?.email }}</span>
        <button type="button" @click="logout">Вийти</button>
      </div>
    </header>
    <div class="body">
      <CandidateSidebar />
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.candidate-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: system-ui, sans-serif;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}
.header h1 {
  margin: 0;
  font-size: 1.25rem;
}
.subtitle {
  margin: 0.25rem 0 0;
  color: #555;
  font-size: 0.875rem;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}
.body {
  display: flex;
  flex: 1;
}
.content {
  flex: 1;
  padding: 1.5rem;
  max-width: 56rem;
}
</style>
```

- [ ] **Step 2: Create CandidateSidebar.vue**

```vue
<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();

function isActive(prefix: string): boolean {
  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}

function isHomeActive(): boolean {
  return route.name === "candidate-home";
}
</script>

<template>
  <nav class="sidebar" aria-label="Candidate navigation">
    <RouterLink to="/candidate" class="nav-item" :class="{ active: isHomeActive() }" title="Головна">
      <span class="icon" aria-hidden="true">🏠</span>
      <span class="label">Головна</span>
    </RouterLink>
    <RouterLink
      to="/candidate/profile"
      class="nav-item"
      :class="{ active: isActive('/candidate/profile') }"
      title="Моя анкета"
    >
      <span class="icon" aria-hidden="true">📋</span>
      <span class="label">Моя анкета</span>
    </RouterLink>
    <RouterLink
      to="/candidate/interview"
      class="nav-item"
      :class="{ active: isActive('/candidate/interview') }"
      title="Співбесіда"
    >
      <span class="icon" aria-hidden="true">🎤</span>
      <span class="label">Співбесіда</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid #e5e7eb;
  min-width: 5rem;
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem;
  border-radius: 0.375rem;
  text-decoration: none;
  color: #374151;
  font-size: 0.75rem;
}
.nav-item.active {
  background: #dbeafe;
  color: #1d4ed8;
}
.icon {
  font-size: 1.25rem;
}
</style>
```

- [ ] **Step 3: Verify TypeScript**

Run (from `frontend/`): `npx vue-tsc --noEmit`

Expected: no errors related to new files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/layouts/CandidateLayout.vue frontend/src/components/CandidateSidebar.vue
git commit -m "feat: add candidate layout and sidebar"
```

---

### Task 3: Nested candidate routes

**Files:**
- Modify: `frontend/src/router/index.ts`
- Create: `frontend/src/views/CandidateProfileView.vue` (stub)
- Create: `frontend/src/views/CandidateInterviewView.vue` (stub)

- [ ] **Step 1: Add stub views**

Create `frontend/src/views/CandidateProfileView.vue`:

```vue
<script setup lang="ts"></script>

<template>
  <div>
    <h2 class="page-title">Моя анкета</h2>
    <p>Завантаження…</p>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
</style>
```

Create `frontend/src/views/CandidateInterviewView.vue`:

```vue
<script setup lang="ts"></script>

<template>
  <div>
    <h2 class="page-title">Співбесіда</h2>
    <p>Завантаження…</p>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
</style>
```

- [ ] **Step 2: Update router**

In `frontend/src/router/index.ts`:

Add imports:

```ts
import CandidateLayout from "../layouts/CandidateLayout.vue";
import CandidateProfileView from "../views/CandidateProfileView.vue";
import CandidateInterviewView from "../views/CandidateInterviewView.vue";
```

Replace the two standalone candidate routes:

```ts
    {
      path: "/candidate",
      name: "candidate-home",
      component: CandidateHomeView,
      meta: { requiresAuth: true, requiredRole: "CANDIDATE" },
    },
    {
      path: "/candidate/prep/:interviewId",
      name: "candidate-prep",
      component: CandidatePrepView,
      meta: { requiresAuth: true, requiredRole: "CANDIDATE" },
    },
```

with:

```ts
    {
      path: "/candidate",
      component: CandidateLayout,
      meta: { requiresAuth: true, requiredRole: "CANDIDATE" },
      children: [
        { path: "", name: "candidate-home", component: CandidateHomeView },
        { path: "profile", name: "candidate-profile", component: CandidateProfileView },
        { path: "interview", name: "candidate-interview", component: CandidateInterviewView },
        { path: "prep/:interviewId", name: "candidate-prep", component: CandidatePrepView },
      ],
    },
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx vue-tsc --noEmit` (from `frontend/`)

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/router/index.ts frontend/src/views/CandidateProfileView.vue frontend/src/views/CandidateInterviewView.vue
git commit -m "feat: nest candidate routes under CandidateLayout"
```

---

### Task 4: JoinInterviewModal

**Files:**
- Create: `frontend/src/components/JoinInterviewModal.vue`

- [ ] **Step 1: Create the modal component**

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { joinInterviewByCode, type CandidateInterview } from "../api/candidate-interview";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  joined: [interview: CandidateInterview];
}>();

const joinCode = ref("");
const submitting = ref(false);
const error = ref<string | null>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    joinCode.value = "";
    error.value = null;
    submitting.value = false;
  },
);

function onClose(): void {
  if (submitting.value) return;
  emit("close");
}

async function onSubmit(): Promise<void> {
  const code = joinCode.value.trim();
  if (!code) return;

  error.value = null;
  submitting.value = true;
  try {
    const interview = await joinInterviewByCode(code);
    emit("joined", interview);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не вдалося приєднатися до співбесіди";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="onClose">
    <div class="modal" role="dialog" aria-labelledby="join-interview-title">
      <h2 id="join-interview-title">Приєднатися до зустрічі</h2>
      <form @submit.prevent="onSubmit">
        <label class="field">
          <span>Код співбесіди</span>
          <input
            v-model="joinCode"
            type="text"
            maxlength="6"
            autocomplete="off"
            placeholder="TEST01"
            :disabled="submitting"
          />
        </label>
        <p v-if="error" class="fail">{{ error }}</p>
        <div class="actions">
          <button type="button" class="btn-secondary" :disabled="submitting" @click="onClose">
            Скасувати
          </button>
          <button type="submit" class="btn-primary" :disabled="submitting || !joinCode.trim()">
            {{ submitting ? "Приєднання…" : "Приєднатися" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
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
  background: #fff;
  border-radius: 0.5rem;
  padding: 1.25rem;
  width: 100%;
  max-width: 24rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}
.modal h2 {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
}
.field input {
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.fail {
  margin: 0.75rem 0 0;
  color: #b00020;
  font-size: 0.875rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
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
  background: #2563eb;
  color: #fff;
}
.btn-primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}
.btn-secondary {
  background: #f3f4f6;
  color: #374151;
  border-color: #d1d5db;
}
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx vue-tsc --noEmit` (from `frontend/`)

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/JoinInterviewModal.vue
git commit -m "feat: add JoinInterviewModal for candidate join-by-code"
```

---

### Task 5: CandidateHomeView dashboard

**Files:**
- Modify: `frontend/src/views/CandidateHomeView.vue`

- [ ] **Step 1: Replace CandidateHomeView.vue**

Rewrite the file. Remove standalone page wrapper (`<main class="page">`, logout button — logout lives in layout now). Implement:

**Script helpers:**

```ts
type LoadState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Готова",
  LIVE: "В ефірі",
};

function profileStatusLabel(
  interview: CandidateInterview | null,
  prep: CandidatePrepState | null,
): string {
  if (!interview) return "—";
  if (!prep || prep.messages.length === 0) return "Не створена";
  if (!prep.isClosed) return "В процесі";
  if (!prep.profile?.confirmedAt) return "Очікує підтвердження";
  return "Підтверджена";
}

function interviewStatusLabel(interview: CandidateInterview | null): string {
  if (!interview) return "—";
  return STATUS_LABELS[interview.status] ?? interview.status;
}
```

**Data loading (`loadDashboard`):**

```ts
async function loadDashboard(): Promise<void> {
  loadState.value = "loading";
  loadError.value = null;
  try {
    interview.value = await fetchCandidateInterview();
    if (interview.value) {
      prepState.value = await fetchCandidatePrepState(interview.value.id);
    } else {
      prepState.value = null;
    }
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    loadError.value = error instanceof Error ? error.message : "Не вдалося завантажити дані";
  }
}
```

**Computed cards:**

```ts
const interviewCount = computed(() => (interview.value ? 1 : 0));
const profileStatus = computed(() => profileStatusLabel(interview.value, prepState.value));
const meetingStatus = computed(() => interviewStatusLabel(interview.value));
```

**Actions:**

- `showJoinModal` ref, `JoinInterviewModal` with `@joined="onJoined"`
- `onJoined(interview)`: set `interview.value`, close modal, set `joinedBanner.value = interview`, call `loadDashboard()`
- `openPrep()`: `router.push({ name: "candidate-prep", params: { interviewId: interview.value!.id } })`

**Template structure** (mirror `HrHomeView.vue`):

```vue
<div class="home">
  <h2 class="page-title">Огляд</h2>
  <p v-if="loadState === 'loading'">Завантаження…</p>
  <p v-else-if="loadState === 'error'" class="fail">{{ loadError }}</p>
  <template v-else>
    <div class="overview-cards">
      <div class="card">
        <span class="card-value">{{ interviewCount }}</span>
        <span class="card-label">Співбесіда</span>
      </div>
      <div class="card">
        <span class="card-value card-value-text">{{ profileStatus }}</span>
        <span class="card-label">Статус анкети</span>
      </div>
      <div class="card">
        <span class="card-value card-value-text">{{ meetingStatus }}</span>
        <span class="card-label">Статус зустрічі</span>
      </div>
    </div>
    <div class="dashboard-actions">
      <button type="button" class="btn-primary" :disabled="interview !== null" @click="showJoinModal = true">
        Приєднатися до зустрічі
      </button>
      <button type="button" class="btn-primary" :disabled="!interview" @click="openPrep">
        Створити профіль
      </button>
    </div>
    <div v-if="joinedBanner" class="joined-banner">
      <p>
        Ви приєдналися до співбесіди
        <strong>{{ joinedBanner.displayName }}</strong>
      </p>
    </div>
  </template>
  <JoinInterviewModal :open="showJoinModal" @close="showJoinModal = false" @joined="onJoined" />
</div>
```

Copy `.overview-cards`, `.card`, `.dashboard-actions`, `.btn-primary`, `.fail` styles from `HrHomeView.vue`. Add:

```css
.card-value-text {
  font-size: 1rem;
  font-weight: 600;
}
.joined-banner {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx vue-tsc --noEmit` (from `frontend/`)

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CandidateHomeView.vue
git commit -m "feat: candidate home dashboard with overview cards and join modal"
```

---

### Task 6: CandidateProfileView

**Files:**
- Modify: `frontend/src/views/CandidateProfileView.vue`

- [ ] **Step 1: Implement full profile view**

Replace stub with full implementation per spec. Key pieces:

**Imports:**

```ts
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchCandidateInterview, type CandidateInterview } from "../api/candidate-interview";
import {
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  type CandidatePrepState,
  type CandidateProfile,
} from "../api/candidate-prep";
import JoinInterviewModal from "../components/JoinInterviewModal.vue";
```

**Load function** — same pattern as home: fetch interview, then prep state if interview exists.

**Delete handlers:**

```ts
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
    router.push({ name: "candidate-prep", params: { interviewId: interview.value.id } });
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
}
```

**Read-only profile block** — copy `<section class="profile-view">` structure from `VacancyDetailView.vue`, adapted for candidate fields:

```vue
<section v-if="profile" class="profile-view">
  <h2>Профіль кандидата</h2>
  <dl>
    <dt>Досвід</dt>
    <dd><ul><li v-for="(item, i) in profile.experience" :key="i">{{ item }}</li></ul></dd>
    <dt>Сильні навички</dt>
    <dd><ul><li v-for="(item, i) in profile.skills.strong" :key="i">{{ item }}</li></ul></dd>
    <dt>Зони росту</dt>
    <dd><ul><li v-for="(item, i) in profile.skills.growth" :key="i">{{ item }}</li></ul></dd>
    <dt>Цілі</dt>
    <dd><ul><li v-for="(item, i) in profile.goals" :key="i">{{ item }}</li></ul></dd>
    <dt>Резюме</dt>
    <dd>{{ profile.summary }}</dd>
  </dl>
  <p v-if="profile.confirmedAt" class="confirmed-banner">
    ✓ Підтверджено {{ new Date(profile.confirmedAt).toLocaleString("uk-UA") }}
  </p>
</section>
```

**Conditional actions** (5 states from spec):

| State | Buttons |
|-------|---------|
| No interview | «Приєднатися до зустрічі» → modal |
| No messages | «Створити профіль» → prep |
| In progress | «Продовжити анкету», «Видалити анкету» |
| Closed, unconfirmed | profile block + «Підтвердити профіль», «Видалити анкету» |
| Confirmed | profile block + «Почати заново» |

Copy `.profile-view`, `.confirmed-banner`, `.btn-primary`, `.btn-secondary` styles from `VacancyDetailView.vue`.

- [ ] **Step 2: Verify TypeScript**

Run: `npx vue-tsc --noEmit` (from `frontend/`)

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CandidateProfileView.vue
git commit -m "feat: candidate profile view with view/delete/restart actions"
```

---

### Task 7: CandidateInterviewView

**Files:**
- Modify: `frontend/src/views/CandidateInterviewView.vue`

- [ ] **Step 1: Implement interview detail page**

Replace stub:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchCandidateInterview, type CandidateInterview } from "../api/candidate-interview";
import JoinInterviewModal from "../components/JoinInterviewModal.vue";

type LoadState = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Готова",
  LIVE: "В ефірі",
};

const interview = ref<CandidateInterview | null>(null);
const loadState = ref<LoadState>("loading");
const errorMessage = ref<string | null>(null);
const showJoinModal = ref(false);

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

async function loadInterview(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    interview.value = await fetchCandidateInterview();
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завантажити співбесіду";
  }
}

function onJoined(joined: CandidateInterview): void {
  interview.value = joined;
  showJoinModal.value = false;
}

onMounted(loadInterview);
</script>

<template>
  <div class="page">
    <h2 class="page-title">Співбесіда</h2>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else-if="interview">
      <h1>{{ interview.displayName }}</h1>
      <p class="meta">Статус: <strong>{{ statusLabel(interview.status) }}</strong></p>
      <p class="muted">Жива кімната співбесіди з'явиться пізніше.</p>
    </template>

    <template v-else>
      <p class="empty">Ви ще не приєдналися до зустрічі</p>
      <button type="button" class="btn-primary" @click="showJoinModal = true">
        Приєднатися до зустрічі
      </button>
    </template>

    <JoinInterviewModal :open="showJoinModal" @close="showJoinModal = false" @joined="onJoined" />
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}
h1 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
}
.meta {
  margin: 0 0 1rem;
  color: #555;
  font-size: 0.875rem;
}
.muted {
  margin: 0;
  color: #6b7280;
  font-size: 0.875rem;
}
.empty {
  margin: 0 0 1rem;
  color: #555;
}
.error-banner {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: #b00020;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}
</style>
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx vue-tsc --noEmit` (from `frontend/`)

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CandidateInterviewView.vue
git commit -m "feat: candidate interview detail page"
```

---

### Task 8: Update CandidatePrepView navigation

**Files:**
- Modify: `frontend/src/views/CandidatePrepView.vue`

- [ ] **Step 1: Update back link**

Find the «← До кабінету» button/link. Change navigation target from hardcoded `/candidate` to:

```ts
router.push({ name: "candidate-home" });
```

Remove any duplicate logout button if present (logout is in layout).

- [ ] **Step 2: Verify TypeScript**

Run: `npx vue-tsc --noEmit` (from `frontend/`)

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CandidatePrepView.vue
git commit -m "fix: candidate prep back link uses named route"
```

---

### Task 9: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run backend tests**

Run (from `backend/`): `npm test`

Expected: all suites PASS.

- [ ] **Step 2: Run frontend typecheck**

Run (from `frontend/`): `npx vue-tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual UI checklist**

Start dev servers (`npm run dev` from repo root or workspaces). Verify:

1. Login as candidate → `/candidate` shows layout with sidebar (3 items), header with email + logout
2. No interview: cards show `0 / — / —`; «Приєднатися» enabled; «Створити профіль» disabled
3. Join via modal with seed code `TEST01` → green banner; cards update; join button disabled
4. «Створити профіль» → prep chat renders inside layout (sidebar visible)
5. Sidebar navigation: all 3 routes work, active state highlights correctly
6. «Моя анкета»: shows correct state; after confirm → read-only profile + «Почати заново» works
7. «Співбесіда»: shows displayName + status when joined; empty state + join button when not
8. HR login → `/` still works (no regression)

- [ ] **Step 4: Commit (if any fixups needed)**

Only if manual testing revealed fixes — commit each fix separately with descriptive message.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| CandidateLayout + sidebar (3 items) | Task 2, 3 |
| Nested routes | Task 3 |
| Home dashboard cards + buttons | Task 5 |
| JoinInterviewModal | Task 4, used in 5/6/7 |
| CandidateProfileView (5 states) | Task 6 |
| CandidateInterviewView | Task 7 |
| Prep back navigation | Task 8 |
| DELETE after confirm (backend) | Task 1 |
| Manual test plan | Task 9 |

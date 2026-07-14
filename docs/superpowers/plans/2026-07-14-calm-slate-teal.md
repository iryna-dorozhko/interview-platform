# Calm Slate + Teal Visual Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Впровадити єдину Calm Slate + Teal дизайн-систему на frontend так, щоб HR і Candidate shells, live-кімната та ключові CTA відповідали затвердженому мокапу.

**Architecture:** Глобальні CSS-токени (`tokens.css`) + базові body/типографіка (`base.css`), підключені з `main.ts` і Google Fonts у `index.html`. Існуючі Vue SFC scoped styles поступово переводяться на `var(--*)`. Кольори live-чат бульбашок оновлюються в `live-message-styles.ts` у межах teal/slate (без purple). Без Tailwind і без dark mode.

**Tech Stack:** Vue 3 + TypeScript + Vite + CSS custom properties + IBM Plex Sans (Google Fonts).

**Spec:** `docs/superpowers/specs/2026-07-14-calm-slate-teal-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `frontend/index.html` | Підключення IBM Plex Sans |
| `frontend/src/styles/tokens.css` | CSS custom properties (палітра) |
| `frontend/src/styles/base.css` | Body, font-family, link/button defaults |
| `frontend/src/main.ts` | Import styles |
| `frontend/src/layouts/HrLayout.vue` | HR shell під токени |
| `frontend/src/layouts/CandidateLayout.vue` | Candidate shell під токени |
| `frontend/src/components/HrSidebar.vue` | Nav active = teal; без emoji chrome |
| `frontend/src/components/CandidateSidebar.vue` | Те саме для кандидата |
| `frontend/src/utils/live-message-styles.ts` | Teal/slate палітра учасників чату |
| `frontend/src/components/LiveChatPanel.vue` | Primary CTA teal, borders/tokens |
| `frontend/src/components/AgentStatusPanel.vue` | Thinking = teal soft, не purple |
| `frontend/src/components/InterviewRoomContent.vue` | Banners/links під токени |
| Key views/modals (див. Task 5) | `#2563eb` → accent; danger → `--danger`; font inherit |

---

### Task 1: Global tokens + font

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/base.css`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Create `frontend/src/styles/tokens.css`**

```css
:root {
  --bg: #f4f6f8;
  --surface: #ffffff;
  --surface-muted: #f9fafb;
  --border: #e5e7eb;
  --text: #111827;
  --muted: #6b7280;
  --accent: #0f766e;
  --accent-soft: #ecfdf5;
  --accent-border: #a7f3d0;
  --accent-focus: #99f6e4;
  --danger: #b91c1c;
  --danger-soft: #fef2f2;
  --warning: #b45309;
  --warning-soft: #fef3c7;
  --radius: 8px;
  --font: "IBM Plex Sans", system-ui, sans-serif;
}
```

- [ ] **Step 2: Create `frontend/src/styles/base.css`**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}

a {
  color: var(--accent);
}

a:hover {
  color: #115e59;
}

button,
input,
textarea,
select {
  font-family: inherit;
}
```

- [ ] **Step 3: Wire font in `frontend/index.html`**

Replace the entire `<head>` content with:

```html
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Interview Platform</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 4: Import styles in `frontend/src/main.ts`**

```typescript
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./styles/tokens.css";
import "./styles/base.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.mount("#app");
```

- [ ] **Step 5: Verify build**

Run: `npm --workspace frontend run build`

Expected: PASS без TypeScript/Vite помилок.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/src/main.ts frontend/src/styles/tokens.css frontend/src/styles/base.css
git commit -m "feat: add Calm Slate + Teal design tokens and IBM Plex Sans"
```

---

### Task 2: HR + Candidate shells and sidebars

**Files:**
- Modify: `frontend/src/layouts/HrLayout.vue`
- Modify: `frontend/src/layouts/CandidateLayout.vue`
- Modify: `frontend/src/components/HrSidebar.vue`
- Modify: `frontend/src/components/CandidateSidebar.vue`

- [ ] **Step 1: Update `HrLayout.vue` styles**

Replace the entire `<style scoped>` block with:

```css
.hr-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.9rem 1.25rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.header h1 {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.subtitle {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.8rem;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.user-bar button {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}
.body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.content {
  flex: 1;
  padding: 1.25rem;
  max-width: 56rem;
}
```

- [ ] **Step 2: Update `CandidateLayout.vue` styles**

Replace the entire `<style scoped>` block with the same rules as Step 1, but rename root class selectors:

- `.hr-shell` → `.candidate-shell`
- Keep the rest identical (`.header`, `.subtitle`, `.user-bar`, `.body`, `.content`)

Template class on root remains `candidate-shell` (already present).

- [ ] **Step 3: Update `HrSidebar.vue`**

Replace template icons with text-only labels (remove emoji `<span class="icon">`):

```vue
<template>
  <nav class="sidebar" aria-label="HR navigation">
    <RouterLink to="/" class="nav-item" :class="{ active: isHomeActive() }">
      Головна
    </RouterLink>
    <RouterLink to="/vacancies" class="nav-item" :class="{ active: isActive('/vacancies') }">
      Анкети
    </RouterLink>
    <RouterLink to="/interviews" class="nav-item" :class="{ active: isActive('/interviews') }">
      Співбесіди
    </RouterLink>
  </nav>
</template>
```

Replace `<style scoped>` with:

```css
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid var(--border);
  background: var(--surface-muted);
  min-width: 8.5rem;
}
.nav-item {
  display: block;
  padding: 0.55rem 0.65rem;
  border-radius: 6px;
  text-decoration: none;
  color: #374151;
  font-size: 0.9rem;
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
```

- [ ] **Step 4: Update `CandidateSidebar.vue` the same way**

Template (text-only links, keep existing `to` / active helpers):

```vue
<template>
  <nav class="sidebar" aria-label="Candidate navigation">
    <RouterLink to="/candidate" class="nav-item" :class="{ active: isHomeActive() }">
      Головна
    </RouterLink>
    <RouterLink
      to="/candidate/profile"
      class="nav-item"
      :class="{ active: isActive('/candidate/profile') }"
    >
      Моя анкета
    </RouterLink>
    <RouterLink
      to="/candidate/interview"
      class="nav-item"
      :class="{ active: isActive('/candidate/interview') }"
    >
      Співбесіда
    </RouterLink>
  </nav>
</template>
```

Use the **exact same** `<style scoped>` block as in Step 3 for `HrSidebar.vue`.

- [ ] **Step 5: Verify build**

Run: `npm --workspace frontend run build`

Expected: PASS.

- [ ] **Step 6: Manual smoke (dev)**

З відкритим `npm run dev`:

1. HR login → shell має chilly gray bg, white topbar, teal active nav
2. Candidate login → той самий character shell

- [ ] **Step 7: Commit**

```bash
git add frontend/src/layouts/HrLayout.vue frontend/src/layouts/CandidateLayout.vue \
  frontend/src/components/HrSidebar.vue frontend/src/components/CandidateSidebar.vue
git commit -m "feat: restyle HR and Candidate shells with Calm Slate tokens"
```

---

### Task 3: Live message palette (no purple)

**Files:**
- Modify: `frontend/src/utils/live-message-styles.ts`

- [ ] **Step 1: Replace `STYLES` and neutrals with teal/slate palette**

Keep exported function signatures identical. Replace the constants section with:

```typescript
const NEUTRAL_BUBBLE: BubbleStyle = { background: "#f3f4f6", color: "#111827" };

const STYLES: Record<
  LiveAuthorType,
  { label: string; accent: BubbleStyle; labelStyle: LabelStyle }
> = {
  HUMAN_HR: {
    label: "HR",
    accent: { background: "#ecfdf5", color: "#115e59" },
    labelStyle: { background: "#ecfdf5", color: "#0f766e" },
  },
  HUMAN_CANDIDATE: {
    label: "Кандидат",
    accent: { background: "#f0fdfa", color: "#134e4a" },
    labelStyle: { background: "#f0fdfa", color: "#0f766e" },
  },
  AGENT_ARBITER: {
    label: "Arbiter",
    accent: { background: "#f3f4f6", color: "#374151" },
    labelStyle: { background: "#e5e7eb", color: "#374151" },
  },
  AGENT_COMPANY: {
    label: "Компанія",
    accent: { background: "#ecfdf5", color: "#0f766e" },
    labelStyle: { background: "#d1fae5", color: "#065f46" },
  },
  AGENT_CANDIDATE: {
    label: "Кандидат (AI)",
    accent: { background: "#f0fdfa", color: "#115e59" },
    labelStyle: { background: "#ccfbf1", color: "#0f766e" },
  },
};
```

Also update the neutral label in `messageStyles` return for non-own human:

```typescript
  return {
    bubble: NEUTRAL_BUBBLE,
    label: { background: "#f3f4f6", color: "#6b7280" },
    own: false,
  };
```

- [ ] **Step 2: Grep-guard against purple leftovers in this file**

Run: `rg -n "5b21b6|6d28d9|ede9fe|fce7f3|ffedd5|#2563eb" frontend/src/utils/live-message-styles.ts`

Expected: no matches.

- [ ] **Step 3: Verify build**

Run: `npm --workspace frontend run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/live-message-styles.ts
git commit -m "feat: retune live chat colors to teal/slate palette"
```

---

### Task 4: Live room components

**Files:**
- Modify: `frontend/src/components/LiveChatPanel.vue`
- Modify: `frontend/src/components/AgentStatusPanel.vue`
- Modify: `frontend/src/components/InterviewRoomContent.vue`
- Modify: `frontend/src/views/HrInterviewRoomView.vue`
- Modify: `frontend/src/views/CandidateInterviewRoomView.vue`

- [ ] **Step 1: Restyle `LiveChatPanel.vue` primary/error/composer**

У `<style scoped>` замінити hardcoded blue/red на токени. Мінімальні заміни:

```css
.error-banner {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: var(--radius);
  font-size: 0.875rem;
}
.composer-input {
  flex: 1;
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  resize: vertical;
  min-height: 2.5rem;
  background: var(--surface);
}
.composer-input:focus {
  outline: 2px solid var(--accent-focus);
  border-color: var(--accent);
}
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid var(--accent);
  cursor: pointer;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
```

Also ensure the chat container (root / messages area) uses `background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);` if it currently has bare borders — keep layout unchanged, only colors/radius.

- [ ] **Step 2: Restyle `AgentStatusPanel.vue`**

Replace thinking/idle colors:

```css
.agent-panel {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.panel-title {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.agent-item.thinking {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-border);
}
.agent-item.idle {
  background: var(--surface-muted);
  color: var(--muted);
  border: 1px solid transparent;
}
.panel-hint {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--muted);
}
```

Keep `.agent-list` / `.agent-item` flex layout as-is (only color/border updates above).

- [ ] **Step 3: Restyle `InterviewRoomContent.vue` banners/links**

```css
.btn-danger {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid #fca5a5;
  background: var(--surface);
  color: var(--danger);
  cursor: pointer;
}
.success-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  background: var(--accent-soft);
  color: #065f46;
  border-radius: 6px;
  font-size: 0.875rem;
}
.report-link {
  display: inline-block;
  margin-bottom: 0.75rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
}
.error-banner,
.agent-error-banner {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: 6px;
  font-size: 0.875rem;
}
.phase-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  background: var(--warning-soft);
  color: var(--warning);
  border-radius: 6px;
  font-size: 0.875rem;
}
```

- [ ] **Step 4: Thin restyle of room wrapper views**

In `HrInterviewRoomView.vue` and `CandidateInterviewRoomView.vue` `<style scoped>`:

- `font-family: system-ui, sans-serif` → `font-family: var(--font)`
- link blue `#2563eb` → `var(--accent)`
- error `#b00020` → `var(--danger)`

- [ ] **Step 5: Verify build + visual smoke**

Run: `npm --workspace frontend run build`

Manual: open live room (або порожню кімнату) — primary button teal, agent thinking teal soft, no purple.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/LiveChatPanel.vue \
  frontend/src/components/AgentStatusPanel.vue \
  frontend/src/components/InterviewRoomContent.vue \
  frontend/src/views/HrInterviewRoomView.vue \
  frontend/src/views/CandidateInterviewRoomView.vue
git commit -m "feat: apply Calm Slate tokens to live interview room UI"
```

---

### Task 5: Sweep remaining screens (CTA + danger + font)

**Files:**
- Modify logins: `LoginView.vue`, `CandidateLoginView.vue`, `CandidateRegisterView.vue`
- Modify homes/lists: `HrHomeView.vue`, `CandidateHomeView.vue`, `InterviewListView.vue`, `VacancyListView.vue`, `CandidateInterviewView.vue`, `VacancyDetailView.vue`, `InterviewDetailView.vue`, `ReportView.vue`, `CandidateProfileView.vue`
- Modify prep: `VacancyPrepView.vue`, `CandidatePrepView.vue`, `ChatPanel.vue`, `CandidatePrepChat.vue` (якщо є blue CTA)
- Modify modals: `CreateInterviewModal.vue`, `CreateVacancyModal.vue`, `JoinInterviewModal.vue`

- [ ] **Step 1: Mechanical color/font sweep**

For each file above, in `<style scoped>` only:

1. Replace `font-family: system-ui, sans-serif` (and `Georgia, serif` in `LoginView.vue` h1) with `font-family: var(--font)` / inherit from body
2. Replace primary button/link blues:
   - `#2563eb` → `var(--accent)`
   - `#1d4ed8` → `var(--accent)`
   - disabled blue `#93c5fd` → use `opacity: 0.55` on accent instead
3. Replace error reds `#b00020` / `#b91c1c` → `var(--danger)` where they are error text/borders
4. Active/selected blues like `#dbeafe` + `#1d4ed8` → `var(--accent-soft)` + `var(--accent)` if still present

Do **not** change business logic, templates (except removing leftover emoji-only chrome if encountered in these files), or layout structure.

- [ ] **Step 2: Grep-guard remaining forbidden accents on frontend**

Run:

```bash
rg -n "#2563eb|#1d4ed8|#5b21b6|#6d28d9|#ede9fe|Georgia" frontend/src --glob '*.{vue,ts,css}'
```

Expected: no matches (або лише коментарі/не UI; якщо є — виправити в цьому ж task).

- [ ] **Step 3: Verify build + lint**

Run:

```bash
npm --workspace frontend run lint
npm --workspace frontend run build
```

Expected: PASS both.

- [ ] **Step 4: Manual checklist (spec DoD)**

- [ ] Tokens available globally (inspect `:root` in DevTools)
- [ ] IBM Plex Sans on main screens
- [ ] HR + Candidate shells match
- [ ] Live room close to mockup (teal CTA, soft agent states)
- [ ] Primary CTA / active nav use teal, not blue/purple
- [ ] No new purple/glow/cream-editorial accents

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views frontend/src/components
git commit -m "feat: sweep frontend screens onto Calm Slate + Teal tokens"
```

---

## Self-review (vs spec)

| Spec requirement | Task |
|------------------|------|
| CSS tokens globally | Task 1 |
| IBM Plex Sans | Task 1 |
| HrLayout + CandidateLayout shell | Task 2 |
| Sidebars active teal | Task 2 |
| Live room / chat / agent panel | Tasks 3–4 |
| Login / lists / prep / report token alignment | Task 5 |
| No purple/blue decorative accents | Tasks 3–5 grep guards |
| No dark mode / marketing / icon system | Explicitly out of plan |
| No Tailwind rewrite | Confirmed — CSS variables only |

**Placeholder scan:** none intentionally left.

**Type consistency:** `live-message-styles` public API unchanged (`labelFor`, `isOwnMessage`, `messageStyles`, `LiveAuthorType`).

---

## Execution notes

- Не чіпати незакомічені backend зміни в робочому дереві — цей план лише frontend visual.
- Якщо `npm run dev` уже запущений, після Task 1 Vite HMR підхопить CSS; інакше перезапустити.
- Emoji в sidebar прибираємо свідомо (spec antipattern); labels залишаються.

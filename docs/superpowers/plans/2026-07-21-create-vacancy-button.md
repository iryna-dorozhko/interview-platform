# Create Vacancy Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a create-vacancy CTA on the Vacancies tab and rename the home CTA to «Створити нову вакансію», reusing `CreateVacancyModal`.

**Architecture:** Wire `CreateVacancyModal` into `VacancyListView` the same way `HrHomeView` already does (local `showVacancyModal` + navigate to `vacancy-prep` on `@created`). Only rename the home button label; no API or route changes.

**Tech Stack:** Vue 3, Vue Router, existing `CreateVacancyModal` + `createVacancy` API client.

## Global Constraints

- Reuse existing `CreateVacancyModal`; do not invent a new create flow.
- Home CTA text must be exactly «Створити нову вакансію».
- Vacancies CTA text must be exactly «Створити вакансію».
- On successful create from either screen, navigate to `{ name: "vacancy-prep", params: { id: vacancyId } }`.
- No backend changes.

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/views/HrHomeView.vue` | Rename home CTA label only |
| `frontend/src/views/VacancyListView.vue` | Add create button, modal, empty-state copy, navigate to prep |
| `frontend/src/components/CreateVacancyModal.vue` | Unchanged (reuse as-is) |

---

### Task 1: Rename home CTA

**Files:**
- Modify: `frontend/src/views/HrHomeView.vue`

**Interfaces:**
- Consumes: existing `showVacancyModal`, `CreateVacancyModal`, `onVacancyCreated`
- Produces: button label «Створити нову вакансію»

- [ ] **Step 1: Rename the button text**

In `frontend/src/views/HrHomeView.vue`, change:

```vue
        <button type="button" class="btn-primary" @click="showVacancyModal = true">
          Створити нову анкету
        </button>
```

to:

```vue
        <button type="button" class="btn-primary" @click="showVacancyModal = true">
          Створити нову вакансію
        </button>
```

- [ ] **Step 2: Verify visually**

Run frontend if not already running, open HR home (`/`), confirm the primary button reads «Створити нову вакансію» and still opens the create modal.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/HrHomeView.vue
git commit -m "$(cat <<'EOF'
fix(ui): rename home CTA to create vacancy

EOF
)"
```

---

### Task 2: Add create button and modal on Vacancies tab

**Files:**
- Modify: `frontend/src/views/VacancyListView.vue`

**Interfaces:**
- Consumes: `CreateVacancyModal` (`open: boolean`, emits `close`, `created: [vacancyId: string]`)
- Produces: Vacancies page CTA «Створити вакансію» that creates a vacancy and navigates to prep

- [ ] **Step 1: Import modal and add open/created handlers**

At the top of `frontend/src/views/VacancyListView.vue` script, add the modal import next to the other imports:

```ts
import CreateVacancyModal from "../components/CreateVacancyModal.vue";
```

After the existing refs (`actionError`), add:

```ts
const showVacancyModal = ref(false);
```

After `goToDetail`, add:

```ts
function onVacancyCreated(vacancyId: string): void {
  showVacancyModal.value = false;
  router.push({ name: "vacancy-prep", params: { id: vacancyId } });
}
```

- [ ] **Step 2: Update template — header, empty state, modal**

Replace the template header and empty state, and mount the modal. Target structure:

```vue
<template>
  <div class="vacancy-list">
    <div class="list-header">
      <h1>Вакансії</h1>
      <button type="button" class="btn-primary" @click="showVacancyModal = true">
        Створити вакансію
      </button>
    </div>

    <p v-if="listState === 'loading'">Завантаження…</p>
    <p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
    <p v-else-if="vacancies.length === 0" class="muted">
      У вас ще немає вакансій. Натисніть «Створити вакансію», щоб додати першу.
    </p>
    <template v-else>
      <!-- existing table unchanged -->
    </template>

    <CreateVacancyModal
      :open="showVacancyModal"
      @close="showVacancyModal = false"
      @created="onVacancyCreated"
    />
  </div>
</template>
```

Keep the existing table/`actionError` block inside the `v-else` template branch exactly as it is today.

- [ ] **Step 3: Add header layout styles**

In the scoped `<style>` of `VacancyListView.vue`, add:

```css
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.vacancy-list h1 {
  margin: 0;
  font-size: 1.25rem;
}
```

Remove or replace the previous `.vacancy-list h1 { margin: 0 0 1rem; ... }` rule so margin lives on `.list-header` instead of only on `h1`.

Ensure `.btn-primary` styles already present in this file still apply to the new header button (they do — no new button classes needed).

- [ ] **Step 4: Manual verification**

1. Open `/vacancies` as HR.
2. Confirm header shows «Створити вакансію».
3. Click it → modal opens.
4. Submit a title → redirect to `/vacancies/:id/prep`.
5. With an empty list, confirm empty-state copy mentions the same-page button (not home).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/VacancyListView.vue
git commit -m "$(cat <<'EOF'
feat(ui): add create vacancy button on vacancies tab

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Home CTA → «Створити нову вакансію» | Task 1 |
| Vacancies button «Створити вакансію» | Task 2 |
| Reuse `CreateVacancyModal` | Task 2 |
| Navigate to `vacancy-prep` after create | Task 2 (`onVacancyCreated`) |
| Update empty-state copy | Task 2 |
| No backend / no new routes | Both tasks (UI only) |

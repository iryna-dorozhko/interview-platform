# HR Sidebar «Співбесіди» ↔ «Заявки» (order swap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поменяти місцями порядок пунктів у HR-сайдбарі, щоб «Заявки» відображалися перед «Співбесіди», без зміни маршрутів.

**Architecture:** Зміни локалізовані у `frontend/src/components/HrSidebar.vue`: переставляються два `RouterLink` у `<template>`. Доданий Node-based тест гарантує, що порядок текстових міток у шаблоні зберігається.

**Tech Stack:** Vue 3, vue-router, `node:test` (frontend тести запуском через `tsx`).

## Global Constraints
- Змінити лише `<template>` у `HrSidebar.vue`, переставивши два `RouterLink`.
- `to="/interviews"` та `to="/applications"` і логіка `:class="{ active: isActive('...') }` не змінюються.
---

### Task 1: Swap HR sidebar order + add failing/green test

**Files:**
- Create: `frontend/src/components/HrSidebar.order.test.ts`
- Modify: `frontend/src/components/HrSidebar.vue:39-48`
- Modify: `frontend/package.json:6-12`

**Interfaces:**
- The test reads `frontend/src/components/HrSidebar.vue` as a string and asserts that the index of `Заявки` is before `Співбесіди`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/HrSidebar.order.test.ts` with the following content:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("HrSidebar: renders 'Заявки' before 'Співбесіди' in the template", () => {
  const path = fileURLToPath(new URL("./HrSidebar.vue", import.meta.url));
  const source = readFileSync(path, "utf8");

  const appsIdx = source.indexOf("Заявки");
  const interviewsIdx = source.indexOf("Співбесіди");

  assert.notEqual(appsIdx, -1, "Expected to find 'Заявки' in HrSidebar.vue");
  assert.notEqual(interviewsIdx, -1, "Expected to find 'Співбесіди' in HrSidebar.vue");

  // The UI order must be 'Заявки' first, then 'Співбесіди'
  assert.ok(
    appsIdx < interviewsIdx,
    `Expected 'Заявки' before 'Співбесіди', but appsIdx=${appsIdx} interviewsIdx=${interviewsIdx}`,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd frontend
node --import tsx --test src/components/HrSidebar.order.test.ts
```

Expected: `FAIL` with an assertion message like `Expected 'Заявки' before 'Співбесіди'...` (because current sidebar order is interviews → applications).

- [ ] **Step 3: Write minimal implementation**

1) Modify `frontend/src/components/HrSidebar.vue` by swapping the two `RouterLink` blocks (keep their `to` and `isActive(...)` checks unchanged).

Replace the current block:
```vue
    <RouterLink to="/interviews" class="nav-item" :class="{ active: isActive('/interviews') }">
      Співбесіди
    </RouterLink>
    <RouterLink
      to="/applications"
      class="nav-item"
      :class="{ active: isActive('/applications') }"
    >
      Заявки
    </RouterLink>
```

with:
```vue
    <RouterLink
      to="/applications"
      class="nav-item"
      :class="{ active: isActive('/applications') }"
    >
      Заявки
    </RouterLink>
    <RouterLink to="/interviews" class="nav-item" :class="{ active: isActive('/interviews') }">
      Співбесіди
    </RouterLink>
```

2) Update `frontend/package.json` test script to include the new test file so it runs in CI:

Change:
```json
    "test": "node --import tsx --test src/composables/usePrepChat.test.ts src/composables/useDialogUnread.test.ts src/utils/typing-indicator.test.ts"
```

To:
```json
    "test": "node --import tsx --test src/composables/usePrepChat.test.ts src/composables/useDialogUnread.test.ts src/utils/typing-indicator.test.ts src/components/HrSidebar.order.test.ts"
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd frontend
npm test
```

Expected: `PASS` and include the newly added test file in the output.

- [ ] **Step 5: Commit**

Run:
```bash
git add frontend/src/components/HrSidebar.vue frontend/src/components/HrSidebar.order.test.ts frontend/package.json
git commit -m "chore: swap HR sidebar tab order"
```

## Execution Handoff
Plan complete and saved to `docs/superpowers/plans/2026-07-29-hr-sidebar-interviews-applications-order-swap.md`.

Two execution options:
1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent to implement the task task-by-task.
2. **Inline Execution** — I implement the task directly in this session.

Який підхід вибираєш (1 або 2)?

# HR View Ended Live Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give HR explicit links from interview detail and report pages to open a completed shared live chat in the existing read-only room UI.

**Architecture:** Frontend-only. Reuse `/interviews/:id/room` (`interview-room`) and existing Socket.IO `ENDED` → `readOnly` behavior. No backend, router, or composable changes.

**Tech Stack:** Vue 3 + Vue Router (`RouterLink`).

**Spec:** `docs/superpowers/specs/2026-07-22-hr-view-ended-live-chat-design.md`

## Global Constraints

- Audience: HR only (candidate UI unchanged).
- Link copy exactly: `Переглянути спільний чат` (no trailing arrow required; match accent link style on the page).
- Target route: `{ name: 'interview-room', params: { id: <interviewId> } }`.
- No new REST API, Prisma models, Socket handlers, or dedicated transcript page.
- No room UI polish (no extra archive banner, no hiding AgentStatusPanel).
- No new button on interview list.
- Do not remove or alter existing report links.

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/views/InterviewDetailView.vue` | Show chat link when `status === 'ENDED'` |
| `frontend/src/views/ReportView.vue` | Show chat link using `report.interviewId` |

No new files. No frontend unit-test harness in this repo — verify manually in browser.

---

### Task 1: Link on `InterviewDetailView`

**Files:**
- Modify: `frontend/src/views/InterviewDetailView.vue`

**Interfaces:**
- Consumes: `interview.status`, `interview.id` from existing `InterviewDetail` load
- Produces: `RouterLink` visible only when `interview.status === 'ENDED'`

- [ ] **Step 1: Add chat section for ENDED interviews**

In the template, after the report section (`v-if="interview.reportId"`) and before the READY/muted paragraphs, insert:

```vue
      <section v-if="interview.status === 'ENDED'" class="report-section">
        <h2>Спільний чат</h2>
        <RouterLink :to="{ name: 'interview-room', params: { id: interview.id } }">
          Переглянути спільний чат
        </RouterLink>
      </section>
```

Reuse existing `.report-section` styles (already style `a` as accent links). Do not change the report section.

- [ ] **Step 2: Manual verify (detail)**

1. Open an interview with `status === 'ENDED'` at `/interviews/:id`.
2. Confirm section «Спільний чат» with link «Переглянути спільний чат».
3. Click → `/interviews/:id/room`, history loads, input disabled, banner «Співбесіда завершена» (existing).
4. If the interview has a report, confirm «Переглянути повний звіт →» still works.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/InterviewDetailView.vue
git commit -m "$(cat <<'EOF'
feat(fe): link ended interview chat from detail page

EOF
)"
```

---

### Task 2: Link on `ReportView`

**Files:**
- Modify: `frontend/src/views/ReportView.vue`

**Interfaces:**
- Consumes: `report.interviewId` from existing `FinalReport` (`frontend/src/api/reports.ts`)
- Produces: `RouterLink` to `interview-room` whenever the report is loaded

- [ ] **Step 1: Add chat link under the report title**

Inside `<template v-else-if="report">`, immediately after `<h1>Звіт про співбесіду</h1>`, insert:

```vue
      <p class="chat-link-row">
        <RouterLink
          :to="{ name: 'interview-room', params: { id: report.interviewId } }"
          class="chat-link"
        >
          Переглянути спільний чат
        </RouterLink>
      </p>
```

`RouterLink` is already imported in this file.

- [ ] **Step 2: Add scoped styles**

In the `<style scoped>` block of `ReportView.vue`, add:

```css
.chat-link-row {
  margin: 0 0 1.25rem;
}
.chat-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875rem;
}
.chat-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 3: Manual verify (report)**

1. Open `/report/:id` for an ended interview.
2. Confirm «Переглянути спільний чат» under the title.
3. Click → same room as Task 1 for that `interviewId`, read-only history visible.
4. Confirm decision actions and report body still work.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ReportView.vue
git commit -m "$(cat <<'EOF'
feat(fe): link ended interview chat from report page

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| HR-only entry (no candidate changes) | Tasks 1–2 touch only HR views |
| Link on interview detail when ENDED | Task 1 |
| Link on report via `interviewId` | Task 2 |
| Reuse existing room + Socket read-only | Both tasks navigate to `interview-room` only |
| No list button / no REST / no room polish | Explicitly omitted |
| Keep report link | Task 1 does not alter report section |

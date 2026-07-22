# HR Report «Переглянути співбесіду» Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the report-page entry to the ended shared live chat a visible secondary button labeled «Переглянути співбесіду».

**Architecture:** Frontend-only change in `ReportView.vue`. Keep the existing `RouterLink` to `interview-room` (`/interviews/:id/room`); restyle it as `.btn-secondary` and update copy. No backend, router, or composable changes.

**Tech Stack:** Vue 3 + Vue Router (`RouterLink`).

**Spec:** `docs/superpowers/specs/2026-07-22-hr-view-ended-live-chat-design.md`

## Global Constraints

- Audience: HR only (candidate UI unchanged).
- Button copy exactly: `Переглянути співбесіду`.
- Target route: `{ name: 'interview-room', params: { id: report.interviewId } }`.
- Placement: directly under the page `h1` «Звіт про співбесіду», before the score / recommendation row.
- Use `RouterLink` with button classes (not `<button>` + `router.push`).
- Reuse existing `.btn-secondary` styles already defined in `ReportView.vue`.
- Do not change `InterviewDetailView`, room UI, Socket.IO, or decision actions on the report.
- No new REST API, Prisma models, routes, or transcript page.

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/views/ReportView.vue` | Replace text link with secondary button look + new copy; remove unused `.chat-link*` styles |

No new files. No frontend unit-test harness required — verify manually in browser.

---

### Task 1: Secondary button on `ReportView`

**Files:**
- Modify: `frontend/src/views/ReportView.vue`

**Interfaces:**
- Consumes: `report.interviewId` from existing `fetchReport` / `FinalReport`
- Produces: `RouterLink` with classes `btn-secondary` (and optional layout class), text `Переглянути співбесіду`

- [ ] **Step 1: Replace the text link markup**

In the template, find:

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

Replace with:

```vue
      <p class="chat-actions">
        <RouterLink
          :to="{ name: 'interview-room', params: { id: report.interviewId } }"
          class="btn-secondary chat-action-btn"
        >
          Переглянути співбесіду
        </RouterLink>
      </p>
```

Keep this block immediately after `<h1>Звіт про співбесіду</h1>` and before `.summary-row`.

- [ ] **Step 2: Update scoped styles**

Remove unused:

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

Add (place near other layout helpers, before or after `.error-banner`):

```css
.chat-actions {
  margin: 0 0 1.25rem;
}
.chat-action-btn {
  display: inline-block;
  text-decoration: none;
  box-sizing: border-box;
}
.chat-action-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

Do **not** redefine `.btn-secondary` — it already exists later in the same `<style scoped>` block and must keep working for decision modal / actions.

If `RouterLink` + `.btn-secondary` looks vertically misaligned, ensure `chat-action-btn` keeps `display: inline-block` and inherits the existing padding from `.btn-secondary` (shared selector `.btn-primary, .btn-secondary, .btn-danger`).

- [ ] **Step 3: Manual verify**

1. Open a finished interview report at `/report/:id` (or `/reports` → open one).
2. Under the title, confirm a secondary **button** labeled exactly `Переглянути співбесіду` (not a plain accent text link, not the old «Переглянути спільний чат»).
3. Click → `/interviews/:id/room`, message history loads, composer disabled (`ENDED` read-only).
4. Confirm decision buttons (Прийняти / Додаткова зустріч / Відхилити) still look and work the same.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ReportView.vue
git commit -m "$(cat <<'EOF'
feat(fe): make report chat entry a secondary button

EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Secondary button under report `h1` | Task 1 Step 1 |
| Copy «Переглянути співбесіду» | Task 1 Step 1 |
| Route `interview-room` + `report.interviewId` | Task 1 Step 1 |
| Reuse `.btn-secondary` | Task 1 Steps 1–2 |
| No InterviewDetailView / backend / room polish | Global Constraints + single-file scope |
| Manual test: visible button → read-only room | Task 1 Step 3 |

No placeholders. Single focused task — appropriate for this UX-only change.

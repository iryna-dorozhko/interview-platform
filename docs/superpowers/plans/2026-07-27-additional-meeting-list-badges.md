# Additional Meeting List Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показати позначку «Додаткова» біля назви в списку співбесід і біля email у списку звітів, коли `Interview.kind === ADDITIONAL_MEETING`.

**Architecture:** Reuse існуючий `Interview.kind`. Розширити `GET /api/reports` полем `interviewKind`. На фронті додати компактний badge у першій клітинці рядка обох списків. Співбесіди вже мають `kind` у DTO — лише UI.

**Tech Stack:** Express + Prisma + node:test (backend), Vue 3 + TypeScript (frontend).

**Spec:** `docs/superpowers/specs/2026-07-27-additional-meeting-list-badges-design.md`

## Global Constraints

- Текст badge: рівно `Додаткова`.
- Показувати лише коли `kind` / `interviewKind` === `ADDITIONAL_MEETING`.
- Звіти: badge біля email; співбесіди: badge біля `displayName`.
- Нейтральний стиль (не кольори HIRE/MAYBE/REJECT).
- Без фільтра за типом, без змін деталі звіту / `displayName`.
- TDD для backend reports list; frontend — `npm run build`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/routes/reports.ts` | Select `interview.kind`, map `interviewKind` |
| `backend/src/routes/reports.test.ts` | Assert `interviewKind` на list |
| `frontend/src/api/reports.ts` | Тип `ReportSummary.interviewKind` |
| `frontend/src/views/ReportListView.vue` | Badge біля email |
| `frontend/src/views/InterviewListView.vue` | Badge біля назви |

---

### Task 1: Expose `interviewKind` on GET /api/reports

**Files:**
- Modify: `backend/src/routes/reports.ts`
- Modify: `backend/src/routes/reports.test.ts`

**Interfaces:**
- Consumes: `Interview.kind`
- Produces: list item field `interviewKind: "STANDARD" | "ADDITIONAL_MEETING"`

- [ ] **Step 1: Write failing test**

Extend `FakeReport` / fake prisma include so interviews can carry `kind`. Update existing summary test and add:

```typescript
test("GET /reports includes interviewKind from interview.kind", async () => {
  const additional: FakeReport = {
    ...sampleReport,
    id: "rep_add",
    interviewId: "i_add",
    interviewKind: "ADDITIONAL_MEETING",
  };
  const standard = { ...sampleReport, interviewKind: "STANDARD" as const };
  const app = makeApp(makeFakePrisma([standard, additional]), {
    id: "hr_1",
    email: "hr@test.com",
    role: "HR",
  });
  // ...fetch /api/reports
  const byId = Object.fromEntries(body.reports.map((r: { id: string }) => [r.id, r]));
  assert.equal(byId.rep_1.interviewKind, "STANDARD");
  assert.equal(byId.rep_add.interviewKind, "ADDITIONAL_MEETING");
});
```

Also add `assert.equal(body.reports[0].interviewKind, "STANDARD")` (or from sample) to `GET /reports returns only current HR reports with summary fields`.

Wire fake prisma `findMany` include so `interview.kind` comes from `FakeReport.interviewKind` (default `"STANDARD"`).

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd backend && node --import tsx --test src/routes/reports.test.ts`  
Expected: FAIL (`interviewKind` undefined).

- [ ] **Step 3: Implement**

In `reports.ts` `findMany` include:

```typescript
interview: {
  select: {
    vacancyId: true,
    kind: true,
    candidateUser: { select: { email: true } },
    vacancy: { select: { id: true, title: true } },
  },
},
```

In map:

```typescript
interviewKind: report.interview.kind,
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd backend && node --import tsx --test src/routes/reports.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts
git commit -m "feat(api): include interviewKind in reports list"
```

---

### Task 2: Frontend badges on interview and report lists

**Files:**
- Modify: `frontend/src/api/reports.ts`
- Modify: `frontend/src/views/ReportListView.vue`
- Modify: `frontend/src/views/InterviewListView.vue`

**Interfaces:**
- Consumes: `ReportSummary.interviewKind`, `InterviewSummary.kind`
- Produces: visible badge «Додаткова»

- [ ] **Step 1: Extend ReportSummary type**

```typescript
export type ReportSummary = {
  // ...existing
  interviewKind: "STANDARD" | "ADDITIONAL_MEETING";
};
```

- [ ] **Step 2: ReportListView — badge beside email**

In the email cell, after the `RouterLink` (or wrap in a flex row):

```vue
<td class="primary-cell">
  <RouterLink ... class="email-link">{{ report.candidateEmail ?? "—" }}</RouterLink>
  <span
    v-if="report.interviewKind === 'ADDITIONAL_MEETING'"
    class="kind-badge"
  >Додаткова</span>
</td>
```

CSS (neutral, compact):

```css
.primary-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.kind-badge {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: #e5e7eb;
  color: #374151;
}
```

Keep recommendation badge styles unchanged.

- [ ] **Step 3: InterviewListView — badge beside displayName**

```vue
<td class="primary-cell">
  <button type="button" class="name-link" @click="goToRoom(interview.id)">
    {{ interview.displayName }}
  </button>
  <span
    v-if="interview.kind === 'ADDITIONAL_MEETING'"
    class="kind-badge"
  >Додаткова</span>
</td>
```

Reuse the same `.primary-cell` / `.kind-badge` styles (duplicate scoped CSS is OK; do not extract shared component unless already trivial — YAGNI).

- [ ] **Step 4: Frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/reports.ts \
  frontend/src/views/ReportListView.vue \
  frontend/src/views/InterviewListView.vue
git commit -m "feat(fe): show additional meeting badge in interview and report lists"
```

---

### Task 3: Verification

- [ ] **Step 1: Backend suite**

Run: `cd backend && npm test`  
Expected: PASS.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS.

- [ ] **Step 3: Manual checklist (defer if no UI)**

```text
1) ADDITIONAL_MEETING interview у списку співбесід — badge «Додаткова» біля назви.
2) STANDARD — без badge.
3) Звіт з additional interview — badge біля email.
4) STANDARD report — без badge.
```

- [ ] **Step 4: Commit only if fixes needed**

---

## Self-Review

- Spec coverage: API `interviewKind`, both list UIs, copy «Додаткова», placement — covered.
- No placeholders / TBD.
- Field name `interviewKind` matches spec (not confused with recommendation).

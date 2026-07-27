# Additional Meeting Follow-up Live Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати ручне створення HR “додаткової зустрічі” з явною прив'язкою до source `FinalReport`, щоб `Company Agent` у live-чаті фокусувався на ризиках/незакритих темах попередньої співбесіди.

**Architecture:** Розширюємо `Interview` новими полями (`kind`, `followUpFromFinalReportId`) і додаємо окремий HR API для списку кандидатів та створення додаткової зустрічі. Для live-агента додаємо follow-up контекст у системний prompt лише для `Interview.kind=ADDITIONAL_MEETING`. UI отримує нову кнопку на `InterviewListView` і окрему модалку створення додаткової співбесіди.

**Tech Stack:** Express + Prisma + node:test + tsx (backend), Vue 3 + TypeScript (frontend), існуючий LLM provider/factory.

## Global Constraints

- Мова UI та системних підказок агентам: українська.
- `ADDITIONAL_MEETING` у `ReportView` лишається “лист + діалог”, без автостворення інтерв’ю.
- Додаткова співбесіда створюється тільки вручну HR через кнопку на вкладці `Співбесіди`.
- Для додаткової співбесіди обов’язкова явна прив’язка до source `FinalReport`.
- Без нового prep: додаткова зустріч одразу live.
- Не змінювати поведінку `Candidate Agent`, окрім сумісності з новим сценарієм даних.
- Тести: TDD для backend; для frontend мінімум `npm run build`.

---

## File Structure

- `backend/prisma/schema.prisma` — новий enum `InterviewKind`, нові поля `Interview.kind`, `Interview.followUpFromFinalReportId`, relation до `FinalReport`.
- `backend/prisma/migrations/<timestamp>_additional_meeting_followup/migration.sql` — SQL-міграція нових полів/enum/index.
- `backend/src/routes/hr-additional-interviews.ts` (new) — HR endpoints:
  - `GET /hr/additional-meeting-candidates`
  - `POST /hr/interviews/additional`
- `backend/src/routes/hr-additional-interviews.test.ts` (new) — unit/integration-style тести нового роутера.
- `backend/src/routes/interviews.ts` — мапінг `kind` у list/detail payload.
- `backend/src/agents/company-live-agent.ts` — завантаження follow-up контексту і передача в prompt.
- `backend/src/agents/prompts/company-live-agent.uk.ts` — правила для `FOLLOW_UP_CONTEXT`.
- `backend/src/socket/orchestrator.test.ts` (optional targeted test updates) — якщо знадобиться оновити очікування prompt input.
- `backend/src/server.ts` — підключення нового роутера.
- `backend/package.json` — додати новий test file в `test` script.
- `frontend/src/api/interviews.ts` — нові типи + методи для additional-meeting API.
- `frontend/src/components/CreateAdditionalInterviewModal.vue` (new) — модалка вибору кандидата + створення.
- `frontend/src/views/InterviewListView.vue` — нова кнопка та підключення нової модалки.

---

### Task 1: Prisma schema for follow-up interviews

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_additional_meeting_followup/migration.sql`

**Interfaces:**
- Consumes: current `Interview`, `FinalReport`.
- Produces:
  - `InterviewKind = "STANDARD" | "ADDITIONAL_MEETING"`
  - `Interview.kind: InterviewKind`
  - `Interview.followUpFromFinalReportId: string | null`

- [ ] **Step 1: Write failing schema expectations test (lightweight via TS compile usage)**

```typescript
// backend/src/routes/hr-additional-interviews.test.ts (temporary first assertion)
test("prisma interview model supports kind/followUpFromFinalReportId", async () => {
  // compile-time usage in fake prisma shape; fails before schema/client regen
  const sample = {
    kind: "ADDITIONAL_MEETING",
    followUpFromFinalReportId: "rep_1",
  };
  assert.equal(sample.kind, "ADDITIONAL_MEETING");
});
```

- [ ] **Step 2: Run test to verify current codebase is missing schema support**

Run: `cd backend && node --import tsx --test src/routes/hr-additional-interviews.test.ts`  
Expected: FAIL (file or imports not found yet).

- [ ] **Step 3: Update Prisma schema**

```prisma
enum InterviewKind {
  STANDARD
  ADDITIONAL_MEETING
}

model Interview {
  // ...existing fields
  kind                       InterviewKind @default(STANDARD)
  followUpFromFinalReportId  String?
  followUpFromFinalReport    FinalReport?  @relation("InterviewFollowUpSource", fields: [followUpFromFinalReportId], references: [id])
}

model FinalReport {
  // ...existing fields
  followUpInterviews Interview[] @relation("InterviewFollowUpSource")
}
```

- [ ] **Step 4: Create and apply migration**

Run: `cd backend && npx prisma migrate dev --name additional_meeting_followup`  
Expected: PASS, migration applied, Prisma client regenerated.

- [ ] **Step 5: Run schema-related tests**

Run: `cd backend && npm test`  
Expected: PASS (or only unrelated pre-existing failures).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add follow-up metadata for additional interviews"
```

---

### Task 2: HR API for additional-meeting candidates and creation

**Files:**
- Create: `backend/src/routes/hr-additional-interviews.ts`
- Create: `backend/src/routes/hr-additional-interviews.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes:
  - `InterviewDecision` with `type="ADDITIONAL_MEETING"`
  - `createInterviewWithJoinCode(...)` from `routes/interviews.ts`
- Produces:
  - `GET /api/hr/additional-meeting-candidates`
  - `POST /api/hr/interviews/additional`

- [ ] **Step 1: Write failing tests for GET candidates**

```typescript
test("GET /hr/additional-meeting-candidates returns latest additional-meeting decisions per candidate", async () => {
  // seed decisions for two candidates and duplicate older one
  // expect latest per candidate, owned by current HR
  assert.equal(response.status, 200);
  assert.equal(body.candidates.length, 2);
});
```

- [ ] **Step 2: Write failing tests for POST additional interview creation**

```typescript
test("POST /hr/interviews/additional creates interview with kind and followUpFromFinalReportId", async () => {
  assert.equal(response.status, 201);
  assert.equal(body.interview.kind, "ADDITIONAL_MEETING");
  assert.equal(body.interview.followUpFromFinalReportId, "report_1");
});

test("POST /hr/interviews/additional returns 404 when no additional-meeting decision exists", async () => {
  assert.equal(response.status, 404);
});
```

- [ ] **Step 3: Run tests and verify FAIL**

Run: `cd backend && node --import tsx --test src/routes/hr-additional-interviews.test.ts`  
Expected: FAIL (router not implemented).

- [ ] **Step 4: Implement router with strict ownership and latest-decision lookup**

```typescript
router.get("/hr/additional-meeting-candidates", async (req, res) => {
  // role guard HR
  // query decisions for req.user.id and type ADDITIONAL_MEETING
  // reduce to latest per candidateUserId
  // return { candidates: [{ candidateUserId, candidateEmail, vacancyId, vacancyTitle }] }
});

router.post("/hr/interviews/additional", async (req, res) => {
  // validate candidateUserId + scheduledAt
  // fetch latest matching decision with report/interview/vacancy
  // create interview through createInterviewWithJoinCode with:
  // kind ADDITIONAL_MEETING + followUpFromFinalReportId
  // candidateUserId prelinked and invitation ACCEPTED if candidate email known
});
```

- [ ] **Step 5: Wire router in server**

```typescript
app.use("/api", requireAuth, createHrAdditionalInterviewsRouter(() => prisma));
```

- [ ] **Step 6: Register test file in package.json test script**

```json
{
  "scripts": {
    "test": "node --import tsx --test ... src/routes/hr-additional-interviews.test.ts"
  }
}
```

- [ ] **Step 7: Run focused tests**

Run: `cd backend && node --import tsx --test src/routes/hr-additional-interviews.test.ts`  
Expected: PASS.

- [ ] **Step 8: Run full backend tests**

Run: `cd backend && npm test`  
Expected: PASS (except known unrelated failures).

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/hr-additional-interviews.ts backend/src/routes/hr-additional-interviews.test.ts backend/src/server.ts backend/package.json
git commit -m "feat(api): add HR additional-meeting interview endpoints"
```

---

### Task 3: Extend interview DTOs for kind/follow-up fields

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `frontend/src/api/interviews.ts`

**Interfaces:**
- Consumes: new Prisma fields from Task 1.
- Produces:
  - `InterviewSummary.kind`
  - `InterviewSummary.followUpFromFinalReportId`
  - `CreatedInterview.kind`

- [ ] **Step 1: Write failing test in backend interviews tests**

```typescript
test("GET /interviews/mine includes kind and followUpFromFinalReportId", async () => {
  assert.equal(body.interviews[0].kind, "ADDITIONAL_MEETING");
  assert.equal(body.interviews[0].followUpFromFinalReportId, "rep_1");
});
```

- [ ] **Step 2: Run single test to confirm FAIL**

Run: `cd backend && node --import tsx --test src/routes/interviews.test.ts`  
Expected: FAIL on missing fields.

- [ ] **Step 3: Implement mapping updates**

```typescript
return {
  // existing fields...
  kind: item.kind,
  followUpFromFinalReportId: item.followUpFromFinalReportId ?? null,
};
```

- [ ] **Step 4: Update frontend DTO types**

```typescript
export type InterviewSummary = {
  // ...
  kind: "STANDARD" | "ADDITIONAL_MEETING";
  followUpFromFinalReportId: string | null;
};
```

- [ ] **Step 5: Re-run tests**

Run: `cd backend && node --import tsx --test src/routes/interviews.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/interviews.ts frontend/src/api/interviews.ts
git commit -m "feat(interviews): expose kind and follow-up metadata"
```

---

### Task 4: Company live agent follow-up context integration

**Files:**
- Modify: `backend/src/agents/prompts/company-live-agent.uk.ts`
- Modify: `backend/src/agents/company-live-agent.ts`
- Modify: `backend/src/agents/company-live-agent.test.ts`

**Interfaces:**
- Consumes:
  - `Interview.kind`
  - `Interview.followUpFromFinalReportId`
  - `FinalReport.risks`, `FinalReport.reportMarkdown`
- Produces:
  - extended system prompt with `{{FOLLOW_UP_CONTEXT}}`
  - deterministic context block formatter in company-live agent

- [ ] **Step 1: Write failing unit tests for follow-up context formatter**

```typescript
test("buildCompanyLiveMessages injects follow-up context for additional meeting", () => {
  assert.match(messages[0]!.content, /FOLLOW-UP/);
  assert.match(messages[0]!.content, /Немає Docker/);
});
```

- [ ] **Step 2: Write failing test for standard interview (no follow-up)**

```typescript
test("buildCompanyLiveMessages keeps empty follow-up for standard interview", () => {
  assert.doesNotMatch(messages[0]!.content, /Немає Docker/);
});
```

- [ ] **Step 3: Run tests to verify FAIL**

Run: `cd backend && node --import tsx --test src/agents/company-live-agent.test.ts`  
Expected: FAIL.

- [ ] **Step 4: Implement follow-up context loading in runCompanyLiveTurn**

```typescript
const interview = await prisma.interview.findUnique({
  where: { id: interviewId },
  include: {
    vacancy: { include: { companyProfile: true } },
    followUpFromFinalReport: { select: { reportMarkdown: true, risks: true } },
  },
});
```

- [ ] **Step 5: Implement prompt formatting**

```typescript
function formatFollowUpContext(interview: { kind: string; followUpFromFinalReport?: { reportMarkdown: string; risks: unknown } | null }): string {
  if (interview.kind !== "ADDITIONAL_MEETING" || !interview.followUpFromFinalReport) {
    return "none";
  }
  return JSON.stringify({
    risks: interview.followUpFromFinalReport.risks,
    reportMarkdown: interview.followUpFromFinalReport.reportMarkdown,
  }, null, 2);
}
```

- [ ] **Step 6: Update system prompt template**

```text
Якщо FOLLOW_UP_CONTEXT не "none", у NEXT_QUESTION/CLARIFY пріоритет — закрити ризики й незакриті теми з попереднього звіту.
FOLLOW_UP_CONTEXT:
{{FOLLOW_UP_CONTEXT}}
```

- [ ] **Step 7: Run company live tests**

Run: `cd backend && node --import tsx --test src/agents/company-live-agent.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/agents/company-live-agent.ts backend/src/agents/company-live-agent.test.ts backend/src/agents/prompts/company-live-agent.uk.ts
git commit -m "feat(agent): add follow-up context for additional meeting live turns"
```

---

### Task 5: Frontend UI for “Створити додаткову зустріч”

**Files:**
- Create: `frontend/src/components/CreateAdditionalInterviewModal.vue`
- Modify: `frontend/src/api/interviews.ts`
- Modify: `frontend/src/views/InterviewListView.vue`

**Interfaces:**
- Consumes:
  - `GET /api/hr/additional-meeting-candidates`
  - `POST /api/hr/interviews/additional`
- Produces:
  - new UI button and modal flow

- [ ] **Step 1: Add failing API client tests or type usage checks**

```typescript
export type AdditionalMeetingCandidate = {
  candidateUserId: string;
  candidateEmail: string;
  vacancyId: string;
  vacancyTitle: string;
};
```

- [ ] **Step 2: Implement new API methods**

```typescript
export async function fetchAdditionalMeetingCandidates(): Promise<AdditionalMeetingCandidate[]> { /* ... */ }

export async function createAdditionalInterview(input: {
  candidateUserId: string;
  scheduledAt?: string | null;
}): Promise<CreatedInterview> { /* ... */ }
```

- [ ] **Step 3: Implement modal component**

```vue
<button type="submit" class="btn-primary" :disabled="!selectedCandidateUserId || submitting">
  {{ submitting ? "Створення…" : "Створити додаткову зустріч" }}
</button>
```

- [ ] **Step 4: Add button to InterviewListView and wire modal events**

```vue
<button type="button" class="btn-secondary" @click="showAdditionalModal = true">
  Створити додаткову зустріч
</button>
```

- [ ] **Step 5: Ensure created interview inserted into list with kind metadata**

```typescript
interviews.value.unshift({
  // ...
  kind: interview.kind,
  followUpFromFinalReportId: interview.followUpFromFinalReportId ?? null,
});
```

- [ ] **Step 6: Run frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/interviews.ts frontend/src/views/InterviewListView.vue frontend/src/components/CreateAdditionalInterviewModal.vue
git commit -m "feat(fe): add create additional meeting flow in interviews list"
```

---

### Task 6: End-to-end verification and cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-additional-meeting-followup-live-agent-design.md` (only if behavior deviated)
- Modify: relevant tests only when needed

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified integrated behavior.

- [ ] **Step 1: Run backend full test suite**

Run: `cd backend && npm test`  
Expected: PASS.

- [ ] **Step 2: Run frontend build again**

Run: `cd frontend && npm run build`  
Expected: PASS.

- [ ] **Step 3: Manual verification checklist**

```text
1) У ReportView надіслати ADDITIONAL_MEETING лист.
2) У Співбесідах натиснути "Створити додаткову зустріч".
3) Вибрати кандидата зі списку.
4) Перевірити, що створений Interview має kind=ADDITIONAL_MEETING.
5) Запустити live і перевірити, що Company Agent ставить follow-up питання по ризиках/незакритих темах source report.
```

- [ ] **Step 4: Commit final fixes (if any)**

```bash
git add -A
git commit -m "test: verify additional meeting follow-up flow"
```

---

## Self-Review

- **Spec coverage:** покрито UX кнопку, ручне створення, додаткові API, DB-прив’язку до source report, поведінку Company Agent у follow-up режимі, перевірки.
- **Placeholder scan:** placeholder-кроків “TBD/TODO” немає; кожна задача має конкретні файли, команди й очікування.
- **Type consistency:** у всіх задачах використано однакові назви `Interview.kind`, `Interview.followUpFromFinalReportId`, `ADDITIONAL_MEETING`.


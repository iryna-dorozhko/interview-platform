# Additional Meeting: Disable Candidate Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У live-кімнаті `Interview.kind === ADDITIONAL_MEETING` не викликати Candidate Agent і не показувати його в UI; залишити Company Agent, Arbiter, HR і живого кандидата.

**Architecture:** Follow-up nudge в Arbiter prompt + hard skip у RoomOrchestrator перед `runCandidate` + прокинути `kind` у room UI і сховати рядок «Кандидат (AI)» у `AgentStatusPanel`. STANDARD без змін.

**Tech Stack:** Express + Prisma + node:test + tsx (backend), Vue 3 + TypeScript (frontend), існуючий Socket.IO orchestrator.

**Spec:** `docs/superpowers/specs/2026-07-27-additional-meeting-no-candidate-agent-design.md`

## Global Constraints

- Scope лише `Interview.kind === ADDITIONAL_MEETING`.
- STANDARD live: Candidate Agent поведінка без регресії.
- Candidate Agent не публікує повідомлення і не викликається в additional.
- Після питання Company — чекати `HUMAN_CANDIDATE` / HR (`WAIT` / skip ANSWER).
- UI: сховати «Кандидат (AI)» лише для additional.
- Мова nudge/UI: українська.
- TDD для backend; frontend — `npm run build`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/agents/prompts/arbiter-agent.uk.ts` | Опційний follow-up блок / константа nudge |
| `backend/src/agents/arbiter-agent.ts` | Читати `kind`; передавати follow-up mode в `buildArbiterMessages` |
| `backend/src/agents/arbiter-agent.test.ts` | Тести nudge / STANDARD без nudge |
| `backend/src/socket/orchestrator.ts` | Skip Candidate Agent для ADDITIONAL_MEETING |
| `backend/src/socket/orchestrator.test.ts` | Тест: ANSWER не викликає candidate |
| `backend/src/routes/candidate-interview.ts` | Додати `kind` у payload кандидата |
| `frontend/src/api/candidate-interview.ts` | Тип `kind` |
| `frontend/src/views/HrInterviewRoomView.vue` | Прокинути `kind` |
| `frontend/src/views/CandidateInterviewRoomView.vue` | Прокинути `kind` |
| `frontend/src/components/InterviewRoomContent.vue` | Prop `interviewKind` → panel |
| `frontend/src/components/AgentStatusPanel.vue` | Фільтр списку агентів |

---

### Task 1: Arbiter follow-up mode (no ANSWER / CANDIDATE_QUESTIONS)

**Files:**
- Modify: `backend/src/agents/prompts/arbiter-agent.uk.ts`
- Modify: `backend/src/agents/arbiter-agent.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`

**Interfaces:**
- Consumes: `Interview.kind`
- Produces:
  - `export const ADDITIONAL_MEETING_ARBITER_NUDGE_UK: string`
  - `buildArbiterMessages({ ..., interviewKind?: "STANDARD" | "ADDITIONAL_MEETING" })`
  - `runArbiterTurn` loads `kind` and passes it

- [ ] **Step 1: Write failing tests**

```typescript
test("buildArbiterMessages includes additional-meeting nudge when kind is ADDITIONAL_MEETING", () => {
  const messages = buildArbiterMessages({
    companyProfile,
    history: [],
    pendingQuestion: false,
    interviewKind: "ADDITIONAL_MEETING",
  });
  const joined = messages.map((m) => m.content).join("\n");
  assert.match(joined, /ADDITIONAL_MEETING|додатков|Candidate Agent немає|без Candidate Agent|WAIT/i);
  assert.match(joined, /ANSWER|CANDIDATE_QUESTIONS/i); // nudge forbids them
});

test("buildArbiterMessages omits additional-meeting nudge for STANDARD", () => {
  const messages = buildArbiterMessages({
    companyProfile,
    history: [],
    pendingQuestion: false,
    interviewKind: "STANDARD",
  });
  const last = messages.at(-1)?.content ?? "";
  assert.equal(last, NO_PENDING_QUESTION_NUDGE_UK);
  assert.doesNotMatch(messages.map((m) => m.content).join("\n"), /Candidate Agent немає/);
});
```

Adjust assertions to match the exact Ukrainian nudge text you add.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd backend && node --import tsx --test src/agents/arbiter-agent.test.ts`  
Expected: FAIL (unknown option / nudge missing).

- [ ] **Step 3: Implement nudge constant + builder**

In `arbiter-agent.uk.ts` or as exported const in `arbiter-agent.ts`:

```typescript
export const ADDITIONAL_MEETING_ARBITER_NUDGE_UK =
  "[Система] Режим додаткової зустрічі: Candidate Agent ВІДСУТНІЙ. " +
  "НЕ використовуй ANSWER і CANDIDATE_QUESTIONS. " +
  "Після питання Company / відкритого питання — WAIT (відповідає HUMAN_CANDIDATE або HR). " +
  "Дозволені: START, NEXT_QUESTION, CLARIFY, COMPANY_ANSWER, WAIT, SUGGEST_END.";
```

`buildArbiterMessages`: after pending/no-pending nudge, if `interviewKind === "ADDITIONAL_MEETING"`, push another user message with `ADDITIONAL_MEETING_ARBITER_NUDGE_UK`.

`runArbiterTurn`: select `kind` from interview; default `"STANDARD"` if missing; pass to builder.

- [ ] **Step 4: Update existing `runArbiterTurn` fake prisma fixtures** to include `kind: "STANDARD"` so old tests still match last-message expectations (pending nudge remains last unless additional — for additional tests, pending + additional both present; assert additional appears in messages).

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd backend && node --import tsx --test src/agents/arbiter-agent.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/arbiter-agent.ts \
  backend/src/agents/arbiter-agent.test.ts \
  backend/src/agents/prompts/arbiter-agent.uk.ts
git commit -m "feat(arbiter): follow-up mode without candidate agent"
```

---

### Task 2: Orchestrator hard-skip Candidate Agent

**Files:**
- Modify: `backend/src/socket/orchestrator.ts`
- Modify: `backend/src/socket/orchestrator.test.ts`

**Interfaces:**
- Consumes: `prisma.interview.findUnique({ select: { kind: true } })` inside conductor (or cache once per loop)
- Produces: no `runCandidate` / no candidate thinking emit for ADDITIONAL_MEETING on ANSWER / CANDIDATE_QUESTIONS

- [ ] **Step 1: Write failing orchestrator test**

Inspect how `makePrisma` works in `orchestrator.test.ts`. Extend fake interview lookup if needed.

```typescript
test("orchestrator skips Candidate Agent for ADDITIONAL_MEETING on ANSWER", async () => {
  const messages: LiveMessage[] = [
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "AGENT_COMPANY",
      content: "Розкажіть детальніше про Docker.",
      createdAt: new Date(),
    },
  ];
  const prisma = makePrisma(messages, { interviewKind: "ADDITIONAL_MEETING" });
  // OR patch prisma.interview.findUnique to return { kind: "ADDITIONAL_MEETING" }
  const { io } = makeIo();
  let candidateCalls = 0;
  let arbiterCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 3,
    runArbiterTurn: async () => {
      arbiterCalls += 1;
      if (arbiterCalls === 1) {
        return cmd({ action: "ANSWER", summaryUk: "Чекаємо кандидата", briefUk: "Docker" });
      }
      return cmd({ action: "WAIT", summaryUk: "Чекаємо людину" });
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return { post: true, message: "Не має з'явитись", needsHuman: false };
    },
    runCompanyLiveTurn: async () => ({ post: false }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(candidateCalls, 0);
});
```

Adapt `makePrisma` signature as needed — keep the assertion `candidateCalls === 0`.

Also assert: no `room:messages` from `AGENT_CANDIDATE`; optional: after skip, next arbiter sees pending still true (if easy).

- [ ] **Step 2: Run focused test — expect FAIL**

Run: `cd backend && node --import tsx --test src/socket/orchestrator.test.ts`  
Expected: FAIL (candidate still called).

- [ ] **Step 3: Implement skip in `runConductorLoop`**

At start of loop body (once per loop is enough):

```typescript
const interviewMeta = await prisma.interview.findUnique({
  where: { id: interviewId },
  select: { kind: true },
});
const isAdditionalMeeting = interviewMeta?.kind === "ADDITIONAL_MEETING";
```

Before `if (runCandidateActions) {`:

```typescript
if (runCandidateActions && isAdditionalMeeting) {
  if (command.action === "ANSWER") {
    state.pendingQuestion = true;
  }
  // Do not emit AGENT_CANDIDATE thinking; do not call runCandidate.
  break; // or continue to arbiter next step with WAIT semantics
}
```

Prefer `break` after ANSWER skip so conductor stops and waits for human message (same as WAIT). For `CANDIDATE_QUESTIONS`, skip and `break` without posting.

Do **not** emit `room:agent-error`.

- [ ] **Step 4: Run orchestrator tests — expect PASS**

Run: `cd backend && node --import tsx --test src/socket/orchestrator.test.ts`  
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/orchestrator.ts backend/src/socket/orchestrator.test.ts
git commit -m "feat(live): skip candidate agent on additional meetings"
```

---

### Task 3: Frontend — hide Candidate (AI) + expose kind to candidate room

**Files:**
- Modify: `backend/src/routes/candidate-interview.ts` (+ test if exists)
- Modify: `frontend/src/api/candidate-interview.ts`
- Modify: `frontend/src/views/HrInterviewRoomView.vue`
- Modify: `frontend/src/views/CandidateInterviewRoomView.vue`
- Modify: `frontend/src/components/InterviewRoomContent.vue`
- Modify: `frontend/src/components/AgentStatusPanel.vue`

**Interfaces:**
- `interviewKind?: "STANDARD" | "ADDITIONAL_MEETING" | null` prop on room content / panel
- Candidate GET interview includes `kind`

- [ ] **Step 1: Add `kind` to candidate interview payload**

Find `interviewPayload` in `candidate-interview.ts` and include `kind: interview.kind` (default STANDARD from DB).

Update frontend type:

```typescript
export type CandidateInterview = {
  id: string;
  displayName: string;
  status: string;
  kind: "STANDARD" | "ADDITIONAL_MEETING";
};
```

If backend tests for candidate interview exist, assert `kind` present.

- [ ] **Step 2: Wire kind through room views**

`HrInterviewRoomView`: store `interviewKind` from `fetchInterview().kind`, pass to `InterviewRoomContent`.

`CandidateInterviewRoomView`: store from `fetchCandidateInterview().kind`, pass similarly.

`InterviewRoomContent` props:

```typescript
interviewKind?: "STANDARD" | "ADDITIONAL_MEETING" | null;
```

Pass to `AgentStatusPanel`.

- [ ] **Step 3: Filter AgentStatusPanel**

```typescript
const props = defineProps<{
  agentThinking: AgentThinkingState | null;
  processLog?: ArbiterProcessEntry[];
  interviewKind?: "STANDARD" | "ADDITIONAL_MEETING" | null;
}>();

const visibleAgents = computed(() =>
  props.interviewKind === "ADDITIONAL_MEETING"
    ? AGENTS.filter((a) => a.key !== "AGENT_CANDIDATE")
    : AGENTS,
);
```

Template: `v-for="agent in visibleAgents"`. Update `activeAgent` label lookup to use `visibleAgents` or full `AGENTS` (full AGENTS OK for label fallback).

- [ ] **Step 4: Frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-interview.ts \
  frontend/src/api/candidate-interview.ts \
  frontend/src/views/HrInterviewRoomView.vue \
  frontend/src/views/CandidateInterviewRoomView.vue \
  frontend/src/components/InterviewRoomContent.vue \
  frontend/src/components/AgentStatusPanel.vue
git commit -m "feat(fe): hide candidate AI agent on additional meetings"
```

---

### Task 4: Verification

**Files:** none required unless fixes

- [ ] **Step 1: Backend full suite**

Run: `cd backend && npm test`  
Expected: PASS.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS.

- [ ] **Step 3: Manual checklist (document in report if deferred)**

```text
1) Створити ADDITIONAL_MEETING interview.
2) LIVE: Company ставить питання → немає повідомлень AGENT_CANDIDATE.
3) Панель AI без «Кандидат (AI)».
4) Живий кандидат відповідає → Company/Arbiter продовжують.
5) STANDARD interview: Candidate Agent як раніше.
```

- [ ] **Step 4: Commit only if fixes were needed**

---

## Self-Review

- **Spec coverage:** Arbiter nudge, orchestrator skip, UI hide, STANDARD unchanged — усі в tasks 1–3.
- **Placeholders:** немає TBD.
- **Consistency:** `ADDITIONAL_MEETING` / `STANDARD` names match Prisma enum.

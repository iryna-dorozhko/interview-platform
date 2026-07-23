# Agent Evaluation Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматично зберігати per-interview eval-snapshot (тривалості prep/live, retries, HR interventions, clarifying, match, HR decision, agreement) і дати eng-only API + CLI для порівняння періодів.

**Architecture:** Таблиця `InterviewEvalSnapshot` (1:1 з `Interview`). In-memory counters під час candidate prep + live; фаза 1 upsert після `FinalReport`; фаза 2 update після `InterviewDecision`. Live agents маркують `kind: "clarifying" | "normal"`. Порівняння періодів — за `reportCreatedAt` (`from` inclusive, `to` exclusive).

**Tech Stack:** Prisma, Express, Socket.IO orchestrator, Node test runner (`node --import tsx --test`), root/backend npm scripts.

## Global Constraints

- Призначення: eng-аналіз ефективності змін агентів (не HR UI).
- Прив’язка до змін: лише час (`reportCreatedAt`); без git SHA / eval labels.
- Етапи: prep candidate + prep vacancy + live (цілком); без внутрішніх фаз live; без company-global prep.
- HR: `hrMessageCount` = усі `HUMAN_HR` у live; `hrControlActionCount` = окремо (`room:agent-retry`, end live).
- Clarifying: явний `kind` у JSON відповіді live-агентів.
- Retries у snapshot: лише candidate prep + live (не vacancy/company prep).
- Eval API: `EVAL_API_TOKEN`; без токена в env → 503; невірний Bearer → 401.
- Збій eval writer не ламає report/decision (best-effort + log).
- In-memory counters до фази 1 можуть втратитись при рестарті процесу (known limitation MVP).

**Spec:** `docs/superpowers/specs/2026-07-23-agent-eval-framework-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | модель `InterviewEvalSnapshot` + relation на `Interview` |
| `backend/prisma/migrations/...` | SQL migration |
| `backend/src/services/interview-eval-agreement.ts` | `hrAgreedWithArbiter(...)` |
| `backend/src/services/interview-eval-durations.ts` | duration helpers |
| `backend/src/services/interview-eval-counters.ts` | in-memory per-interview counters |
| `backend/src/services/interview-eval.ts` | phase1 upsert, phase2 update, list/summary |
| `backend/src/services/interview-eval*.test.ts` | unit tests |
| `backend/src/llm/retry.ts` | optional `onRetry` callback |
| `backend/src/agents/agent-post-reply.ts` | optional `kind` |
| `backend/src/agents/candidate-live-agent.ts` | optional `kind` |
| `backend/src/agents/prompts/company-live-agent.uk.ts` | document `kind` |
| `backend/src/agents/prompts/candidate-live-agent.uk.ts` | document `kind` |
| `backend/src/socket/orchestrator.ts` | bump counters on publish / manual retry |
| `backend/src/socket/room.ts` | bump control on agent-retry (якщо не в orchestrator) |
| `backend/src/routes/candidate-prep.ts` | `onRetry` → autoRetry; manual retry → manualRetry |
| `backend/src/routes/interviews.ts` | set `LiveSession.endedAt`; phase1 after report |
| `backend/src/routes/reports.ts` | phase2 after decision |
| `backend/src/routes/eval.ts` | `GET /eval/snapshots`, `GET /eval/summary` |
| `backend/src/routes/eval.test.ts` | API auth + filter tests |
| `backend/src/server.ts` | mount eval router (без requireHr) |
| `backend/scripts/eval-report.ts` | CLI |
| `backend/package.json` | `eval:report` + test entries |
| `.env.example` | `EVAL_API_TOKEN` |

---

### Task 1: Agreement + duration helpers

**Files:**
- Create: `backend/src/services/interview-eval-agreement.ts`
- Create: `backend/src/services/interview-eval-agreement.test.ts`
- Create: `backend/src/services/interview-eval-durations.ts`
- Create: `backend/src/services/interview-eval-durations.test.ts`
- Modify: `backend/package.json` (`test` script — append the two new test files)

**Interfaces:**
- Produces:
  - `hrAgreedWithArbiter(recommendation: "HIRE" \| "MAYBE" \| "REJECT", decision: "ACCEPT" \| "REJECT" \| "ADDITIONAL_MEETING"): boolean`
  - `prepDurationMs(session: { isClosed: boolean; createdAt: Date; updatedAt: Date } \| null): number \| null`
  - `liveDurationMs(session: { startedAt: Date; endedAt: Date \| null } \| null): number \| null`

- [ ] **Step 1: Write failing agreement tests**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { hrAgreedWithArbiter } from "./interview-eval-agreement";

const pairs: Array<{
  rec: "HIRE" | "MAYBE" | "REJECT";
  dec: "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";
  agreed: boolean;
}> = [
  { rec: "HIRE", dec: "ACCEPT", agreed: true },
  { rec: "REJECT", dec: "REJECT", agreed: true },
  { rec: "MAYBE", dec: "ADDITIONAL_MEETING", agreed: true },
  { rec: "HIRE", dec: "REJECT", agreed: false },
  { rec: "HIRE", dec: "ADDITIONAL_MEETING", agreed: false },
  { rec: "REJECT", dec: "ACCEPT", agreed: false },
  { rec: "REJECT", dec: "ADDITIONAL_MEETING", agreed: false },
  { rec: "MAYBE", dec: "ACCEPT", agreed: false },
  { rec: "MAYBE", dec: "REJECT", agreed: false },
];

for (const { rec, dec, agreed } of pairs) {
  test(`hrAgreedWithArbiter ${rec} + ${dec} => ${agreed}`, () => {
    assert.equal(hrAgreedWithArbiter(rec, dec), agreed);
  });
}
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

Run: `cd backend && node --import tsx --test src/services/interview-eval-agreement.test.ts`  
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement agreement**

```ts
import type { InterviewDecisionType, Recommendation } from "@prisma/client";

const AGREED: Record<Recommendation, InterviewDecisionType> = {
  HIRE: "ACCEPT",
  REJECT: "REJECT",
  MAYBE: "ADDITIONAL_MEETING",
};

export function hrAgreedWithArbiter(
  recommendation: Recommendation,
  decision: InterviewDecisionType,
): boolean {
  return AGREED[recommendation] === decision;
}
```

- [ ] **Step 4: Run agreement tests — PASS**

- [ ] **Step 5: Write failing duration tests**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveDurationMs, prepDurationMs } from "./interview-eval-durations";

test("prepDurationMs null when session missing or not closed", () => {
  assert.equal(prepDurationMs(null), null);
  assert.equal(
    prepDurationMs({
      isClosed: false,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T11:00:00.000Z"),
    }),
    null,
  );
});

test("prepDurationMs uses updatedAt - createdAt when closed", () => {
  assert.equal(
    prepDurationMs({
      isClosed: true,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:05:00.000Z"),
    }),
    5 * 60_000,
  );
});

test("liveDurationMs null without endedAt", () => {
  assert.equal(liveDurationMs(null), null);
  assert.equal(
    liveDurationMs({
      startedAt: new Date("2026-07-01T12:00:00.000Z"),
      endedAt: null,
    }),
    null,
  );
});

test("liveDurationMs endedAt - startedAt", () => {
  assert.equal(
    liveDurationMs({
      startedAt: new Date("2026-07-01T12:00:00.000Z"),
      endedAt: new Date("2026-07-01T13:30:00.000Z"),
    }),
    90 * 60_000,
  );
});
```

- [ ] **Step 6: Implement durations**

```ts
export function prepDurationMs(
  session: { isClosed: boolean; createdAt: Date; updatedAt: Date } | null,
): number | null {
  if (!session || !session.isClosed) return null;
  return session.updatedAt.getTime() - session.createdAt.getTime();
}

export function liveDurationMs(
  session: { startedAt: Date; endedAt: Date | null } | null,
): number | null {
  if (!session?.endedAt) return null;
  return session.endedAt.getTime() - session.startedAt.getTime();
}
```

- [ ] **Step 7: Run duration tests — PASS; append both test files to `backend/package.json` `test` script**

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/interview-eval-agreement.ts \
  backend/src/services/interview-eval-agreement.test.ts \
  backend/src/services/interview-eval-durations.ts \
  backend/src/services/interview-eval-durations.test.ts \
  backend/package.json
git commit -m "feat(eval): add agreement and duration helpers"
```

---

### Task 2: Prisma `InterviewEvalSnapshot`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration via `npm run db:migrate --workspace=backend`

**Interfaces:**
- Produces: Prisma model `InterviewEvalSnapshot` with fields from spec; `Interview.evalSnapshot InterviewEvalSnapshot?`

- [ ] **Step 1: Add model to schema** (after `FinalReport` / near `Interview` relations)

On `Interview` add:

```prisma
  evalSnapshot       InterviewEvalSnapshot?
```

New model:

```prisma
model InterviewEvalSnapshot {
  id                        String                  @id @default(cuid())
  interviewId               String                  @unique
  prepCandidateDurationMs   Int?
  prepVacancyDurationMs     Int?
  liveDurationMs            Int?
  autoRetryCount            Int                     @default(0)
  manualRetryCount          Int                     @default(0)
  hrMessageCount            Int                     @default(0)
  hrControlActionCount      Int                     @default(0)
  clarifyingQuestionCount   Int                     @default(0)
  agentMessageCount         Int                     @default(0)
  finalMatchScore           Int?
  arbiterRecommendation     Recommendation?
  hrDecisionType            InterviewDecisionType?
  hrAgreedWithArbiter       Boolean?
  reportCreatedAt           DateTime?
  decisionUpdatedAt         DateTime?
  createdAt                 DateTime                @default(now())
  updatedAt                 DateTime                @updatedAt
  interview                 Interview               @relation(fields: [interviewId], references: [id])

  @@index([reportCreatedAt])
}
```

- [ ] **Step 2: Migrate**

Run: `cd backend && npx prisma migrate dev --name interview_eval_snapshot`  
Expected: migration applied, client generated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add InterviewEvalSnapshot model"
```

---

### Task 3: In-memory eval counters

**Files:**
- Create: `backend/src/services/interview-eval-counters.ts`
- Create: `backend/src/services/interview-eval-counters.test.ts`
- Modify: `backend/package.json` (append test)

**Interfaces:**
- Produces:
  - `type InterviewEvalRuntimeCounters = { autoRetryCount; manualRetryCount; hrControlActionCount; clarifyingQuestionCount; agentMessageCount }` (all `number`)
  - `bumpAutoRetry(interviewId: string): void`
  - `bumpManualRetry(interviewId: string): void`
  - `bumpHrControl(interviewId: string): void`
  - `bumpAgentMessage(interviewId: string, kind: "clarifying" \| "normal"): void`
  - `getCounters(interviewId: string): InterviewEvalRuntimeCounters`
  - `clearCounters(interviewId: string): void` (for tests / after flush)
  - `resetAllEvalCounters(): void` (tests only)

- [ ] **Step 1: Write failing tests** (import missing module)

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bumpAgentMessage,
  bumpAutoRetry,
  bumpHrControl,
  bumpManualRetry,
  clearCounters,
  getCounters,
  resetAllEvalCounters,
} from "./interview-eval-counters";

test.beforeEach(() => {
  resetAllEvalCounters();
});

test("bumps accumulate per interviewId", () => {
  bumpAutoRetry("i1");
  bumpAutoRetry("i1");
  bumpManualRetry("i1");
  bumpHrControl("i1");
  bumpAgentMessage("i1", "normal");
  bumpAgentMessage("i1", "clarifying");
  assert.deepEqual(getCounters("i1"), {
    autoRetryCount: 2,
    manualRetryCount: 1,
    hrControlActionCount: 1,
    clarifyingQuestionCount: 1,
    agentMessageCount: 2,
  });
  assert.deepEqual(getCounters("missing"), {
    autoRetryCount: 0,
    manualRetryCount: 0,
    hrControlActionCount: 0,
    clarifyingQuestionCount: 0,
    agentMessageCount: 0,
  });
});

test("clearCounters zeroes one interview", () => {
  bumpAutoRetry("i1");
  clearCounters("i1");
  assert.equal(getCounters("i1").autoRetryCount, 0);
});
```

- [ ] **Step 2: Implement Map-backed store** (default zeros on get; mutate copy-on-write or mutate entry)

- [ ] **Step 3: Tests PASS; append to package.json test; commit**

```bash
git commit -m "feat(eval): add in-memory interview eval counters"
```

---

### Task 4: Phase 1 / Phase 2 / summary service

**Files:**
- Create: `backend/src/services/interview-eval.ts`
- Create: `backend/src/services/interview-eval.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: durations, agreement, counters, Prisma
- Produces:
  - `upsertEvalAfterReport(prisma, interviewId): Promise<void>` — best-effort caller wraps try/catch
  - `updateEvalAfterDecision(prisma, interviewId): Promise<void>`
  - `listEvalSnapshots(prisma, from: Date, to: Date)`
  - `summarizeEvalSnapshots(snapshots): EvalSummary`

Fake prisma in tests (minimal stubs for `interview.findUnique`, `liveMessage.count`, `interviewEvalSnapshot.upsert/update`, `interviewDecision.findFirst`) — follow patterns from `reports.test.ts`.

**Phase 1 algorithm:**
1. Load interview with `prepSessionCd`, `vacancy.prepSessionHr`, `liveSession`, `finalReport`.
2. If no `finalReport` — no-op (or throw in service; route should only call after create).
3. `hrMessageCount` = count `LiveMessage` where `authorType === "HUMAN_HR"` for session.
4. `agentMessageCount` = max(DB count of `AGENT_*`, runtime `agentMessageCount`).
5. Merge runtime counters for retries/control/clarifying (clarifying from runtime only).
6. Upsert snapshot fields; set decision fields null on create; on update keep existing decision fields if already set.
7. `clearCounters(interviewId)` after successful upsert.

**Phase 2:**
1. Latest `InterviewDecision` by `createdAt desc`.
2. Load snapshot / report recommendation; set `hrDecisionType`, `hrAgreedWithArbiter`, `decisionUpdatedAt`.

**Summary:**
```ts
export type EvalSummary = {
  snapshotCount: number;
  withDecisionCount: number;
  avgPrepCandidateDurationMs: number | null;
  avgPrepVacancyDurationMs: number | null;
  avgLiveDurationMs: number | null;
  avgAutoRetryCount: number;
  avgManualRetryCount: number;
  avgHrMessageCount: number;
  avgHrControlActionCount: number;
  clarifyingRate: number; // sum clarifying / sum agentMessages, else 0
  avgFinalMatchScore: number | null;
  agreementRate: number | null; // agreed / with non-null agreement
};
```

Helper `avg(nums: number[]): number | null` — null if empty.

- [ ] **Step 1: Write tests** for agreement merge in phase2, duration fill, summary math, clearCounters after phase1 (mock prisma).

- [ ] **Step 2: Implement `interview-eval.ts`**

- [ ] **Step 3: Tests PASS; commit**

```bash
git commit -m "feat(eval): add phase1/phase2 snapshot and summary service"
```

---

### Task 5: `withLlmRetry` `onRetry` + candidate-prep wiring

**Files:**
- Modify: `backend/src/llm/retry.ts`
- Modify: `backend/src/llm/retry.test.ts`
- Modify: `backend/src/agents/arbiter-agent.ts` (pass `onRetry` when interviewId known)
- Modify: `backend/src/agents/company-live-agent.ts`
- Modify: `backend/src/agents/candidate-live-agent.ts`
- Modify: `backend/src/routes/candidate-prep.ts`
- Modify: related tests if signatures change

**Interfaces:**
- Extend `WithLlmRetryOptions` with `onRetry?: (attemptIndex: number) => void`  
  Call **after** a failed retryable attempt and **before** sleep, with `attemptIndex` of the failed attempt (0-based). Caller bumps autoRetry once per scheduled retry.

- [ ] **Step 1: Failing test** — `onRetry` called once when first attempt fails then succeeds

```ts
test("withLlmRetry calls onRetry before each retry attempt", async () => {
  let calls = 0;
  let attempts = 0;
  const result = await withLlmRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new LlmUnavailableError("temp");
      return "ok";
    },
    {
      sleep: async () => {},
      onRetry: () => {
        calls += 1;
      },
    },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Implement hook in retry loop** (where `hasMore && retryable` before sleep)

- [ ] **Step 3: Wire live agents** — each `withLlmRetry(..., { onRetry: () => bumpAutoRetry(interviewId) })` where `interviewId` already in turn context.

- [ ] **Step 4: Wire candidate-prep** — on LLM `withLlmRetry` for message/finish that has `interviewId` from session: `onRetry: () => bumpAutoRetry(interviewId)`.

- [ ] **Step 5: Candidate prep manual retry path** — when request is regenerate/retry without new user text, `bumpManualRetry(interviewId)` once at start of that handler.

- [ ] **Step 6: Tests PASS; commit**

```bash
git commit -m "feat(eval): count auto/manual retries for candidate prep and live"
```

---

### Task 6: Optional `kind` on live agent replies

**Files:**
- Modify: `backend/src/agents/agent-post-reply.ts`
- Modify: `backend/src/agents/agent-post-reply.test.ts`
- Modify: `backend/src/agents/candidate-live-agent.ts`
- Modify: `backend/src/agents/candidate-live-agent.test.ts`
- Modify: `backend/src/agents/prompts/company-live-agent.uk.ts`
- Modify: `backend/src/agents/prompts/candidate-live-agent.uk.ts`

**Interfaces:**
- `ParsedPostReply.kind?: "clarifying" | "normal"` — omit/`normal` → treat as normal; invalid string → parse error OR coerce to normal (prefer: invalid → `AgentPostReplyParseError` only if present and not in set; omit OK).

- [ ] **Step 1: Failing tests**

```ts
test("parsePostReply accepts kind clarifying", () => {
  const result = parsePostReply(
    '{ "post": true, "message": "Уточніть стек?", "kind": "clarifying" }',
  );
  assert.equal(result.kind, "clarifying");
});

test("parsePostReply defaults kind to normal when omitted", () => {
  const result = parsePostReply('{ "post": true, "message": "Привіт" }');
  assert.equal(result.kind, "normal");
});
```

Same idea for `parseCandidateLiveReply` when `post: true`.

- [ ] **Step 2: Implement parse + prompt lines**

In company/candidate live prompts, add:

```
Опційне поле kind: "clarifying" якщо це уточнююче питання; інакше "normal" або пропустити.
```

Update JSON example in prompts to include `"kind": "normal"`.

- [ ] **Step 3: Tests PASS; commit**

```bash
git commit -m "feat(agents): optional clarifying kind on live agent replies"
```

---

### Task 7: Orchestrator / room instrumentation

**Files:**
- Modify: `backend/src/socket/orchestrator.ts`
- Modify: `backend/src/socket/orchestrator.test.ts`
- Modify: `backend/src/socket/room.ts` (if end-session / agent-retry handled here)
- Modify: `backend/src/routes/interviews.ts` for end → also `bumpHrControl` when HR ends interview

**Rules:**
- When persisting a public agent message (`AGENT_COMPANY` / `AGENT_CANDIDATE` / `AGENT_ARBITER` with content):  
  `bumpAgentMessage(interviewId, reply.kind === "clarifying" ? "clarifying" : "normal")`  
  (Arbiter public messages: kind `normal` unless arbiter schema later gets kind — MVP always normal for arbiter.)
- `onAgentRetry`: `bumpManualRetry(interviewId)` + `bumpHrControl(interviewId)` once.
- When HR ends interview (POST end that creates report): `bumpHrControl(interviewId)` once before/with phase1.

- [ ] **Step 1: Extend orchestrator tests** — mock counters via resetting store; after successful company post with clarifying kind, assert `getCounters`. After `onAgentRetry`, assert manual+control.

- [ ] **Step 2: Implement bumps at persist / retry sites**

- [ ] **Step 3: Tests PASS; commit**

```bash
git commit -m "feat(eval): instrument live orchestrator for eval counters"
```

---

### Task 8: Wire phase 1 + phase 2 + set `liveSession.endedAt`

**Files:**
- Modify: `backend/src/routes/interviews.ts` (end interview handler after successful `finalReport.create`)
- Modify: `backend/src/routes/interviews.test.ts`
- Modify: `backend/src/routes/reports.ts` (after decision transaction)
- Modify: `backend/src/routes/reports.test.ts`

**Phase 1 hook (interviews end):**
```ts
// inside transaction or after: set liveSession.endedAt = new Date() where interviewId
await prisma.liveSession.updateMany({
  where: { interviewId, endedAt: null },
  data: { endedAt: new Date() },
});
// after successful report create:
try {
  await bumpHrControl(interviewId); // if not already
  await upsertEvalAfterReport(prisma, interviewId);
} catch (error) {
  console.error("[eval] phase1 failed:", error);
}
```

Prefer setting `endedAt` in the same transaction as status ENDED + report create when possible.

**Phase 2 hook (reports decisions):**
```ts
try {
  await updateEvalAfterDecision(prisma, report.interviewId);
} catch (error) {
  console.error("[eval] phase2 failed:", error);
}
```

- [ ] **Step 1: Failing/extended route tests** — assert `interviewEvalSnapshot.upsert` called (fake prisma) after end; assert update after decision; assert thrown eval does not change 201 response.

- [ ] **Step 2: Implement hooks + `endedAt`**

- [ ] **Step 3: Tests PASS; commit**

```bash
git commit -m "feat(eval): two-phase snapshot on report and decision"
```

---

### Task 9: Eval HTTP API

**Files:**
- Create: `backend/src/routes/eval.ts`
- Create: `backend/src/routes/eval.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `.env.example`
- Modify: `backend/package.json`

**Auth helper:**
```ts
function requireEvalToken(req, res): boolean {
  const expected = process.env.EVAL_API_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "Eval API disabled" });
    return false;
  }
  const header = req.headers.authorization;
  if (header !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
```

Routes (no `requireHr`):
- `GET /api/eval/snapshots?from=&to=`
- `GET /api/eval/summary?from=&to=`

Parse ISO dates; invalid → 400. Filter `reportCreatedAt >= from AND reportCreatedAt < to`.

Mount in `server.ts` **before** the broad `requireHr` stacks (same caution as dialogs):

```ts
app.use("/api", createEvalRouter(() => prisma));
```

- [ ] **Step 1: Tests** — 503 without env; 401 bad token; 200 with token returns filtered list/summary (fake prisma).

- [ ] **Step 2: Implement + mount + `.env.example` line `EVAL_API_TOKEN=`**

- [ ] **Step 3: PASS; commit**

```bash
git commit -m "feat(api): eng-only eval snapshots and summary endpoints"
```

---

### Task 10: CLI `eval:report`

**Files:**
- Create: `backend/scripts/eval-report.ts`
- Modify: `backend/package.json` — `"eval:report": "tsx scripts/eval-report.ts"`

**Behavior:**
```bash
npm run eval:report --workspace=backend -- --from=2026-07-01T00:00:00.000Z --to=2026-07-23T00:00:00.000Z
npm run eval:report --workspace=backend -- --from=... --to=... --json
```

- Parse args (`--from`, `--to`, `--json`).
- Use `prisma` from `../src/db/prisma`.
- Call `listEvalSnapshots` + `summarizeEvalSnapshots`.
- Without `--json`: print human-readable summary lines.
- With `--json`: `console.log(JSON.stringify({ summary, snapshots }, null, 2))`.
- Missing args → exit 1 with usage.

- [ ] **Step 1: Implement script**

- [ ] **Step 2: Smoke-run with empty DB range (should print zeros / empty)** — requires local Postgres; if unavailable, skip and note in commit body.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(eval): add CLI eval:report for period comparison"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `InterviewEvalSnapshot` fields | 2, 4 |
| prep candidate / vacancy / live durations | 1, 4, 8 (`endedAt`) |
| auto/manual retry counts (cd prep + live) | 3, 5, 7 |
| hrMessageCount + hrControlActionCount | 4, 7, 8 |
| clarifying via `kind` | 6, 7 |
| match + arbiter recommendation | 4, 8 |
| HR decision + agreement mapping | 1, 4, 8 |
| two-phase finalize | 4, 8 |
| time-only period filter | 4, 9, 10 |
| EVAL API + token | 9 |
| CLI | 10 |
| eval failure isolation | 8 |
| vacancy prep retries excluded | 5 (no wire on prep.ts/company-prep) |

---

## Execution handoff

After plan approval, implement task-by-task with TDD and commits as written.

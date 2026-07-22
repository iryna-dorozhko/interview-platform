# Agent Retry & Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматично повторювати збійні агентні виклики в prep і live; після вичерпання спроб знімати «Думаю…» і показувати зрозумілу українську помилку з кнопкою «Спробувати ще раз» (кандидат у Candidate Prep; HR у company/vacancy prep і live).

**Architecture:** Спільний `withLlmRetry` (max 3) — єдина точка лічильника спроб. Gemini більше не ретраїть всередині `complete()`. Prep обгортає LLM+parse і віддає safe UK `error`. Live зберігає `lastFailedTurn` і через `room:agent-retry` (лише HR) повторює саме зірваний agent step. Prep manual retry = повтор `POST .../message` **без** тексту (існуюча семантика «regenerate») або повтор `finish`.

**Tech Stack:** Node.js test runner (`node --import tsx --test`), Express prep routes, Socket.IO orchestrator, Vue 3 composables/views.

## Global Constraints

- Safe UI copy (типовий): «AI тимчасово не відповів. Можна спробувати ще раз.»
- Rate-limit copy може лишатися конкретнішою (існуючий український текст про ліміт Gemini).
- Кнопка retry: Candidate Prep → кандидат; Company/Vacancy Prep + live → лише HR; live кандидат — банер без кнопки.
- Live retry повторює **останній failed agent turn**, без нового human message.
- Без Prisma-міграцій; без vacancy match / final report у цій ітерації.
- Під час авто-retry UI лишається на «Думаю…» (без окремого «Повторюємо…»).
- Клієнтський банер показує `error`, не raw `detail`/stack.

**Spec:** `docs/superpowers/specs/2026-07-22-agent-retry-error-handling-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/llm/retry.ts` | `isRetryableLlmError`, `toSafeLlmErrorMessage`, `withLlmRetry` |
| `backend/src/llm/retry.test.ts` | Unit tests for retry policy |
| `backend/src/llm/gemini.provider.ts` | One HTTP attempt per `complete()`; keep `parseGeminiRetryDelayMs` / `isGeminiRateLimitError` |
| `backend/src/llm/gemini.provider.test.ts` | Adjust if internal-loop tests exist |
| `backend/src/agents/arbiter-agent.ts` | Wrap `complete`+`parseArbiterCommand` in `withLlmRetry` |
| `backend/src/agents/company-live-agent.ts` | Wrap `complete`+`parsePostReply` in `withLlmRetry` |
| `backend/src/agents/candidate-live-agent.ts` | Wrap `complete`+parse in `withLlmRetry` |
| `backend/src/routes/candidate-prep.ts` | Retry around LLM+parse; safe UK `error` |
| `backend/src/routes/prep.ts` | Same for vacancy prep |
| `backend/src/routes/company-prep.ts` | Same for company prep |
| `backend/src/routes/*prep*.test.ts` | Assert retry success / final safe error |
| `backend/src/socket/orchestrator.ts` | `lastFailedTurn`, `busy`, `onAgentRetry` |
| `backend/src/socket/orchestrator.test.ts` | Fail → error+state; HR retry; candidate denied |
| `backend/src/socket/room.ts` | Handle `room:agent-retry` (HR only) |
| `backend/src/socket/room.test.ts` / types | Wire event + auth |
| `backend/src/socket/types.ts` | Types if needed |
| `backend/package.json` | Add `retry.test.ts` to `test` script |
| `frontend/src/api/{candidate-prep,prep,company-prep}.ts` | Prefer `error` over `detail` in `parseError` |
| `frontend/src/views/CandidatePrepView.vue` | Retry button + `lastFailedAction` |
| `frontend/src/components/CandidatePrepChat.vue` | Same |
| `frontend/src/views/VacancyPrepView.vue` | HR retry button |
| `frontend/src/views/CompanyProfilePrepView.vue` | HR retry button |
| `frontend/src/composables/useInterviewRoom.ts` | `retryAgent()`, emit `room:agent-retry` |
| `frontend/src/components/InterviewRoomContent.vue` | HR-only retry button next to banner |

---

### Task 1: `withLlmRetry` helper

**Files:**
- Create: `backend/src/llm/retry.ts`
- Create: `backend/src/llm/retry.test.ts`
- Modify: `backend/package.json` (`test` script — append `src/llm/retry.test.ts`)

**Interfaces:**
- Consumes: `LlmUnavailableError`, `LlmEmptyResponseError` from `./errors`; `isGeminiRateLimitError`, `parseGeminiRetryDelayMs` from `./gemini.provider`
- Produces:
  - `SAFE_LLM_ERROR_UK: string`
  - `isRetryableLlmError(error: unknown): boolean`
  - `toSafeLlmErrorMessage(error: unknown): string`
  - `withLlmRetry<T>(fn: () => Promise<T>, options?: { label?: string; maxAttempts?: number }): Promise<T>`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/llm/retry.test.ts`:

```ts
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import {
  isRetryableLlmError,
  toSafeLlmErrorMessage,
  withLlmRetry,
  SAFE_LLM_ERROR_UK,
} from "./retry";

test("isRetryableLlmError accepts unavailable, empty, parse, extraction", () => {
  assert.equal(isRetryableLlmError(new LlmUnavailableError("down")), true);
  assert.equal(isRetryableLlmError(new LlmEmptyResponseError()), true);
  const parseErr = new Error("bad json");
  parseErr.name = "ArbiterReplyParseError";
  assert.equal(isRetryableLlmError(parseErr), true);
  const extractErr = new Error("bad profile");
  extractErr.name = "ProfileExtractionError";
  assert.equal(isRetryableLlmError(extractErr), true);
});

test("isRetryableLlmError rejects context and generic errors", () => {
  const ctx = new Error("Missing company profile");
  ctx.name = "ArbiterContextError";
  assert.equal(isRetryableLlmError(ctx), false);
  assert.equal(isRetryableLlmError(new Error("boom")), false);
});

test("toSafeLlmErrorMessage keeps rate-limit Ukrainian text", () => {
  const err = new LlmUnavailableError(
    "Gemini API: перевищено ліміт запитів. Змініть LLM_PROVIDER у .env або зачекайте.",
  );
  assert.equal(toSafeLlmErrorMessage(err), err.message);
  assert.equal(toSafeLlmErrorMessage(new Error("ECONNRESET")), SAFE_LLM_ERROR_UK);
});

test("withLlmRetry succeeds after transient failures", async () => {
  let attempts = 0;
  const result = await withLlmRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new LlmUnavailableError("tmp");
    return "ok";
  }, { maxAttempts: 3 });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withLlmRetry does not retry context errors", async () => {
  let attempts = 0;
  const ctx = new Error("missing");
  ctx.name = "CompanyLiveContextError";
  await assert.rejects(
    () =>
      withLlmRetry(async () => {
        attempts += 1;
        throw ctx;
      }),
    (err: unknown) => err === ctx,
  );
  assert.equal(attempts, 1);
});

test("withLlmRetry exhausts attempts then throws last error", async () => {
  await assert.rejects(
    () =>
      withLlmRetry(
        async () => {
          throw new LlmEmptyResponseError();
        },
        { maxAttempts: 3 },
      ),
    LlmEmptyResponseError,
  );
});
```

For Gemini delay path, mock sleep via injecting optional `sleep` is optional; if `withLlmRetry` uses module-local sleep, keep tests fast by not asserting delays (or export `setRetrySleepForTests`). Prefer: accept optional `sleep?: (ms: number) => Promise<void>` in options for tests:

```ts
test("withLlmRetry uses Gemini retry hint delay", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  await withLlmRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("[429 Too Many Requests] Please retry in 1.0s");
      }
      return "ok";
    },
    {
      maxAttempts: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  assert.equal(attempts, 2);
  assert.ok(sleeps[0]! >= 1000);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd backend && node --import tsx --test src/llm/retry.test.ts`  
Expected: FAIL (module not found / exports missing)

- [ ] **Step 3: Implement `backend/src/llm/retry.ts`**

```ts
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import { isGeminiRateLimitError, parseGeminiRetryDelayMs } from "./gemini.provider";

export const SAFE_LLM_ERROR_UK =
  "AI тимчасово не відповів. Можна спробувати ще раз.";

const DEFAULT_MAX_ATTEMPTS = 3;

export type WithLlmRetryOptions = {
  label?: string;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof LlmUnavailableError) return true;
  if (error instanceof LlmEmptyResponseError) return true;
  if (isGeminiRateLimitError(error)) return true;
  if (error instanceof Error) {
    if (error.name.endsWith("ContextError")) return false;
    if (error.name.endsWith("ReplyParseError")) return true;
    if (error.name.endsWith("ExtractionError")) return true;
  }
  return false;
}

export function toSafeLlmErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("перевищено ліміт")) {
    return error.message;
  }
  return SAFE_LLM_ERROR_UK;
}

function backoffMs(attemptIndex: number, error: unknown): number {
  if (isGeminiRateLimitError(error)) {
    return parseGeminiRetryDelayMs(error);
  }
  return Math.min(500 * 2 ** attemptIndex, 8_000);
}

export async function withLlmRetry<T>(
  fn: () => Promise<T>,
  options: WithLlmRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const label = options.label ?? "llm";
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableLlmError(error);
      const hasMore = attempt < maxAttempts - 1;
      if (!retryable || !hasMore) break;

      const delay = backoffMs(attempt, error);
      console.warn(
        `[llm-retry:${label}] attempt ${attempt + 1}/${maxAttempts} failed:`,
        error instanceof Error ? error.message : error,
        `— retry in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  if (isGeminiRateLimitError(lastError)) {
    throw new LlmUnavailableError(
      "Gemini API: перевищено ліміт запитів. Змініть LLM_PROVIDER у .env або зачекайте.",
    );
  }

  console.error(
    `[llm-retry:${label}] exhausted:`,
    lastError instanceof Error ? lastError.message : lastError,
  );
  throw lastError;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd backend && node --import tsx --test src/llm/retry.test.ts`  
Expected: PASS

- [ ] **Step 5: Register in package.json test script**

Append `src/llm/retry.test.ts` to the `test` script list in `backend/package.json`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/llm/retry.ts backend/src/llm/retry.test.ts backend/package.json
git commit -m "$(cat <<'EOF'
feat(llm): add shared withLlmRetry helper

EOF
)"
```

---

### Task 2: Gemini — single attempt per `complete()`

**Files:**
- Modify: `backend/src/llm/gemini.provider.ts`
- Modify: `backend/src/llm/gemini.provider.test.ts` (only if tests assume multi-attempt loop)

**Interfaces:**
- Consumes: unchanged public helpers `isGeminiRateLimitError`, `parseGeminiRetryDelayMs`
- Produces: `complete()` performs one send; rate-limit errors propagate for `withLlmRetry`

- [ ] **Step 1: Write/adjust a regression test**

In `gemini.provider.test.ts`, if there is no coverage of the loop, add a note in this task: behavior change is covered by Task 1 Gemini delay test + existing rate-limit helpers. Optional unit with mocked SDK is fine to skip if heavy; minimum: remove unused `MAX_RATE_LIMIT_ATTEMPTS` usage and keep helpers exported.

- [ ] **Step 2: Replace the retry loop with a single attempt**

In `createGeminiProvider().complete`, replace the `for` loop with one try/send. On rate limit, rethrow the original error (do **not** convert to Ukrainian `LlmUnavailableError` here — `withLlmRetry` does that after exhaustion). On empty text, throw `LlmEmptyResponseError`. Remove `MAX_RATE_LIMIT_ATTEMPTS` and the local `sleep` if unused.

- [ ] **Step 3: Run gemini + retry tests**

Run: `cd backend && node --import tsx --test src/llm/gemini.provider.test.ts src/llm/retry.test.ts`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/llm/gemini.provider.ts backend/src/llm/gemini.provider.test.ts
git commit -m "$(cat <<'EOF'
refactor(llm): let withLlmRetry own Gemini rate-limit retries

EOF
)"
```

---

### Task 3: Wrap live agent turns in `withLlmRetry`

**Files:**
- Modify: `backend/src/agents/arbiter-agent.ts`
- Modify: `backend/src/agents/company-live-agent.ts`
- Modify: `backend/src/agents/candidate-live-agent.ts`
- Modify tests only if they assert single `complete` call counts in a way that breaks (update expected call counts × retries when injecting failing providers — usually agent unit tests mock success once)

**Interfaces:**
- Consumes: `withLlmRetry` from `../llm/retry`
- Produces: same public `run*Turn` signatures; parse/unavailable errors retried; `*ContextError` still fail once

- [ ] **Step 1: Arbiter**

Replace:

```ts
  const rawReply = await provider.complete(llmMessages, ARBITER_LLM_OPTIONS);

  return parseArbiterCommand(rawReply);
```

with:

```ts
  return withLlmRetry(async () => {
    const rawReply = await provider.complete(llmMessages, ARBITER_LLM_OPTIONS);
    return parseArbiterCommand(rawReply);
  }, { label: "arbiter" });
```

Keep `ArbiterContextError` **outside** the retry callback (thrown before `withLlmRetry`).

- [ ] **Step 2: Company live + Candidate live**

Same pattern around `provider.complete` + parse. Context errors stay outside.

- [ ] **Step 3: Run agent tests**

Run: `cd backend && node --import tsx --test src/agents/arbiter-agent.test.ts src/agents/company-live-agent.test.ts src/agents/candidate-live-agent.test.ts`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/arbiter-agent.ts backend/src/agents/company-live-agent.ts backend/src/agents/candidate-live-agent.ts
git commit -m "$(cat <<'EOF'
feat(agents): retry transient LLM and parse failures on live turns

EOF
)"
```

---

### Task 4: Prep routes — retry + safe UK errors

**Files:**
- Modify: `backend/src/routes/candidate-prep.ts`
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/company-prep.ts`
- Modify: `backend/src/routes/candidate-prep.test.ts`
- Modify: `backend/src/routes/prep.test.ts`
- Modify: `backend/src/routes/company-prep.test.ts`

**Interfaces:**
- Consumes: `withLlmRetry`, `toSafeLlmErrorMessage` from `../llm/retry`
- Produces: on LLM failure after retries → status 502/503 with `{ error: toSafeLlmErrorMessage(err) }` (no raw provider body in `error`). Optional: omit `detail` from JSON responses for these paths (log only).

**Important:** `POST .../message` already saves the human message before LLM. Empty-body message = regenerate agent reply without duplicating human text — **no new retry endpoint**.

- [ ] **Step 1: Failing test — auto-retry then success**

In `candidate-prep.test.ts`, add a test with a mock provider that fails twice with `LlmUnavailableError` then succeeds; `POST /message` returns 200.  
Add a test that fails three times and expects 503 with `error` equal to `SAFE_LLM_ERROR_UK` (import from retry module).

Mirror the exhaustion test in `prep.test.ts` and `company-prep.test.ts` for `/message` (and for `/finish` with `ProfileExtractionError` / unavailable).

- [ ] **Step 2: Run — expect FAIL**

Run the new tests; expect FAIL until routes wrap retry / change response shape.

- [ ] **Step 3: Implement route wrapping**

For message handlers, wrap:

```ts
const rawReply = await withLlmRetry(
  () => provider.complete(llmMessages),
  { label: "candidate-prep:message" },
);
```

For finish handlers, wrap complete + profile parse together:

```ts
const profile = await withLlmRetry(async () => {
  const raw = await provider.complete(llmMessages);
  return parseCandidateProfile(raw); // use the actual parse fn name in that file
}, { label: "candidate-prep:finish" });
```

In all LLM `catch` blocks that respond to the client:

```ts
res.status(503).json({ error: toSafeLlmErrorMessage(error) });
```

Use 502 for empty_response if that is existing convention; still put safe UK in `error`. Log technical `detail` with `console.error` only.

Apply the same pattern in `prep.ts` and `company-prep.ts`.

- [ ] **Step 4: Run prep tests**

Run: `cd backend && node --import tsx --test src/routes/candidate-prep.test.ts src/routes/prep.test.ts src/routes/company-prep.test.ts`  
Expected: PASS (update any old assertions that expected English `"LLM unavailable"` + `detail` in the response body)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-prep.ts backend/src/routes/prep.ts backend/src/routes/company-prep.ts \
  backend/src/routes/candidate-prep.test.ts backend/src/routes/prep.test.ts backend/src/routes/company-prep.test.ts
git commit -m "$(cat <<'EOF'
feat(prep): retry LLM calls and return safe Ukrainian errors

EOF
)"
```

---

### Task 5: Prep frontend — retry button + prefer `error`

**Files:**
- Modify: `frontend/src/api/candidate-prep.ts`
- Modify: `frontend/src/api/prep.ts`
- Modify: `frontend/src/api/company-prep.ts`
- Modify: `frontend/src/views/CandidatePrepView.vue`
- Modify: `frontend/src/components/CandidatePrepChat.vue`
- Modify: `frontend/src/views/VacancyPrepView.vue`
- Modify: `frontend/src/views/CompanyProfilePrepView.vue`

**Interfaces:**
- Consumes: existing `send*Message(id)` without text; `finish*Chat`
- Produces: `lastFailedAction: "message" | "finish" | "greeting" | null`; `retryLastFailed()`

- [ ] **Step 1: Fix API `parseError` to prefer safe `error`**

In each prep API module, change:

```ts
const detail = body.detail ?? body.error;
```

to:

```ts
const detail = body.error ?? body.detail;
```

so the banner shows the Ukrainian `error` field.

- [ ] **Step 2: Add retry state + handler (Candidate Prep)**

In `CandidatePrepView.vue` (and `CandidatePrepChat.vue`):

```ts
type FailedAction = "greeting" | "message" | "finish";
const lastFailedAction = ref<FailedAction | null>(null);

async function retryLastFailed(): Promise<void> {
  if (!lastFailedAction.value || sending.value) return;
  const action = lastFailedAction.value;
  errorMessage.value = null;
  sending.value = true;
  try {
    if (action === "finish") {
      const result = await finishCandidatePrepChat(interviewId.value);
      // existing finish success handling
      syncEditableProfile(result.profile);
      isClosed.value = true;
    } else {
      // greeting or message: regenerate without new human text
      const response = await sendCandidatePrepMessage(interviewId.value);
      messages.value.push({
        id: `local_${Date.now()}_reply`,
        authorType: "AGENT_CANDIDATE",
        content: response.message,
        createdAt: new Date().toISOString(),
      });
      lastReadyForConfirmation.value = response.readyForConfirmation;
      await scrollToBottom();
    }
    lastFailedAction.value = null;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
  } finally {
    sending.value = false;
  }
}
```

On catch of `triggerGreeting` set `lastFailedAction = "greeting"`; on `sendMessage` → `"message"`; on `onFinishChat` → `"finish"`. Clear `lastFailedAction` on successful send and when starting a fresh user send.

Banner UI:

```vue
<p v-if="errorMessage" class="error-banner" role="alert">
  {{ errorMessage }}
  <button
    type="button"
    class="btn-secondary"
    :disabled="sending || !lastFailedAction"
    @click="retryLastFailed"
  >
    Спробувати ще раз
  </button>
</p>
```

- [ ] **Step 3: Same for Vacancy + Company prep (HR)**

Identical pattern with their API helpers (`sendPrepMessage` / `sendCompanyPrepMessage`, finish helpers). Button visible to HR on those screens (these views are HR-only already).

- [ ] **Step 4: Manual smoke**

Open Candidate Prep, simulate failure if possible (or code-review the path): after error, button calls message without text; human bubble is not duplicated.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/candidate-prep.ts frontend/src/api/prep.ts frontend/src/api/company-prep.ts \
  frontend/src/views/CandidatePrepView.vue frontend/src/components/CandidatePrepChat.vue \
  frontend/src/views/VacancyPrepView.vue frontend/src/views/CompanyProfilePrepView.vue
git commit -m "$(cat <<'EOF'
feat(ui): add prep chat retry button and prefer safe API errors

EOF
)"
```

---

### Task 6: Live orchestrator — `lastFailedTurn` + `onAgentRetry`

**Files:**
- Modify: `backend/src/socket/orchestrator.ts`
- Modify: `backend/src/socket/orchestrator.test.ts`

**Interfaces:**
- Consumes: existing `runArbiter` / `runCompany` / `runCandidate`, `emitAgentError`, `toSafeLlmErrorMessage`
- Produces:
  - `RoomOrchestrator.onAgentRetry(io, interviewId, sessionId): void`
  - `RoomState.lastFailedTurn`, `RoomState.busy`

```ts
type LastFailedTurn = {
  agentType: "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";
  pendingQuestion: boolean;
  command?: ParsedArbiterCommand;
  stepsUsed: number;
  companyPostedThisTurn: boolean;
  candidatePostedThisTurn: boolean;
};
```

- [ ] **Step 1: Write failing orchestrator tests**

Add tests roughly like:

1. Mock `runArbiterTurn` to throw → expect `room:agent-error` with safe message; thinking inactive; subsequent `onAgentRetry` calls arbiter again and continues.
2. Mock company throw after arbiter returns `NEXT_QUESTION` → retry calls company (not arbiter first); on success emits company message.
3. `onAgentRetry` while `busy` is no-op / does not double-invoke.
4. Clear `lastFailedTurn` on new `onHumanMessage`.

Use existing test helpers in `orchestrator.test.ts` (fake io, prisma, debounceMs: 0).

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && node --import tsx --test src/socket/orchestrator.test.ts`  
Expected: FAIL on new tests

- [ ] **Step 3: Implement state + error bookkeeping**

Extend `RoomState`:

```ts
type RoomState = {
  debounceTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
  candidateRecoveryTimer: ReturnType<typeof setTimeout> | null;
  pendingQuestion: boolean;
  lastFailedTurn: LastFailedTurn | null;
  busy: boolean;
};
```

Update `emitAgentError` to use `toSafeLlmErrorMessage(error)` (keep special-case for messages that already include «перевищено ліміт» via that helper).

On each catch in `executeTurn`, before `break`, set:

```ts
state.lastFailedTurn = {
  agentType: "AGENT_COMPANY", // or ARBITER / CANDIDATE
  pendingQuestion: state.pendingQuestion,
  command, // when available
  stepsUsed,
  companyPostedThisTurn,
  candidatePostedThisTurn,
};
```

Set `state.busy = true` at start of `executeTurn`, `false` in `finally`. On success path that finishes normally, `state.lastFailedTurn = null`. In `scheduleTurn`, clear `lastFailedTurn` when bumping generation for a new human message.

- [ ] **Step 4: Implement `onAgentRetry` + resume helper**

```ts
onAgentRetry(io, interviewId, sessionId) {
  if (closed) return;
  const state = getState(interviewId);
  if (state.busy || !state.lastFailedTurn) return;
  const failed = state.lastFailedTurn;
  state.lastFailedTurn = null;
  state.generation += 1;
  const capturedGeneration = state.generation;
  void resumeFromFailedTurn(io, interviewId, sessionId, capturedGeneration, failed);
}
```

`resumeFromFailedTurn` must:

1. Re-run only the failed agent (arbiter / company / candidate) with stored `command` / `pendingQuestion`.
2. On failure again → `emitAgentError`, restore `lastFailedTurn`, return.
3. On success → continue the conductor `while` loop with restored `stepsUsed` / posted flags (extract shared loop body from `executeTurn` if needed to avoid duplication; a pragmatic approach: after successful single-step retry for COMPANY/CANDIDATE, call a `continueConductorLoop(...)`; for ARBITER failure retry, call full `executeTurn`).

Minimal acceptable structure:

- Extract inner loop into `runConductorLoop(io, interviewId, sessionId, capturedGeneration, initial?: { stepsUsed, flags, startAt: "arbiter" | "company" | "candidate", command? })`.
- `executeTurn` calls it from `"arbiter"`.
- `resumeFromFailedTurn` calls it from the failed agent type.

- [ ] **Step 5: Run orchestrator tests — PASS**

- [ ] **Step 6: Commit**

```bash
git add backend/src/socket/orchestrator.ts backend/src/socket/orchestrator.test.ts
git commit -m "$(cat <<'EOF'
feat(live): persist failed agent turn and support HR retry

EOF
)"
```

---

### Task 7: Socket `room:agent-retry` (HR only)

**Files:**
- Modify: `backend/src/socket/room.ts`
- Modify: `backend/src/socket/types.ts` (payload type if used)
- Modify: `backend/src/socket/room.test.ts`
- Modify: noop orchestrator stubs in tests to include `onAgentRetry: () => {}`

**Interfaces:**
- Consumes: `orchestrator.onAgentRetry`
- Produces: socket event `room:agent-retry` with `{ interviewId: string }`

- [ ] **Step 1: Failing room test**

- HR socket emits `room:agent-retry` → `onAgentRetry` called with interview/session.
- Candidate socket emits same → `onAgentRetry` **not** called; optional `room:error` «Немає доступу».

- [ ] **Step 2: Implement handler** next to `room:message` in `room.ts`:

```ts
socket.on("room:agent-retry", async (payload: { interviewId?: string }) => {
  try {
    const user = getSocketUser(socket);
    if (!user) {
      socket.emit("room:error", { error: "Немає доступу" });
      return;
    }
    const data = getSocketData(socket);
    const interviewId =
      typeof payload?.interviewId === "string" ? payload.interviewId.trim() : "";
    if (!interviewId || data.interviewId !== interviewId) {
      socket.emit("room:error", { error: "Невірний запит" });
      return;
    }
    if (data.roomRole !== "HR") {
      socket.emit("room:error", { error: "Немає доступу" });
      return;
    }
    const prisma = getPrisma();
    const interview = await loadInterview(prisma, interviewId);
    if (!interview || interview.status === "ENDED") {
      socket.emit("room:error", { error: "Співбесіда завершена" });
      return;
    }
    const session = await ensureLiveSession(prisma, interviewId);
    orchestrator.onAgentRetry(io, interviewId, session.id);
  } catch {
    socket.emit("room:error", { error: "Внутрішня помилка кімнати" });
  }
});
```

Update `RoomOrchestrator` interface + all test stubs.

- [ ] **Step 3: Run** `src/socket/room.test.ts` + `orchestrator.test.ts` — PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/socket/room.ts backend/src/socket/types.ts backend/src/socket/room.test.ts backend/src/socket/orchestrator.ts
git commit -m "$(cat <<'EOF'
feat(socket): allow HR to emit room:agent-retry

EOF
)"
```

---

### Task 8: Live frontend — HR retry button

**Files:**
- Modify: `frontend/src/composables/useInterviewRoom.ts`
- Modify: `frontend/src/components/InterviewRoomContent.vue`

**Interfaces:**
- Consumes: socket `room:agent-retry`
- Produces: `retryAgent(): void` exported from composable; button only when `currentRole === "HR" && agentError`

- [ ] **Step 1: Composable**

In `useInterviewRoom.ts`:

```ts
function retryAgent(): void {
  if (currentRole !== "HR") return;
  if (!agentError.value) return;
  if (connectionState.value !== "connected") return;
  agentError.value = null;
  agentThinking.value = { active: true };
  socket.emit("room:agent-retry", { interviewId });
}
```

Return `retryAgent` from the composable. Keep existing `onAgentError` clearing thinking.

- [ ] **Step 2: UI in `InterviewRoomContent.vue`**

```vue
<p v-if="agentError" class="agent-error-banner" role="alert">
  {{ agentError }}
  <button
    v-if="currentRole === 'HR'"
    type="button"
    class="btn-secondary"
    :disabled="agentThinking?.active"
    @click="retryAgent"
  >
    Спробувати ще раз
  </button>
</p>
```

Wire `retryAgent` from `useInterviewRoom`.

- [ ] **Step 3: Smoke** — HR sees button; candidate does not (same banner text).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/composables/useInterviewRoom.ts frontend/src/components/InterviewRoomContent.vue
git commit -m "$(cat <<'EOF'
feat(ui): add HR retry control for live agent errors

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Shared retry layer, max 3, backoff | Task 1 |
| Retry transient + empty + parse; not context/auth | Task 1 |
| Gemini no double-retry | Task 2 |
| Prep + live auto-retry | Tasks 3–4 |
| Safe UK errors, no eternal thinking | Tasks 4, 6, 8 |
| Prep retry without duplicate human message | Task 5 (empty message POST) |
| Button: candidate prep / HR company+live | Tasks 5, 8 |
| Live retry same failed turn | Task 6–7 |
| Out of scope: match/report/DB persist | Not scheduled |

No TBD placeholders. Types `LastFailedTurn` / `withLlmRetry` options consistent across tasks.

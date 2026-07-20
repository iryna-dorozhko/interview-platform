# Candidate Live Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Candidate Live Agent повертає структурований рівень впевненості (`confirmed` / `inferred` / `unknown`); HR і кандидат бачать бейдж у чаті; фінальний звіт враховує мітки confidence у transcript і `risks`.

**Architecture:** Prisma enum `CandidateConfidence` на `LiveMessage`; окремий парсер `parseCandidateLiveReply` обчислює `needsHuman = (confidence === "unknown")`; orchestrator зберігає confidence у БД і емітить у DTO; frontend показує pill-бейдж; report agent отримує transcript з мітками.

**Tech Stack:** Node.js test runner (`node --import tsx --test`), Prisma + PostgreSQL, Vue 3 + TypeScript, Socket.IO.

## Global Constraints

- Усі публічні повідомлення — українською.
- 3 рівні confidence: `confirmed`, `inferred`, `unknown` (LLM lowercase; Prisma `CONFIRMED`, `INFERRED`, `UNKNOWN`).
- `inferred` → `needsHuman: false`, оркестратор продовжує; `unknown` → `needsHuman: true`, стоп.
- `needsHuman` у JSON від LLM **не приймається** — лише похідне від `confidence`.
- Бейдж у UI бачать **HR і кандидат** однаково.
- JSON-схема `FinalReport` не змінюється.
- Prep-агент кандидата не змінюємо.
- Confidence лише для `AGENT_CANDIDATE` у режимі `ANSWER`.
- Spec: `docs/superpowers/specs/2026-07-20-candidate-live-confidence-design.md`.

## File map

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | enum + nullable field |
| `backend/src/agents/candidate-live-agent.ts` | `parseCandidateLiveReply`, nudge, `runCandidateLiveTurn` |
| `backend/src/agents/prompts/candidate-live-agent.uk.ts` | 3 рівні + JSON `confidence` |
| `backend/src/agents/candidate-live-agent.test.ts` | парсер + prompt asserts |
| `backend/src/agents/prompts/arbiter-agent.uk.ts` | WAIT лише для `unknown` |
| `backend/src/agents/arbiter-agent.test.ts` | оновлені WAIT asserts |
| `backend/src/agents/final-report-agent.ts` | transcript з мітками |
| `backend/src/agents/prompts/final-report.uk.ts` | правила confidence |
| `backend/src/agents/final-report-agent.test.ts` | transcript format |
| `backend/src/routes/interviews.ts` | передати `candidateConfidence` у transcript |
| `backend/src/socket/types.ts` | DTO |
| `backend/src/socket/orchestrator.ts` | `saveAndEmit` + confidence |
| `backend/src/socket/room.ts` | `toDto` |
| `backend/src/socket/orchestrator.test.ts` | inferred продовжує; unknown стоп |
| `frontend/src/composables/useInterviewRoom.ts` | тип `LiveMessage` |
| `frontend/src/utils/live-message-styles.ts` | бейдж + стилі |
| `frontend/src/components/LiveChatPanel.vue` | рендер бейджа |

---

### Task 1: Prisma schema — `CandidateConfidence`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration via `db:migrate`

**Interfaces:**
- Produces: Prisma enum `CandidateConfidence`; поле `LiveMessage.candidateConfidence?: CandidateConfidence | null`

- [ ] **Step 1: Add enum and field to schema**

У `backend/prisma/schema.prisma` додай enum і поле:

```prisma
enum CandidateConfidence {
  CONFIRMED
  INFERRED
  UNKNOWN
}

model LiveMessage {
  id                  String                @id @default(cuid())
  sessionId           String
  authorType          LiveAuthorType
  content             String
  candidateConfidence CandidateConfidence?
  createdAt           DateTime              @default(now())
  session             LiveSession           @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}
```

- [ ] **Step 2: Run migration and generate client**

```bash
npm --workspace backend run db:migrate -- --name candidate_live_confidence
npm --workspace backend run db:generate
```

Expected: migration файл створено; `@prisma/client` містить `CandidateConfidence`.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: PASS (можливі TS-помилки в місцях, де ще не оновлено код — виправляються в наступних tasks).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat(db): add CandidateConfidence to LiveMessage"
```

---

### Task 2: `parseCandidateLiveReply` — парсер confidence

**Files:**
- Modify: `backend/src/agents/candidate-live-agent.ts`
- Modify: `backend/src/agents/candidate-live-agent.test.ts`

**Interfaces:**
- Consumes: `AgentPostReplyParseError` з `./agent-post-reply`
- Produces:
  ```typescript
  export type CandidateConfidenceLevel = "confirmed" | "inferred" | "unknown";

  export interface ParsedCandidateLiveReply {
    post: boolean;
    message?: string;
    confidence?: CandidateConfidenceLevel;
    needsHuman: boolean;
  }

  export function parseCandidateLiveReply(
    rawText: string,
    options?: { requireConfidence?: boolean },
  ): ParsedCandidateLiveReply;

  export function toPrismaCandidateConfidence(
    level: CandidateConfidenceLevel,
  ): import("@prisma/client").CandidateConfidence;
  ```

- [ ] **Step 1: Write failing parser tests**

Додай у `backend/src/agents/candidate-live-agent.test.ts`:

```typescript
import {
  parseCandidateLiveReply,
  CandidateLiveReplyParseError,
} from "./candidate-live-agent";

test("parseCandidateLiveReply maps confidence to needsHuman", () => {
  const confirmed = parseCandidateLiveReply(
    '{ "post": true, "message": "Кандидат має досвід.", "confidence": "confirmed" }',
    { requireConfidence: true },
  );
  assert.equal(confirmed.confidence, "confirmed");
  assert.equal(confirmed.needsHuman, false);

  const inferred = parseCandidateLiveReply(
    '{ "post": true, "message": "З анкети видно…", "confidence": "inferred" }',
    { requireConfidence: true },
  );
  assert.equal(inferred.confidence, "inferred");
  assert.equal(inferred.needsHuman, false);

  const unknown = parseCandidateLiveReply(
    '{ "post": true, "message": "Ірино, відповідай сама.", "confidence": "unknown" }',
    { requireConfidence: true },
  );
  assert.equal(unknown.confidence, "unknown");
  assert.equal(unknown.needsHuman, true);
});

test("parseCandidateLiveReply requires confidence when requireConfidence is true", () => {
  assert.throws(
    () =>
      parseCandidateLiveReply('{ "post": true, "message": "Без confidence." }', {
        requireConfidence: true,
      }),
    CandidateLiveReplyParseError,
  );
});

test("parseCandidateLiveReply ignores needsHuman from LLM JSON", () => {
  const result = parseCandidateLiveReply(
    '{ "post": true, "message": "Текст.", "confidence": "inferred", "needsHuman": true }',
    { requireConfidence: true },
  );
  assert.equal(result.needsHuman, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: FAIL — `parseCandidateLiveReply` не експортує confidence / tests not found.

- [ ] **Step 3: Implement parser in `candidate-live-agent.ts`**

Заміни thin wrapper `parseCandidateLiveReply` на повну реалізацію. Онови тип:

```typescript
export type CandidateConfidenceLevel = "confirmed" | "inferred" | "unknown";

export interface ParsedCandidateLiveReply {
  post: boolean;
  message?: string;
  confidence?: CandidateConfidenceLevel;
  needsHuman: boolean;
}

const CONFIDENCE_LEVELS = new Set<CandidateConfidenceLevel>([
  "confirmed",
  "inferred",
  "unknown",
]);

function parseConfidenceLevel(value: unknown): CandidateConfidenceLevel {
  if (typeof value !== "string" || !CONFIDENCE_LEVELS.has(value as CandidateConfidenceLevel)) {
    throw new AgentPostReplyParseError("missing or invalid field: confidence");
  }
  return value as CandidateConfidenceLevel;
}

export function parseCandidateLiveReply(
  rawText: string,
  options?: { requireConfidence?: boolean },
): ParsedCandidateLiveReply {
  const withoutFences = rawText.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new AgentPostReplyParseError("LLM returned invalid JSON for agent reply");
  }

  if (typeof data !== "object" || data === null) {
    throw new AgentPostReplyParseError("Agent reply is not a JSON object");
  }

  const record = data as Record<string, unknown>;
  const { post, message } = record;

  if (typeof post !== "boolean") {
    throw new AgentPostReplyParseError("missing or invalid field: post");
  }

  if (!post) {
    return { post: false, needsHuman: false };
  }

  if (typeof message !== "string" || !message.trim()) {
    throw new AgentPostReplyParseError("missing or invalid field: message");
  }

  const confidenceRaw = record.confidence;
  if (confidenceRaw === undefined || confidenceRaw === null) {
    if (options?.requireConfidence) {
      throw new AgentPostReplyParseError("missing or invalid field: confidence");
    }
    return { post: true, message: message.trim(), needsHuman: false };
  }

  const confidence = parseConfidenceLevel(confidenceRaw);
  return {
    post: true,
    message: message.trim(),
    confidence,
    needsHuman: confidence === "unknown",
  };
}

export function toPrismaCandidateConfidence(
  level: CandidateConfidenceLevel,
): import("@prisma/client").CandidateConfidence {
  const map = {
    confirmed: "CONFIRMED",
    inferred: "INFERRED",
    unknown: "UNKNOWN",
  } as const;
  return map[level];
}
```

Видали `export type ParsedCandidateLiveReply = ParsedPostReply` — замінено власним типом.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: нові parser tests PASS (деякі старі prompt tests можуть ще падати — Task 3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/candidate-live-agent.ts backend/src/agents/candidate-live-agent.test.ts
git commit -m "feat: parse candidate live confidence levels"
```

---

### Task 3: Candidate Live prompt + nudge + runCandidateLiveTurn

**Files:**
- Modify: `backend/src/agents/prompts/candidate-live-agent.uk.ts`
- Modify: `backend/src/agents/candidate-live-agent.ts` (nudge + `runCandidateLiveTurn`)
- Modify: `backend/src/agents/candidate-live-agent.test.ts`

**Interfaces:**
- Consumes: `parseCandidateLiveReply(raw, { requireConfidence })`
- Produces: оновлений промпт; `runCandidateLiveTurn` повертає `ParsedCandidateLiveReply` з `confidence`

- [ ] **Step 1: Write failing prompt-contract tests**

Додай/заміни тести:

```typescript
test("candidate live prompt defines three confidence levels", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /confidence.*confirmed/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /inferred/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /unknown/i);
  assert.doesNotMatch(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /needsHuman:\s*true/);
});

test("ANSWER nudge references confidence not needsHuman", () => {
  assert.match(ANSWER_NUDGE_UK, /confidence/i);
  assert.doesNotMatch(ANSWER_NUDGE_UK, /needsHuman:true/);
});
```

Онови тест `runCandidateLiveTurn loads profile...` — LLM mock повертає confidence:

```typescript
return '{ "post": true, "message": "Кандидат має 5 років досвіду.", "confidence": "confirmed" }';
// ...
assert.equal(result.confidence, "confirmed");
assert.equal(result.needsHuman, false);
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: FAIL on confidence prompt / nudge asserts.

- [ ] **Step 3: Replace prompt in `candidate-live-agent.uk.ts`**

Ключові зміни в промпті:

1. Три режими ANSWER → три `confidence` рівні (замість `needsHuman`).
2. `inferred` — висновок, розмова **продовжується** (без прохання підтвердити як обов'язкового стопу).
3. `unknown` — прогалина, попроси живу людину.
4. JSON формат:

```
{ "post": true, "message": "...", "confidence": "confirmed" | "inferred" | "unknown" }
```

Для `CANDIDATE_QUESTIONS` — `confidence` не потрібен.

- [ ] **Step 4: Update nudge constants**

```typescript
export const ANSWER_NUDGE_UK =
  "[Система] Команда Arbiter: ANSWER. Відповідай про кандидата (третя особа) згідно з профілем. Обов'язково вкажи confidence: confirmed (факт з профілю), inferred (висновок/часткові дані), unknown (немає даних — попроси живу людину). Не перефразовуй питання — лише відповідь. Не дублюй уже сказане в чаті.";

export const COMPANY_QUESTION_NUDGE_UK =
  "[Система] Company Agent поставив питання. Відповідай про кандидата (третя особа) з confidence: confirmed | inferred | unknown. Не перефразовуй питання.";
```

- [ ] **Step 5: Update `runCandidateLiveTurn`**

```typescript
const requireConfidence =
  turnContext?.action === "ANSWER" ||
  turnContext?.action === undefined; // company-question nudge path

const rawReply = await provider.complete(llmMessages);
return parseCandidateLiveReply(rawReply, { requireConfidence });
```

Для `CANDIDATE_QUESTIONS`:

```typescript
return parseCandidateLiveReply(rawReply, { requireConfidence: false });
```

- [ ] **Step 6: Run tests**

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: ALL PASS у цьому файлі.

- [ ] **Step 7: Commit**

```bash
git add backend/src/agents/prompts/candidate-live-agent.uk.ts backend/src/agents/candidate-live-agent.ts backend/src/agents/candidate-live-agent.test.ts
git commit -m "feat: candidate live agent confidence prompt and nudges"
```

---

### Task 4: Socket layer — DTO, orchestrator, room

**Files:**
- Modify: `backend/src/socket/types.ts`
- Modify: `backend/src/socket/orchestrator.ts`
- Modify: `backend/src/socket/room.ts`
- Modify: `backend/src/socket/orchestrator.test.ts`

**Interfaces:**
- Consumes: `ParsedCandidateLiveReply.confidence`, `toPrismaCandidateConfidence()`
- Produces:
  ```typescript
  // types.ts
  candidateConfidence?: "CONFIRMED" | "INFERRED" | "UNKNOWN" | null;

  // orchestrator saveAndEmit(..., candidateConfidence?: CandidateConfidence | null)
  ```

- [ ] **Step 1: Write failing orchestrator test for inferred continuation**

Додай у `orchestrator.test.ts`:

```typescript
test("orchestrator continues after Candidate inferred confidence", async () => {
  const messages: LiveMessage[] = [];
  const prisma = makePrisma(messages);
  const { io } = makeIo();
  let arbiterN = 0;
  let candidateCalls = 0;

  const orchestrator = createRoomOrchestrator(() => prisma, {
    debounceMs: 30,
    maxConductorSteps: 6,
    runArbiterTurn: async () => {
      arbiterN += 1;
      if (arbiterN === 1) {
        return cmd({ action: "ANSWER", summaryUk: "Відповісти" });
      }
      return cmd({ action: "NEXT_QUESTION", summaryUk: "Далі" });
    },
    runCandidateLiveTurn: async () => {
      candidateCalls += 1;
      return {
        post: true,
        message: "З анкети видно, що кандидат вивчає Pinia.",
        confidence: "inferred",
        needsHuman: false,
      };
    },
    runCompanyLiveTurn: async () => ({ post: true, message: "Наступне питання?" }),
  });

  orchestrator.onHumanMessage(io, "interview_1", "session_1");
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(candidateCalls, 1);
  assert.ok(arbiterN >= 2, "arbiter should continue after inferred");
});
```

Онови `makePrisma` щоб приймав `candidateConfidence`:

```typescript
data: {
  sessionId: string;
  authorType: string;
  content: string;
  candidateConfidence?: string | null;
};
// ...
const created = {
  ...
  candidateConfidence: data.candidateConfidence ?? null,
} as LiveMessage;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && node --import tsx --test src/socket/orchestrator.test.ts
```

Expected: новий test FAIL (arbiterN < 2) або TS error на confidence у create.

- [ ] **Step 3: Update `types.ts`**

```typescript
export type CandidateConfidenceDto = "CONFIRMED" | "INFERRED" | "UNKNOWN";

export type LiveMessageDto = {
  id: string;
  authorType: LiveAuthorTypeDto;
  content: string;
  candidateConfidence?: CandidateConfidenceDto | null;
  createdAt: string;
};
```

- [ ] **Step 4: Update `toDto` in orchestrator.ts and room.ts**

```typescript
function toDto(message: LiveMessage): LiveMessageDto {
  return {
    id: message.id,
    authorType: message.authorType,
    content: message.content,
    candidateConfidence: message.candidateConfidence ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}
```

- [ ] **Step 5: Update `saveAndEmit` in orchestrator.ts**

```typescript
import type { CandidateConfidence } from "@prisma/client";
import { toPrismaCandidateConfidence } from "../agents/candidate-live-agent";

async function saveAndEmit(
  io: Server,
  prisma: PrismaClient,
  sessionId: string,
  interviewId: string,
  authorType: LiveAuthorType,
  content: string,
  candidateConfidence?: CandidateConfidence | null,
): Promise<LiveMessage> {
  const saved = await prisma.liveMessage.create({
    data: {
      sessionId,
      authorType,
      content,
      candidateConfidence: candidateConfidence ?? null,
    },
  });
  io.to(roomName(interviewId)).emit("room:messages", {
    messages: [toDto(saved)],
  });
  return saved;
}
```

У блоці `AGENT_CANDIDATE`:

```typescript
if (reply.post && reply.message) {
  const prismaConfidence =
    reply.confidence != null
      ? toPrismaCandidateConfidence(reply.confidence)
      : null;
  await saveAndEmit(
    io,
    prisma,
    sessionId,
    interviewId,
    "AGENT_CANDIDATE",
    reply.message,
    prismaConfidence,
  );
  candidatePostedThisTurn = true;
}
```

- [ ] **Step 6: Run orchestrator tests**

```bash
cd backend && node --import tsx --test src/socket/orchestrator.test.ts
```

Expected: ALL PASS (включно з inferred continuation і existing unknown stop test).

- [ ] **Step 7: Commit**

```bash
git add backend/src/socket/
git commit -m "feat: persist and emit candidate confidence in live room"
```

---

### Task 5: Arbiter prompt — WAIT лише для unknown

**Files:**
- Modify: `backend/src/agents/prompts/arbiter-agent.uk.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`

**Interfaces:**
- Produces: оновлене правило черги в `ARBITER_AGENT_SYSTEM_PROMPT_UK`

- [ ] **Step 1: Write failing arbiter prompt test**

Заміни тест `arbiter prompt waits after candidate assumption or human deferral`:

```typescript
test("arbiter prompt waits only after unknown confidence deferral", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /unknown|немає даних|відповісти/i);
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /inferred/i);
  assert.doesNotMatch(
    ARBITER_AGENT_SYSTEM_PROMPT_UK,
    /припущення.*підтверд.*WAIT/s,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && node --import tsx --test src/agents/arbiter-agent.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update arbiter prompt rule**

Заміни рядок 18 у `arbiter-agent.uk.ts`:

```
- Якщо Candidate щойно попросив живу людину відповісти (confidence unknown / немає даних у профілі) — WAIT (не повторюй ANSWER), поки не буде повідомлення від HUMAN_CANDIDATE.
- Якщо Candidate відповів з inferred (висновок з профілю) — оціни відповідь; дай NEXT_QUESTION або CLARIFY; не чекай підтвердження від людини.
```

- [ ] **Step 4: Run tests**

```bash
cd backend && node --import tsx --test src/agents/arbiter-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/arbiter-agent.uk.ts backend/src/agents/arbiter-agent.test.ts
git commit -m "feat: arbiter WAIT only after unknown candidate confidence"
```

---

### Task 6: Final report — transcript + prompt

**Files:**
- Modify: `backend/src/agents/final-report-agent.ts`
- Modify: `backend/src/agents/prompts/final-report.uk.ts`
- Modify: `backend/src/agents/final-report-agent.test.ts`
- Modify: `backend/src/routes/interviews.ts`

**Interfaces:**
- Consumes: `LiveMessage.candidateConfidence` з Prisma
- Produces:
  ```typescript
  export type LiveTranscriptItem = {
    authorType: LiveAuthorType;
    content: string;
    candidateConfidence?: import("@prisma/client").CandidateConfidence | null;
  };
  // formatLiveTranscript adds " · confirmed|inferred|unknown" for AGENT_CANDIDATE
  ```

- [ ] **Step 1: Write failing transcript test**

```typescript
test("formatLiveTranscript includes confidence labels for AGENT_CANDIDATE", () => {
  const text = formatLiveTranscript([
    {
      authorType: "AGENT_CANDIDATE",
      content: "Кандидат має досвід.",
      candidateConfidence: "CONFIRMED",
    },
    {
      authorType: "AGENT_CANDIDATE",
      content: "З анкети видно…",
      candidateConfidence: "INFERRED",
    },
    {
      authorType: "AGENT_CANDIDATE",
      content: "Ірино, відповідай.",
      candidateConfidence: "UNKNOWN",
    },
  ]);
  assert.match(text, /\[Кандидат \(AI\) · confirmed\]/);
  assert.match(text, /\[Кандидат \(AI\) · inferred\]/);
  assert.match(text, /\[Кандидат \(AI\) · unknown\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && node --import tsx --test src/agents/final-report-agent.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update `formatLiveTranscript`**

```typescript
const CONFIDENCE_LABELS: Record<string, string> = {
  CONFIRMED: "confirmed",
  INFERRED: "inferred",
  UNKNOWN: "unknown",
};

function formatAuthorLabel(item: LiveTranscriptItem): string {
  const base = AUTHOR_LABELS[item.authorType];
  if (
    item.authorType === "AGENT_CANDIDATE" &&
    item.candidateConfidence &&
    CONFIDENCE_LABELS[item.candidateConfidence]
  ) {
    return `${base} · ${CONFIDENCE_LABELS[item.candidateConfidence]}`;
  }
  return base;
}

export function formatLiveTranscript(messages: LiveTranscriptItem[]): string {
  if (messages.length === 0) return "(розмова порожня)";
  return messages
    .map((item) => `[${formatAuthorLabel(item)}] ${item.content}`)
    .join("\n");
}
```

- [ ] **Step 4: Update `final-report.uk.ts`**

Додай до правил:

```
- У стенограмі мітки «· confirmed», «· inferred», «· unknown» біля Кандидат (AI) показують впевненість AI.
- confirmed — факт з анкети; inferred — висновок AI, не підтверджений досвід; unknown — AI не знав і передав людині.
- inferred-відповіді по суттєвих вимогах вакансії включай у risks як caveat, якщо людина не підтвердила пізніше.
- Після unknown пріоритет має HUMAN_CANDIDATE.
- Не підвищуй matchScore лише через inferred без підтвердження людиною.
```

- [ ] **Step 5: Update `interviews.ts` end route**

```typescript
transcript: formatLiveTranscript(
  messages.map((m) => ({
    authorType: m.authorType,
    content: m.content,
    candidateConfidence: m.candidateConfidence,
  })),
),
```

- [ ] **Step 6: Run tests**

```bash
cd backend && node --import tsx --test src/agents/final-report-agent.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/agents/final-report-agent.ts backend/src/agents/prompts/final-report.uk.ts backend/src/agents/final-report-agent.test.ts backend/src/routes/interviews.ts
git commit -m "feat: final report transcript includes candidate confidence"
```

---

### Task 7: Frontend — confidence badges in live chat

**Files:**
- Modify: `frontend/src/composables/useInterviewRoom.ts`
- Modify: `frontend/src/utils/live-message-styles.ts`
- Modify: `frontend/src/components/LiveChatPanel.vue`

**Interfaces:**
- Consumes: `candidateConfidence` з `room:messages` DTO
- Produces:
  ```typescript
  export type CandidateConfidence = "CONFIRMED" | "INFERRED" | "UNKNOWN";

  export function confidenceBadgeFor(
    authorType: LiveAuthorType,
    confidence?: CandidateConfidence | null,
  ): { label: string; style: LabelStyle } | null;
  ```

- [ ] **Step 1: Extend types in `useInterviewRoom.ts`**

```typescript
export type CandidateConfidence = "CONFIRMED" | "INFERRED" | "UNKNOWN";

export type LiveMessage = {
  id: string;
  authorType: LiveAuthorType;
  content: string;
  candidateConfidence?: CandidateConfidence | null;
  createdAt: string;
};
```

Переконайся, що merge повідомлень у composable зберігає `candidateConfidence` (spread/map без втрати поля).

- [ ] **Step 2: Add badge helper in `live-message-styles.ts`**

```typescript
const CONFIDENCE_BADGES: Record<
  CandidateConfidence,
  { label: string; background: string; color: string }
> = {
  CONFIRMED: { label: "З профілю", background: "#d1fae5", color: "#047857" },
  INFERRED: { label: "Висновок", background: "#fef3c7", color: "#d97706" },
  UNKNOWN: { label: "Потрібна відповідь", background: "#ffedd5", color: "#c2410c" },
};

export function confidenceBadgeFor(
  authorType: LiveAuthorType,
  confidence?: CandidateConfidence | null,
): { label: string; background: string; color: string } | null {
  if (authorType !== "AGENT_CANDIDATE" || !confidence) return null;
  return CONFIDENCE_BADGES[confidence] ?? null;
}
```

- [ ] **Step 3: Render badge in `LiveChatPanel.vue`**

```vue
<script setup lang="ts">
import { labelFor, messageStyles, confidenceBadgeFor } from "../utils/live-message-styles";
</script>

<!-- у template, всередині v-for message -->
<span
  class="message-label"
  :style="messageStyles(message.authorType, currentRole).label"
>
  {{ labelFor(message.authorType) }}
</span>
<span
  v-if="confidenceBadgeFor(message.authorType, message.candidateConfidence)"
  class="confidence-badge"
  :style="confidenceBadgeFor(message.authorType, message.candidateConfidence)!"
>
  {{ confidenceBadgeFor(message.authorType, message.candidateConfidence)!.label }}
</span>
```

Додай CSS:

```css
.confidence-badge {
  display: inline-block;
  font-size: 0.7rem;
  padding: 0.1rem 0.45rem;
  border-radius: 9999px;
  margin-left: 0.35rem;
  margin-bottom: 0.25rem;
  vertical-align: middle;
}
```

Опційно: computed helper `confidenceBadge(message)` щоб не викликати функцію тричі.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useInterviewRoom.ts frontend/src/utils/live-message-styles.ts frontend/src/components/LiveChatPanel.vue
git commit -m "feat: show candidate AI confidence badges in live chat"
```

---

### Task 8: Final verification

**Files:** (none — verification only)

- [ ] **Step 1: Run backend tests**

```bash
cd backend && node --import tsx --test \
  src/agents/candidate-live-agent.test.ts \
  src/agents/arbiter-agent.test.ts \
  src/agents/final-report-agent.test.ts \
  src/socket/orchestrator.test.ts
```

Expected: ALL PASS.

- [ ] **Step 2: Run full monorepo build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Manual smoke (optional but recommended)**

1. Live-кімната: питання з профілю → бейдж «З профілю».
2. Питання про зону росту → «Висновок», розмова без паузи.
3. Питання без даних → «Потрібна відповідь», стоп до людини.
4. Reload → бейджі на місці.
5. Завершити → звіт з caveat про inferred у risks.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Prisma enum + field | Task 1 |
| JSON confidence + parser | Task 2 |
| 3 ANSWER modes in prompt | Task 3 |
| inferred continues / unknown stops | Tasks 2, 4 |
| DTO + socket emit | Task 4 |
| UI badges HR + candidate | Task 7 |
| Transcript labels | Task 6 |
| Report prompt rules | Task 6 |
| Arbiter WAIT for unknown only | Task 5 |

No TBD placeholders. Types consistent: `CandidateConfidenceLevel` (LLM) → `CandidateConfidence` (Prisma) → `CandidateConfidenceDto` (socket/UI).

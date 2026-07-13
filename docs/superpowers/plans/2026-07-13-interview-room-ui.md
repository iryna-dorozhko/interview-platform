# Interview Room UI + Final Report (Day 19+20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зручна live-кімната для HR і кандидата — кнопки «Увійти в співбесіду», кольорові мітки учасників, HR-only «Завершити співбесіду» з AI-звітом у `FinalReport`.

**Architecture:** Модульний стек: `live-message-styles.ts` для UI кольорів; `final-report-agent.ts` для LLM-звіту за патерном profile extraction; `POST /api/interviews/:id/end` з inject `io` для broadcast `room:status`. Frontend викликає REST, socket оновлює read-only стан.

**Tech Stack:** Vue 3 + TypeScript (frontend), Express + Prisma + Socket.IO + `LlmProvider` (backend), `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-13-interview-room-ui-design.md`

---

## File Structure

| File | Відповідальність |
|------|------------------|
| `backend/src/agents/prompts/final-report.uk.ts` | System prompt для генерації звіту |
| `backend/src/agents/final-report-agent.ts` | `buildFinalReportMessages`, `parseFinalReport`, `formatLiveTranscript` |
| `backend/src/agents/final-report-agent.test.ts` | Unit-тести парсера |
| `backend/src/routes/interviews.ts` | `POST /interviews/:id/end`; розширений `createInterviewsRouter` |
| `backend/src/routes/interviews.test.ts` | Тести endpoint + оновлений `makeApp` |
| `backend/src/server.ts` | Inject `io` і `getProvider` в interviews router |
| `frontend/src/utils/live-message-styles.ts` | Кольори/мітки за `authorType` |
| `frontend/src/components/LiveChatPanel.vue` | Стилі з утиліти |
| `frontend/src/views/InterviewListView.vue` | Кнопка «Увійти в співбесіду» |
| `frontend/src/views/CandidateInterviewView.vue` | Перейменування кнопки |
| `frontend/src/api/interviews.ts` | `endInterview()` |
| `frontend/src/components/InterviewRoomContent.vue` | Кнопка «Завершити співбесіду» |
| `backend/package.json` | Додати `final-report-agent.test.ts` у script `test` |
| `README.md` | Day 19+20 Quick Start, endpoint, кольори |

---

### Task 1: Final Report Agent

**Files:**
- Create: `backend/src/agents/prompts/final-report.uk.ts`
- Create: `backend/src/agents/final-report-agent.ts`
- Create: `backend/src/agents/final-report-agent.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/agents/final-report-agent.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  FinalReportExtractionError,
  formatLiveTranscript,
  parseFinalReport,
} from "./final-report-agent";

test("formatLiveTranscript maps author types to Ukrainian labels", () => {
  const text = formatLiveTranscript([
    { authorType: "HUMAN_HR", content: "Вітаю!" },
    { authorType: "AGENT_ARBITER", content: "Почнемо." },
  ]);
  assert.match(text, /\[HR\] Вітаю!/);
  assert.match(text, /\[Arbiter\] Почнемо./);
});

test("parseFinalReport parses valid JSON", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## Підсумок\n\nДобре.",
    recommendation: "HIRE",
    matchScore: 82,
    strengths: ["Досвід Node.js"],
    risks: ["Мало leadership"],
  });
  const result = parseFinalReport(raw);
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.matchScore, 82);
  assert.equal(result.strengths[0], "Досвід Node.js");
  assert.match(result.reportMarkdown, "Підсумок");
});

test("parseFinalReport strips markdown code fences", () => {
  const raw = "```json\n{\"reportMarkdown\":\"## OK\",\"recommendation\":\"MAYBE\",\"matchScore\":50,\"strengths\":[\"a\"],\"risks\":[\"b\"]}\n```";
  const result = parseFinalReport(raw);
  assert.equal(result.recommendation, "MAYBE");
});

test("parseFinalReport throws on invalid recommendation", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## X",
    recommendation: "YES",
    matchScore: 50,
    strengths: ["a"],
    risks: ["b"],
  });
  assert.throws(() => parseFinalReport(raw), FinalReportExtractionError);
});

test("parseFinalReport throws when matchScore out of range", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## X",
    recommendation: "HIRE",
    matchScore: 101,
    strengths: ["a"],
    risks: ["b"],
  });
  assert.throws(() => parseFinalReport(raw), FinalReportExtractionError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/agents/final-report-agent.test.ts`

Expected: FAIL — `Cannot find module './final-report-agent'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/agents/prompts/final-report.uk.ts
export const FINAL_REPORT_SYSTEM_PROMPT_UK = `Ти HR-аналітик. Отримуєш стенограму live-співбесіди та JSON-профілі компанії і кандидата.

Поверни СТРОГО валідний JSON без тексту навколо (без markdown-обгортки, без пояснень):

{"reportMarkdown":"...","recommendation":"HIRE|MAYBE|REJECT","matchScore":0-100,"strengths":["..."],"risks":["..."]}

Правила:
- reportMarkdown — markdown українською з розділами: ## Підсумок, ## Відповідність вимогам, ## Сильні сторони, ## Ризики, ## Рекомендація
- recommendation — лише HIRE, MAYBE або REJECT
- matchScore — ціле число 0–100
- strengths, risks — масиви рядків українською; мінімум один елемент кожен
- Спирайся лише на надані дані; не вигадуй фактів`;
```

```typescript
// backend/src/agents/final-report-agent.ts
import type { LiveAuthorType } from "@prisma/client";
import type { ChatMessage } from "../llm/types";
import { FINAL_REPORT_SYSTEM_PROMPT_UK } from "./prompts/final-report.uk";

export type LiveTranscriptItem = {
  authorType: LiveAuthorType;
  content: string;
};

export type ExtractedFinalReport = {
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
};

export class FinalReportExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalReportExtractionError";
  }
}

const AUTHOR_LABELS: Record<LiveAuthorType, string> = {
  HUMAN_HR: "HR",
  HUMAN_CANDIDATE: "Кандидат",
  AGENT_ARBITER: "Arbiter",
  AGENT_COMPANY: "Компанія",
  AGENT_CANDIDATE: "Кандидат (AI)",
};

const VALID_RECOMMENDATIONS = new Set(["HIRE", "MAYBE", "REJECT"]);

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FinalReportExtractionError(`missing or invalid field: ${field}`);
  }
  return value.map((item) => String(item));
}

export function formatLiveTranscript(messages: LiveTranscriptItem[]): string {
  if (messages.length === 0) return "(розмова порожня)";
  return messages
    .map((item) => `[${AUTHOR_LABELS[item.authorType]}] ${item.content}`)
    .join("\n");
}

export function parseFinalReport(rawText: string): ExtractedFinalReport {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new FinalReportExtractionError("LLM returned invalid JSON for final report");
  }

  if (typeof data !== "object" || data === null) {
    throw new FinalReportExtractionError("LLM response is not a JSON object");
  }

  const { reportMarkdown, recommendation, matchScore, strengths, risks } = data as Record<
    string,
    unknown
  >;

  if (typeof reportMarkdown !== "string" || !reportMarkdown.trim()) {
    throw new FinalReportExtractionError("missing or invalid field: reportMarkdown");
  }

  if (typeof recommendation !== "string" || !VALID_RECOMMENDATIONS.has(recommendation)) {
    throw new FinalReportExtractionError("missing or invalid field: recommendation");
  }

  if (typeof matchScore !== "number" || !Number.isInteger(matchScore) || matchScore < 0 || matchScore > 100) {
    throw new FinalReportExtractionError("missing or invalid field: matchScore");
  }

  return {
    reportMarkdown: reportMarkdown.trim(),
    recommendation: recommendation as ExtractedFinalReport["recommendation"],
    matchScore,
    strengths: toStringArray(strengths, "strengths"),
    risks: toStringArray(risks, "risks"),
  };
}

export function buildFinalReportMessages(input: {
  transcript: string;
  companyProfile: unknown;
  candidateProfile: unknown;
}): ChatMessage[] {
  const userContent = [
    "=== СТЕНОГРАМА ===",
    input.transcript,
    "",
    "=== ПРОФІЛЬ КОМПАНІЇ (JSON) ===",
    JSON.stringify(input.companyProfile, null, 2),
    "",
    "=== ПРОФІЛЬ КАНДИДАТА (JSON) ===",
    JSON.stringify(input.candidateProfile, null, 2),
  ].join("\n");

  return [
    { role: "system", content: FINAL_REPORT_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/agents/final-report-agent.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Add test file to package.json and commit**

Додати `src/agents/final-report-agent.test.ts` у script `test` в `backend/package.json`.

```bash
git add backend/src/agents/prompts/final-report.uk.ts backend/src/agents/final-report-agent.ts backend/src/agents/final-report-agent.test.ts backend/package.json
git commit -m "feat: add final report agent for interview end flow"
```

---

### Task 2: POST /api/interviews/:id/end

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Write the failing test**

Додати в `backend/src/routes/interviews.test.ts` перед існуючими тестами — helper і mock-и:

```typescript
import type { Server } from "socket.io";
import type { LlmProvider } from "../llm/types";

type EmittedEvent = { room: string; event: string; payload: unknown };

function makeMockIo(): { io: Server; emitted: EmittedEvent[] } {
  const emitted: EmittedEvent[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  } as unknown as Server;
  return { io, emitted };
}

function makeMockProvider(reply: string): LlmProvider {
  return {
    name: "test-provider",
    complete: async () => reply,
  };
}

function makeAppWithEnd(
  fakePrisma: ReturnType<typeof makeFakePrisma>,
  user: AuthUser,
  options?: { provider?: LlmProvider; io?: Server },
) {
  const { io } = makeMockIo();
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use(
    "/api",
    createInterviewsRouter(
      () => fakePrisma as never,
      () => options?.io ?? io,
      () => options?.provider ?? makeMockProvider("{}"),
    ),
  );
  return app;
}
```

Оновити існуючий `makeApp` — делегувати в `makeAppWithEnd` без custom provider (щоб старі тести не зламались після зміни сигнатури router).

Додати тест:

```typescript
test("POST /interviews/:id/end returns 201 and creates FinalReport when LIVE", async () => {
  const validReport = JSON.stringify({
    reportMarkdown: "## Підсумок\n\nOK",
    recommendation: "HIRE",
    matchScore: 78,
    strengths: ["Досвід"],
    risks: ["Невідомо"],
  });

  const interviews = [
    {
      id: "int_live",
      hrUserId: "hr_1",
      vacancyId: "v1",
      displayName: "Backend",
      joinCode: "ABC123",
      status: "LIVE",
      createdAt: new Date(),
    },
  ];

  let updatedStatus: string | null = null;
  let createdReport: Record<string, unknown> | null = null;

  const fakePrisma = makeFakePrisma(interviews, [confirmedVacancy]) as ReturnType<
    typeof makeFakePrisma
  > & {
    interview: ReturnType<typeof makeFakePrisma>["interview"] & {
      update: (args: { where: { id: string }; data: { status: string } }) => Promise<unknown>;
    };
    finalReport: {
      findUnique: (args: { where: { interviewId: string } }) => Promise<unknown>;
      create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    };
    liveSession: {
      findUnique: (args: { where: { interviewId: string } }) => Promise<{
        id: string;
        messages: { authorType: string; content: string }[];
      } | null>;
    };
    companyProfile: {
      findUnique: (args: { where: { vacancyId: string } }) => Promise<Record<string, unknown>>;
    };
    candidateProfile: {
      findUnique: (args: { where: { interviewId: string } }) => Promise<Record<string, unknown>>;
    };
    $transaction: (fn: (tx: typeof fakePrisma) => Promise<unknown>) => Promise<unknown>;
  };

  fakePrisma.interview.update = async ({ data }) => {
    updatedStatus = data.status;
    interviews[0].status = data.status;
    return interviews[0];
  };
  fakePrisma.finalReport = {
    findUnique: async () => null,
    create: async ({ data }) => {
      createdReport = data;
      return { id: "rep_1" };
    },
  };
  fakePrisma.liveSession = {
    findUnique: async () => ({
      id: "ls_1",
      messages: [{ authorType: "HUMAN_HR", content: "Привіт" }],
    }),
  };
  fakePrisma.companyProfile = {
    findUnique: async () => ({ role: "Backend", requirements: [], culture: [], expectations: [] }),
  };
  fakePrisma.candidateProfile = {
    findUnique: async () => ({ skills: [], experience: [], goals: [], summary: "Dev" }),
  };
  fakePrisma.$transaction = async (fn) => fn(fakePrisma);

  const { io, emitted } = makeMockIo();
  const app = makeAppWithEnd(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" }, {
    provider: makeMockProvider(validReport),
    io,
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/int_live/end`, {
      method: "POST",
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      report: { id: string; recommendation: string; matchScore: number };
    };
    assert.equal(body.report.id, "rep_1");
    assert.equal(body.report.recommendation, "HIRE");
    assert.equal(body.report.matchScore, 78);
    assert.equal(updatedStatus, "ENDED");
    assert.equal(createdReport?.recommendation, "HIRE");
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "room:status");
    assert.deepEqual(emitted[0].payload, { status: "ENDED" });
    assert.equal(emitted[0].room, "interview:int_live");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test("POST /interviews/:id/end returns 409 when status is not LIVE", async () => {
  const fakePrisma = makeFakePrisma(
    [
      {
        id: "int_ready",
        hrUserId: "hr_1",
        vacancyId: "v1",
        displayName: "Backend",
        joinCode: "ABC123",
        status: "READY",
        createdAt: new Date(),
      },
    ],
    [confirmedVacancy],
  );
  const app = makeAppWithEnd(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/int_ready/end`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/routes/interviews.test.ts`

Expected: FAIL — route not found або wrong number of arguments для `createInterviewsRouter`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/routes/interviews.ts — оновити імпорти і сигнатуру
import type { Server } from "socket.io";
import type { LlmProvider } from "../llm/types";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import {
  buildFinalReportMessages,
  formatLiveTranscript,
  parseFinalReport,
} from "../agents/final-report-agent";
import { roomName } from "../socket/maybe-transition-live";

export function createInterviewsRouter(
  getPrisma: () => PrismaClient,
  getIo: () => Server,
  getProvider: () => LlmProvider,
): Router {
  // ... існуючі routes без змін ...

  router.post("/interviews/:id/end", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviewId = req.params.id;

    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        finalReport: true,
        liveSession: { include: { messages: { orderBy: { createdAt: "asc" } } } },
        vacancy: { include: { companyProfile: true } },
        candidateProfile: true,
      },
    });

    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (interview.status !== "LIVE") {
      res.status(409).json({ error: "Interview is not live" });
      return;
    }
    if (interview.finalReport) {
      res.status(409).json({ error: "Interview already ended" });
      return;
    }

    const messages = interview.liveSession?.messages ?? [];
    const companyProfile = interview.vacancy.companyProfile;
    const candidateProfile = interview.candidateProfile;

    if (!companyProfile || !candidateProfile) {
      res.status(409).json({ error: "Profiles not ready" });
      return;
    }

    const llmMessages = buildFinalReportMessages({
      transcript: formatLiveTranscript(messages),
      companyProfile,
      candidateProfile,
    });

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[interviews:end] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }
      if (error instanceof LlmError && error.code === "empty_response") {
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[interviews:end:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let extracted;
    try {
      extracted = parseFinalReport(rawReply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[interviews:end] failed to parse final report:", detail);
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    let report;
    try {
      report = await prisma.$transaction(async (tx) => {
        await tx.interview.update({
          where: { id: interviewId },
          data: { status: "ENDED" },
        });
        return tx.finalReport.create({
          data: {
            interviewId,
            reportMarkdown: extracted.reportMarkdown,
            recommendation: extracted.recommendation,
            matchScore: extracted.matchScore,
            strengths: extracted.strengths,
            risks: extracted.risks,
          },
        });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[interviews:end] failed to persist report:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    getIo().to(roomName(interviewId)).emit("room:status", { status: "ENDED" });

    res.status(201).json({
      report: {
        id: report.id,
        recommendation: report.recommendation,
        matchScore: report.matchScore,
      },
    });
  });

  return router;
}
```

```typescript
// backend/src/server.ts — змінити рядок interviews router
app.use(
  "/api",
  requireAuth,
  requireHr,
  createInterviewsRouter(() => prisma, () => io, () => createLlmProvider()),
);
```

Оновити `makeApp` у тестах — передавати mock `io` і stub provider (див. Step 1).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace backend test -- src/routes/interviews.test.ts`

Expected: PASS (усі існуючі + нові end-тести).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts backend/src/server.ts
git commit -m "feat: add POST /interviews/:id/end with final report generation"
```

---

### Task 3: Live message colors

**Files:**
- Create: `frontend/src/utils/live-message-styles.ts`
- Modify: `frontend/src/components/LiveChatPanel.vue`

- [ ] **Step 1: Create styles utility**

```typescript
// frontend/src/utils/live-message-styles.ts
export type LiveAuthorType =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

type BubbleStyle = { background: string; color: string };
type LabelStyle = { background: string; color: string };

const NEUTRAL_BUBBLE: BubbleStyle = { background: "#e5e7eb", color: "#1f2937" };

const STYLES: Record<
  LiveAuthorType,
  { label: string; accent: BubbleStyle; labelStyle: LabelStyle }
> = {
  HUMAN_HR: {
    label: "HR",
    accent: { background: "#dbeafe", color: "#1e3a5f" },
    labelStyle: { background: "#dbeafe", color: "#1e40af" },
  },
  HUMAN_CANDIDATE: {
    label: "Кандидат",
    accent: { background: "#d1fae5", color: "#065f46" },
    labelStyle: { background: "#d1fae5", color: "#047857" },
  },
  AGENT_ARBITER: {
    label: "Arbiter",
    accent: { background: "#ede9fe", color: "#5b21b6" },
    labelStyle: { background: "#ede9fe", color: "#6d28d9" },
  },
  AGENT_COMPANY: {
    label: "Компанія",
    accent: { background: "#ffedd5", color: "#9a3412" },
    labelStyle: { background: "#ffedd5", color: "#c2410c" },
  },
  AGENT_CANDIDATE: {
    label: "Кандидат (AI)",
    accent: { background: "#fce7f3", color: "#9d174d" },
    labelStyle: { background: "#fce7f3", color: "#be185d" },
  },
};

export function labelFor(authorType: LiveAuthorType): string {
  return STYLES[authorType]?.label ?? "Учасник";
}

export function isOwnMessage(
  authorType: LiveAuthorType,
  currentRole: "HR" | "CANDIDATE",
): boolean {
  return (
    (currentRole === "HR" && authorType === "HUMAN_HR") ||
    (currentRole === "CANDIDATE" && authorType === "HUMAN_CANDIDATE")
  );
}

export function messageStyles(
  authorType: LiveAuthorType,
  currentRole: "HR" | "CANDIDATE",
): { bubble: BubbleStyle; label: LabelStyle; own: boolean } {
  const own = isOwnMessage(authorType, currentRole);
  const config = STYLES[authorType] ?? STYLES.HUMAN_HR;

  if (authorType.startsWith("AGENT_")) {
    return { bubble: config.accent, label: config.labelStyle, own: false };
  }

  if (own) {
    return { bubble: config.accent, label: config.labelStyle, own: true };
  }

  return { bubble: NEUTRAL_BUBBLE, label: { background: "#f3f4f6", color: "#4b5563" }, own: false };
}
```

- [ ] **Step 2: Update LiveChatPanel.vue**

У `<script setup>`:

```typescript
import { labelFor, messageStyles } from "../utils/live-message-styles";
```

Видалити локальний `labelFor` і computed `ownAuthorType` (замінити на `messageStyles`).

У template замінити блок повідомлення:

```vue
<div
  v-for="message in messages"
  :key="message.id"
  class="message"
  :class="{ own: messageStyles(message.authorType, currentRole).own }"
>
  <span
    class="message-label"
    :style="messageStyles(message.authorType, currentRole).label"
  >
    {{ labelFor(message.authorType) }}
  </span>
  <p
    class="message-text"
    :style="messageStyles(message.authorType, currentRole).bubble"
  >
    {{ message.content }}
  </p>
</div>
```

У CSS:
- Видалити `.message.own .message-text`, `.message.agent .message-text` (кольори тепер inline)
- Додати для `.message-label`: `display: inline-block; padding: 0.1rem 0.5rem; border-radius: 9999px; margin-bottom: 0.25rem;`

- [ ] **Step 3: Verify frontend build**

Run: `npm --workspace frontend run build`

Expected: PASS без TypeScript-помилок.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/live-message-styles.ts frontend/src/components/LiveChatPanel.vue
git commit -m "feat: distinct colors for each live chat participant"
```

---

### Task 4: Join buttons

**Files:**
- Modify: `frontend/src/views/InterviewListView.vue`
- Modify: `frontend/src/views/CandidateInterviewView.vue`

- [ ] **Step 1: Add HR join button in InterviewListView**

У колонці «Дії» (`actions-cell`), перед «Видалити»:

```vue
<button
  v-if="interview.status === 'READY' || interview.status === 'LIVE'"
  type="button"
  class="btn-primary"
  @click="goToRoom(interview.id)"
>
  Увійти в співбесіду
</button>
```

Клік по назві (`name-link`) — без змін.

- [ ] **Step 2: Rename candidate button**

У `CandidateInterviewView.vue` замінити текст кнопки:

```vue
Увійти в співбесіду
```

- [ ] **Step 3: Verify build**

Run: `npm --workspace frontend run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/InterviewListView.vue frontend/src/views/CandidateInterviewView.vue
git commit -m "feat: add join interview buttons for HR and candidate"
```

---

### Task 5: End interview UI

**Files:**
- Modify: `frontend/src/api/interviews.ts`
- Modify: `frontend/src/components/InterviewRoomContent.vue`

- [ ] **Step 1: Add endInterview API**

```typescript
// frontend/src/api/interviews.ts
export type EndInterviewResult = {
  reportId: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
};

export async function endInterview(id: string): Promise<EndInterviewResult> {
  const response = await fetchWithAuth(`/api/interviews/${id}/end`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити співбесіду");
  }
  const body = (await response.json()) as {
    report: { id: string; recommendation: EndInterviewResult["recommendation"]; matchScore: number };
  };
  return {
    reportId: body.report.id,
    recommendation: body.report.recommendation,
    matchScore: body.report.matchScore,
  };
}
```

- [ ] **Step 2: Add end button to InterviewRoomContent**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { endInterview } from "../api/interviews";
// ... існуючі imports

const ending = ref(false);
const endSuccess = ref<string | null>(null);
const endError = ref<string | null>(null);

const showEndButton = computed(
  () => props.currentRole === "HR" && interviewStatus.value === "LIVE",
);

async function onEndInterview(): Promise<void> {
  if (!window.confirm("Завершити співбесіду? Буде згенеровано фінальний звіт.")) return;
  ending.value = true;
  endError.value = null;
  endSuccess.value = null;
  try {
    const result = await endInterview(props.interviewId);
    endSuccess.value = `Звіт згенеровано. Рекомендація: ${result.recommendation}`;
  } catch (error) {
    endError.value = error instanceof Error ? error.message : "Не вдалося завершити співбесіду";
  } finally {
    ending.value = false;
  }
}
</script>

<template>
  <div v-if="showEndButton" class="room-toolbar">
    <button
      type="button"
      class="btn-danger"
      :disabled="ending"
      @click="onEndInterview"
    >
      {{ ending ? "Завершення…" : "Завершити співбесіду" }}
    </button>
  </div>
  <p v-if="endSuccess" class="success-banner">{{ endSuccess }}</p>
  <p v-if="endError" class="error-banner">{{ endError }}</p>
  <!-- ... існуючий phase-banner і LiveChatPanel ... -->
</template>
```

CSS:

```css
.room-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}
.btn-danger {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid #fca5a5;
  background: #fff;
  color: #b00020;
  cursor: pointer;
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.success-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  background: #ecfdf5;
  color: #065f46;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
```

Socket `room:status` → `ENDED` автоматично disabled composer через існуючий `isReadOnly`.

- [ ] **Step 3: Verify build**

Run: `npm --workspace frontend run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/interviews.ts frontend/src/components/InterviewRoomContent.vue
git commit -m "feat: HR end interview button with final report API call"
```

---

### Task 6: README and full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README Day 19 section**

Замінити placeholder Day 19 на:

- Таблицю кольорів учасників (5 рядків з spec)
- Quick Start: HR `/interviews` → «Увійти в співбесідu» при READY/LIVE; кандидат `/candidate/interview` → те саме
- Опис `POST /api/interviews/:id/end` (auth HR, status LIVE → ENDED + FinalReport)
- Структура `FinalReport`: `reportMarkdown`, `recommendation`, `matchScore`, `strengths`, `risks`
- Примітка: UI перегляду звіту — Day 21
- Позначити Day 20 DoD як виконаний разом з Day 19

- [ ] **Step 2: Run full build and tests**

Run: `npm run build`

Run: `npm --workspace backend test`

Expected: PASS.

- [ ] **Step 3: Manual smoke test**

1. HR + кандидат у LIVE-кімнаті — повідомлення різних кольорів
2. HR натискає «Завершити» → ENDED, read-only, success banner
3. Таблиця HR показує recommendation у колонці «Звіт»

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add Day 19+20 interview room UI and final report guide"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| HR join button READY/LIVE | Task 4 |
| Candidate button rename | Task 4 |
| HR early access via name click | Unchanged (Task 4 note) |
| 5-color message palette | Task 3 |
| HR end button LIVE only | Task 5 |
| POST /interviews/:id/end | Task 2 |
| FinalReport AI generation | Task 1 + Task 2 |
| room:status ENDED broadcast | Task 2 |
| README update | Task 6 |
| npm run build | Task 6 |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-interview-room-ui.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

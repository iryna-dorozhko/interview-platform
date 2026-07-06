# Company Prep Chat UI (Delete/Finish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HR-facing "Анкета компанії" chat page for the Company Agent (Day 5), with two new actions — "Видалити чат" (full reset) and "Завершити чат" (generates a structured `CompanyProfile` from the dialogue and closes the session).

**Architecture:** Three new/extended backend endpoints (`GET`/`DELETE /api/prep/:interviewId`, `POST /api/prep/:interviewId/finish`) plus a lightweight `GET /api/interviews/mine` for navigation. A new LLM extraction step turns the full chat transcript into structured JSON (`role`, `requirements`, `culture`, `expectations`) stored in the existing `CompanyProfile` model. Frontend gets one new view (`CompanyPrepView.vue`) reusing the chat UX pattern from `ChatPanel.vue`, wired to the new endpoints, plus a navigation entry point from `HomeView.vue`.

**Tech Stack:** Express + TypeScript + Prisma (backend), Vue 3 + Vite + Pinia (frontend), `node --test` for backend unit tests (fake Prisma + fake `LlmProvider`, no real DB/LLM in tests).

**Spec:** `docs/superpowers/specs/2026-07-06-company-prep-chat-ui-design.md`

---

### Task 1: Company Agent — profile extraction logic

**Files:**
- Create: `backend/src/agents/prompts/company-profile-extraction.uk.ts`
- Modify: `backend/src/agents/company-agent.ts`
- Modify: `backend/src/agents/company-agent.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `backend/src/agents/company-agent.test.ts` (add these imports to the existing `import` line and add the new tests at the end of the file):

```typescript
import {
  buildCompanyAgentMessages,
  buildProfileExtractionMessages,
  parseAgentReply,
  parseProfileExtraction,
} from "./company-agent";
import { COMPANY_AGENT_SYSTEM_PROMPT_UK } from "./prompts/company-agent.uk";
import { PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/company-profile-extraction.uk";
```

(This replaces the existing narrower import line at the top of the file — keep `parseAgentReply`, `buildCompanyAgentMessages` and the `COMPANY_AGENT_SYSTEM_PROMPT_UK` import too.)

Add at the end of the file:

```typescript
test("parseProfileExtraction parses plain JSON", () => {
  const raw = JSON.stringify({
    role: "Middle Backend Developer",
    requirements: ["Node.js", "PostgreSQL"],
    culture: ["Гнучкий графік"],
    expectations: ["Старт за 2 тижні"],
  });
  const result = parseProfileExtraction(raw);
  assert.deepEqual(result, {
    role: "Middle Backend Developer",
    requirements: ["Node.js", "PostgreSQL"],
    culture: ["Гнучкий графік"],
    expectations: ["Старт за 2 тижні"],
  });
});

test("parseProfileExtraction strips markdown code fences around JSON", () => {
  const raw = [
    "```json",
    JSON.stringify({
      role: "QA Engineer",
      requirements: ["3+ роки"],
      culture: ["не вказано"],
      expectations: ["не вказано"],
    }),
    "```",
  ].join("\n");
  const result = parseProfileExtraction(raw);
  assert.equal(result.role, "QA Engineer");
  assert.deepEqual(result.requirements, ["3+ роки"]);
});

test("parseProfileExtraction throws when response is not valid JSON", () => {
  assert.throws(() => parseProfileExtraction("це не json, а звичайний текст"));
});

test("parseProfileExtraction throws when a required field is missing", () => {
  const raw = JSON.stringify({ role: "Designer", requirements: ["Figma"] });
  assert.throws(() => parseProfileExtraction(raw));
});

test("parseProfileExtraction throws when role is empty", () => {
  const raw = JSON.stringify({
    role: "",
    requirements: ["Figma"],
    culture: ["не вказано"],
    expectations: ["не вказано"],
  });
  assert.throws(() => parseProfileExtraction(raw));
});

test("buildProfileExtractionMessages prepends extraction system prompt and joins transcript as one user message", () => {
  const history = [
    { authorType: "HUMAN_HR" as const, content: "Middle Backend Developer" },
    { authorType: "AGENT_COMPANY" as const, content: "Які вимоги?" },
  ];
  const messages = buildProfileExtractionMessages(history);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: PROFILE_EXTRACTION_SYSTEM_PROMPT_UK });
  assert.equal(messages[1].role, "user");
  assert.equal(
    messages[1].content,
    "HR: Middle Backend Developer\nАгент: Які вимоги?"
  );
});

test("buildProfileExtractionMessages handles empty history with a placeholder transcript", () => {
  const messages = buildProfileExtractionMessages([]);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "(розмова порожня)");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace backend run test`
Expected: FAIL — `buildProfileExtractionMessages`, `parseProfileExtraction`, and `PROFILE_EXTRACTION_SYSTEM_PROMPT_UK` are not exported yet (TypeScript/import error).

- [ ] **Step 3: Create the extraction prompt file**

Create `backend/src/agents/prompts/company-profile-extraction.uk.ts`:

```typescript
export const PROFILE_EXTRACTION_SYSTEM_PROMPT_UK = `Ти отримуєш повну стенограму діалогу між HR-менеджером і AI-агентом компанії, який збирав інформацію про вакансію.

Твоє завдання — проаналізувати діалог і повернути СТРОГО валідний JSON без жодного тексту навколо (без пояснень, без markdown, без код-блоків) у такому форматі:

{"role": "назва посади", "requirements": ["вимога 1", "вимога 2"], "culture": ["пункт про культуру 1"], "expectations": ["очікування 1"]}

Правила:
- "role" — короткий рядок з назвою посади (наприклад, "Middle Backend Developer").
- "requirements", "culture", "expectations" — масиви коротких рядків українською; кожен пункт — одна конкретна деталь із діалогу.
- Якщо про якусь тему в діалозі не було сказано нічого конкретного, поверни для неї масив з одним елементом: ["не вказано"].
- Не вигадуй фактів, яких немає в діалозі.
- Відповідь має містити лише JSON, без жодних інших символів до чи після нього.`;
```

- [ ] **Step 4: Implement the extraction logic**

In `backend/src/agents/company-agent.ts`, add the import and new code (keep everything that already exists — `parseAgentReply`, `buildCompanyAgentMessages`, `READY_MARKER_PATTERN`, etc.):

```typescript
import { PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/company-profile-extraction.uk";
```

Append to the end of the file:

```typescript
export interface ExtractedProfile {
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
}

export class ProfileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileExtractionError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProfileExtractionError(`missing or invalid field: ${field}`);
  }
  return value.map((item) => String(item));
}

export function parseProfileExtraction(rawText: string): ExtractedProfile {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new ProfileExtractionError("LLM returned invalid JSON for profile extraction");
  }

  if (typeof data !== "object" || data === null) {
    throw new ProfileExtractionError("LLM response is not a JSON object");
  }

  const { role, requirements, culture, expectations } = data as Record<string, unknown>;

  if (typeof role !== "string" || !role.trim()) {
    throw new ProfileExtractionError("missing or invalid field: role");
  }

  return {
    role: role.trim(),
    requirements: toStringArray(requirements, "requirements"),
    culture: toStringArray(culture, "culture"),
    expectations: toStringArray(expectations, "expectations"),
  };
}

export function buildProfileExtractionMessages(history: PrepHistoryItem[]): ChatMessage[] {
  const transcript = history
    .map((item) => `${item.authorType === "HUMAN_HR" ? "HR" : "Агент"}: ${item.content}`)
    .join("\n");

  return [
    { role: "system", content: PROFILE_EXTRACTION_SYSTEM_PROMPT_UK },
    { role: "user", content: transcript || "(розмова порожня)" },
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace backend run test`
Expected: PASS — all `company-agent.test.ts` tests green, including the 6 new ones.

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/company-agent.ts backend/src/agents/company-agent.test.ts backend/src/agents/prompts/company-profile-extraction.uk.ts
git commit -m "feat: add profile extraction logic to company agent"
```

---

### Task 2: `GET /api/prep/:interviewId` — load chat state

**Files:**
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/prep.test.ts`

- [ ] **Step 1: Write failing tests**

In `backend/src/routes/prep.test.ts`, extend the fake Prisma factory to support profiles and session lookups. Replace the existing `makeFakePrisma` function (and its type aliases above it) with:

```typescript
type FakeInterview = { id: string; hrUserId: string };
type FakeSession = { id: string; interviewId: string; isClosed: boolean };
type FakeMessage = {
  id: string;
  sessionId: string;
  authorType: "HUMAN_HR" | "AGENT_COMPANY";
  content: string;
  createdAt: Date;
};
type FakeProfile = {
  id: string;
  interviewId: string;
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
};

function makeFakePrisma(
  seed: {
    interviews?: FakeInterview[];
    sessions?: FakeSession[];
    profiles?: FakeProfile[];
  } = {}
) {
  const interviews = seed.interviews ?? [];
  const sessions = seed.sessions ?? [];
  const profiles = seed.profiles ?? [];
  const messages: FakeMessage[] = [];
  let counter = 0;

  return {
    interview: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        interviews.find((item) => item.id === where.id) ?? null,
    },
    prepSessionHr: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        sessions.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { interviewId: string };
        create: { interviewId: string };
      }) => {
        let session = sessions.find((item) => item.interviewId === where.interviewId);
        if (!session) {
          session = { id: `session_${++counter}`, interviewId: create.interviewId, isClosed: false };
          sessions.push(session);
        }
        return session;
      },
    },
    prepMessageHr: {
      create: async ({
        data,
      }: {
        data: { sessionId: string; authorType: "HUMAN_HR" | "AGENT_COMPANY"; content: string };
      }) => {
        const message: FakeMessage = { id: `message_${++counter}`, createdAt: new Date(), ...data };
        messages.push(message);
        return message;
      },
      findMany: async ({ where }: { where: { sessionId: string } }) =>
        messages
          .filter((item) => item.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    },
    companyProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
    },
    __sessions: sessions,
    __messages: messages,
    __profiles: profiles,
  };
}
```

Add these tests after the existing `withUser` helper (keep `withUser` as-is):

```typescript
test("GET /prep/:interviewId returns empty state when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { messages: [], isClosed: false, profile: null });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns messages and isClosed when session exists", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    { id: "m1", sessionId: "session_1", authorType: "AGENT_COMPANY", content: "Привіт!", createdAt: new Date(1) }
  );
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.isClosed, false);
    assert.equal(body.profile, null);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].content, "Привіт!");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns profile when session is closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.isClosed, true);
    assert.equal(body.profile.role, "QA Engineer");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/missing`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /prep/:interviewId returns 403 when interview belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_other" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись\nREADY:false"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace backend run test`
Expected: FAIL — `GET /prep/:interviewId` returns 404 (no such route registered yet) instead of the expected status codes.

- [ ] **Step 3: Implement the route**

In `backend/src/routes/prep.ts`, add this handler inside `createPrepRouter`, before the existing `router.post("/prep/:interviewId/message", ...)` handler:

```typescript
  router.get("/prep/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const session = await prisma.prepSessionHr.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(200).json({ messages: [], isClosed: false, profile: null });
      return;
    }

    const messages = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const profile = session.isClosed
      ? await prisma.companyProfile.findUnique({ where: { interviewId } })
      : null;

    res.status(200).json({
      messages: messages.map((item) => ({
        id: item.id,
        authorType: item.authorType,
        content: item.content,
        createdAt: item.createdAt,
      })),
      isClosed: session.isClosed,
      profile: profile
        ? {
            role: profile.role,
            requirements: profile.requirements,
            culture: profile.culture,
            expectations: profile.expectations,
          }
        : null,
    });
  });

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace backend run test`
Expected: PASS — all `prep.test.ts` tests green, including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "feat: add GET /api/prep/:interviewId to load chat state"
```

---

### Task 3: `POST /api/prep/:interviewId/finish` — generate profile and close session

**Files:**
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/prep.test.ts`

- [ ] **Step 1: Write failing tests**

Extend `makeFakePrisma` in `backend/src/routes/prep.test.ts` (from Task 2) by adding `update` to `prepSessionHr` and `upsert` to `companyProfile`:

```typescript
    prepSessionHr: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        sessions.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { interviewId: string };
        create: { interviewId: string };
      }) => {
        let session = sessions.find((item) => item.interviewId === where.interviewId);
        if (!session) {
          session = { id: `session_${++counter}`, interviewId: create.interviewId, isClosed: false };
          sessions.push(session);
        }
        return session;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { isClosed: boolean };
      }) => {
        const session = sessions.find((item) => item.id === where.id);
        if (!session) throw new Error("session not found");
        Object.assign(session, data);
        return session;
      },
    },
```

```typescript
    companyProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { interviewId: string };
        create: Omit<FakeProfile, "id">;
        update: Omit<FakeProfile, "id" | "interviewId">;
      }) => {
        let profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) {
          profile = { id: `profile_${++counter}`, ...create };
          profiles.push(profile);
        } else {
          Object.assign(profile, create);
        }
        return profile;
      },
    },
```

Add tests after the `GET /prep/:interviewId` tests from Task 2:

```typescript
test("POST /prep/:interviewId/finish extracts profile, saves it, and closes the session", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    { id: "m1", sessionId: "session_1", authorType: "HUMAN_HR", content: "Middle Backend Developer", createdAt: new Date(1) },
    { id: "m2", sessionId: "session_1", authorType: "AGENT_COMPANY", content: "Дякую.\nREADY:true", createdAt: new Date(2) }
  );
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return JSON.stringify({
        role: "Middle Backend Developer",
        requirements: ["Node.js"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
      });
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.role, "Middle Backend Developer");
    assert.equal(fakePrisma.__sessions[0].isClosed, true);
    assert.equal(fakePrisma.__profiles.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 404 when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 409 when session is already closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 502 when LLM returns invalid JSON", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не json"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 502);
    assert.equal(fakePrisma.__sessions[0].isClosed, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/finish returns 503 when LLM unavailable", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      throw new LlmUnavailableError("omlx server not reachable");
    },
  };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/finish`, { method: "POST" });
    assert.equal(response.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace backend run test`
Expected: FAIL — `POST /prep/:interviewId/finish` returns 404 for every case (route not registered yet).

- [ ] **Step 3: Implement the route**

In `backend/src/routes/prep.ts`, add the imports for the new agent functions (extend the existing import line):

```typescript
import {
  buildCompanyAgentMessages,
  buildProfileExtractionMessages,
  parseAgentReply,
  parseProfileExtraction,
} from "../agents/company-agent";
```

Add this handler in `createPrepRouter`, after the `GET /prep/:interviewId` handler from Task 2 and before `POST /prep/:interviewId/message`:

```typescript
  router.post("/prep/:interviewId/finish", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const session = await prisma.prepSessionHr.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(404).json({ error: "Prep session not found" });
      return;
    }

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    const history = await prisma.prepMessageHr.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildProfileExtractionMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[prep:finish:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[prep:finish:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[prep:finish:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let extracted;
    try {
      extracted = parseProfileExtraction(rawReply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] failed to parse profile extraction:", detail);
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    let profile;
    try {
      profile = await prisma.companyProfile.upsert({
        where: { interviewId },
        update: {
          role: extracted.role,
          requirements: extracted.requirements,
          culture: extracted.culture,
          expectations: extracted.expectations,
        },
        create: {
          interviewId,
          role: extracted.role,
          requirements: extracted.requirements,
          culture: extracted.culture,
          expectations: extracted.expectations,
        },
      });
      await prisma.prepSessionHr.update({ where: { id: session.id }, data: { isClosed: true } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:finish] failed to persist profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: {
        role: profile.role,
        requirements: profile.requirements,
        culture: profile.culture,
        expectations: profile.expectations,
      },
    });
  });

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace backend run test`
Expected: PASS — all `prep.test.ts` tests green, including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "feat: add POST /api/prep/:interviewId/finish to generate company profile"
```

---

### Task 4: `DELETE /api/prep/:interviewId` — reset chat

**Files:**
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/prep.test.ts`

- [ ] **Step 1: Write failing tests**

Extend `makeFakePrisma` in `backend/src/routes/prep.test.ts` by adding `deleteMany` to `prepMessageHr`, `delete` to `prepSessionHr`, and `deleteMany` to `companyProfile`:

```typescript
    prepMessageHr: {
      create: async ({
        data,
      }: {
        data: { sessionId: string; authorType: "HUMAN_HR" | "AGENT_COMPANY"; content: string };
      }) => {
        const message: FakeMessage = { id: `message_${++counter}`, createdAt: new Date(), ...data };
        messages.push(message);
        return message;
      },
      findMany: async ({ where }: { where: { sessionId: string } }) =>
        messages
          .filter((item) => item.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      deleteMany: async ({ where }: { where: { sessionId: string } }) => {
        const remaining = messages.filter((item) => item.sessionId !== where.sessionId);
        const removedCount = messages.length - remaining.length;
        messages.length = 0;
        messages.push(...remaining);
        return { count: removedCount };
      },
    },
```

```typescript
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { isClosed: boolean };
      }) => {
        const session = sessions.find((item) => item.id === where.id);
        if (!session) throw new Error("session not found");
        Object.assign(session, data);
        return session;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = sessions.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("session not found");
        const [removed] = sessions.splice(index, 1);
        return removed;
      },
```

(add `delete` right after `update` inside `prepSessionHr`)

```typescript
      upsert: async ({
        where,
        create,
      }: {
        where: { interviewId: string };
        create: Omit<FakeProfile, "id">;
        update: Omit<FakeProfile, "id" | "interviewId">;
      }) => {
        let profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) {
          profile = { id: `profile_${++counter}`, ...create };
          profiles.push(profile);
        } else {
          Object.assign(profile, create);
        }
        return profile;
      },
      deleteMany: async ({ where }: { where: { interviewId: string } }) => {
        const remaining = profiles.filter((item) => item.interviewId !== where.interviewId);
        const removedCount = profiles.length - remaining.length;
        profiles.length = 0;
        profiles.push(...remaining);
        return { count: removedCount };
      },
```

(add `deleteMany` right after `upsert` inside `companyProfile`)

Add tests after the `finish` tests from Task 3:

```typescript
test("DELETE /prep/:interviewId removes session, messages, and profile", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["не вказано"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
      },
    ],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "AGENT_COMPANY",
    content: "Привіт!",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(fakePrisma.__sessions.length, 0);
    assert.equal(fakePrisma.__messages.length, 0);
    assert.equal(fakePrisma.__profiles.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /prep/:interviewId succeeds even when no session exists yet", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_1" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /prep/:interviewId returns 403 when interview belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_other" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1`, { method: "DELETE" });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace backend run test`
Expected: FAIL — `DELETE /prep/:interviewId` returns 404 (no such route registered yet).

- [ ] **Step 3: Implement the route**

Add this handler in `backend/src/routes/prep.ts`, after the `finish` handler from Task 3:

```typescript
  router.delete("/prep/:interviewId", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    if (interview.hrUserId !== req.user?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      const session = await prisma.prepSessionHr.findUnique({ where: { interviewId } });
      if (session) {
        await prisma.prepMessageHr.deleteMany({ where: { sessionId: session.id } });
        await prisma.prepSessionHr.delete({ where: { id: session.id } });
      }
      await prisma.companyProfile.deleteMany({ where: { interviewId } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:delete] failed to reset prep chat:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({ ok: true });
  });

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace backend run test`
Expected: PASS — all `prep.test.ts` tests green, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "feat: add DELETE /api/prep/:interviewId to reset chat"
```

---

### Task 5: `GET /api/interviews/mine` — navigation endpoint

**Files:**
- Create: `backend/src/routes/interviews.ts`
- Create: `backend/src/routes/interviews.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing tests**

Create `backend/src/routes/interviews.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createInterviewsRouter } from "./interviews";

type FakeInterview = { id: string; hrUserId: string; joinCode: string; status: string; createdAt: Date };

function makeFakePrisma(interviews: FakeInterview[] = []) {
  return {
    interview: {
      findMany: async ({ where }: { where: { hrUserId: string } }) =>
        interviews
          .filter((item) => item.hrUserId === where.hrUserId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

test("GET /interviews/mine returns interviews for the current HR only, newest first", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "i1", hrUserId: "hr_1", joinCode: "AAAAAA", status: "DRAFT", createdAt: new Date(1) },
    { id: "i2", hrUserId: "hr_other", joinCode: "BBBBBB", status: "DRAFT", createdAt: new Date(2) },
    { id: "i3", hrUserId: "hr_1", joinCode: "CCCCCC", status: "DRAFT", createdAt: new Date(3) },
  ]);

  const app = express();
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createInterviewsRouter(() => fakePrisma as never));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviews.length, 2);
    assert.equal(body.interviews[0].id, "i3");
    assert.equal(body.interviews[1].id, "i1");
    assert.deepEqual(Object.keys(body.interviews[0]).sort(), ["id", "joinCode", "status"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /interviews/mine returns empty array when HR has no interviews", async () => {
  const fakePrisma = makeFakePrisma([]);

  const app = express();
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createInterviewsRouter(() => fakePrisma as never));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/interviews/mine`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.interviews, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/routes/interviews.test.ts` (from `backend/`)
Expected: FAIL — cannot find module `./interviews`.

- [ ] **Step 3: Implement the route**

Create `backend/src/routes/interviews.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

export function createInterviewsRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/interviews/mine", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const interviews = await prisma.interview.findMany({
      where: { hrUserId: req.user?.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      interviews: interviews.map((item) => ({
        id: item.id,
        joinCode: item.joinCode,
        status: item.status,
      })),
    });
  });

  return router;
}
```

- [ ] **Step 4: Wire into server and test runner**

In `backend/src/server.ts`, add the import and mount line:

```typescript
import { createInterviewsRouter } from "./routes/interviews";
```

```typescript
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, () => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createInterviewsRouter(() => prisma));
```

In `backend/package.json`, add `src/routes/interviews.test.ts` to the `test` script (append at the end of the existing space-separated list):

```json
"test": "node --import tsx --test src/db/healthcheck.test.js src/seed/hr-user.test.js src/db/seed-check.test.ts src/routes/health.test.ts src/llm/omlx.provider.test.ts src/llm/openai.provider.test.ts src/llm/factory.test.ts src/routes/llm.test.ts src/auth/password.test.ts src/auth/jwt.test.ts src/auth/middleware.test.ts src/routes/auth.test.ts src/agents/company-agent.test.ts src/routes/prep.test.ts src/seed/hr-interview.test.js src/routes/interviews.test.ts",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace backend run test`
Expected: PASS — all backend tests green, including the 2 new `interviews.test.ts` tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts backend/src/server.ts backend/package.json
git commit -m "feat: add GET /api/interviews/mine navigation endpoint"
```

---

### Task 6: Frontend API clients

**Files:**
- Create: `frontend/src/api/prep.ts`
- Create: `frontend/src/api/interviews.ts`

No test framework exists on the frontend (only `vue-tsc` for type-checking) — verification for this task is `npm --workspace frontend run lint` passing.

- [ ] **Step 1: Create `frontend/src/api/prep.ts`**

```typescript
import { fetchWithAuth } from "./client";

export type PrepAuthorType = "HUMAN_HR" | "AGENT_COMPANY";

export type PrepMessage = {
  id: string;
  authorType: PrepAuthorType;
  content: string;
  createdAt: string;
};

export type CompanyProfile = {
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
};

export type PrepState = {
  messages: PrepMessage[];
  isClosed: boolean;
  profile: CompanyProfile | null;
};

export type SendMessageResponse = {
  message: string;
  readyForConfirmation: boolean;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore parse errors
  }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

export async function fetchPrepState(interviewId: string): Promise<PrepState> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити анкету");
  }
  return response.json() as Promise<PrepState>;
}

export async function sendPrepMessage(
  interviewId: string,
  message?: string
): Promise<SendMessageResponse> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}/message`, {
    method: "POST",
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати повідомлення");
  }
  return response.json() as Promise<SendMessageResponse>;
}

export async function finishPrepChat(interviewId: string): Promise<{ profile: CompanyProfile }> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}/finish`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити чат");
  }
  return response.json() as Promise<{ profile: CompanyProfile }>;
}

export async function deletePrepChat(interviewId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити чат");
  }
}
```

- [ ] **Step 2: Create `frontend/src/api/interviews.ts`**

```typescript
import { fetchWithAuth } from "./client";

export type InterviewSummary = {
  id: string;
  joinCode: string;
  status: string;
};

export async function fetchMyInterviews(): Promise<InterviewSummary[]> {
  const response = await fetchWithAuth("/api/interviews/mine");
  if (!response.ok) {
    throw new Error("Не вдалося завантажити список співбесід");
  }
  const body = (await response.json()) as { interviews: InterviewSummary[] };
  return body.interviews;
}
```

- [ ] **Step 3: Run type-check**

Run: `npm --workspace frontend run lint`
Expected: PASS — no TypeScript errors (these files are not yet imported anywhere, so this just validates syntax/types in isolation).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/prep.ts frontend/src/api/interviews.ts
git commit -m "feat: add frontend API clients for prep chat and interviews"
```

---

### Task 7: `CompanyPrepView.vue` — the chat page

**Files:**
- Create: `frontend/src/views/CompanyPrepView.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: Create the view**

Create `frontend/src/views/CompanyPrepView.vue`:

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  deletePrepChat,
  fetchPrepState,
  finishPrepChat,
  sendPrepMessage,
  type CompanyProfile,
  type PrepMessage,
} from "../api/prep";

const route = useRoute();
const router = useRouter();
const interviewId = computed(() => String(route.params.interviewId));

const loadState = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref<string | null>(null);

const messages = ref<PrepMessage[]>([]);
const isClosed = ref(false);
const profile = ref<CompanyProfile | null>(null);
const viewingHistory = ref(false);

const input = ref("");
const sending = ref(false);
const lastReadyForConfirmation = ref(false);
const messagesEl = ref<HTMLElement | null>(null);

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = messagesEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function loadPrepState(): Promise<void> {
  loadState.value = "loading";
  errorMessage.value = null;
  try {
    const state = await fetchPrepState(interviewId.value);
    messages.value = state.messages;
    isClosed.value = state.isClosed;
    profile.value = state.profile;
    viewingHistory.value = false;
    loadState.value = "ready";

    if (!state.isClosed && state.messages.length === 0) {
      await triggerGreeting();
    }
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завантажити анкету";
  }
}

async function triggerGreeting(): Promise<void> {
  sending.value = true;
  try {
    const response = await sendPrepMessage(interviewId.value);
    messages.value.push({
      id: `local_${Date.now()}`,
      authorType: "AGENT_COMPANY",
      content: response.message,
      createdAt: new Date().toISOString(),
    });
    lastReadyForConfirmation.value = response.readyForConfirmation;
    await scrollToBottom();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
  } finally {
    sending.value = false;
  }
}

async function sendMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || sending.value) return;

  errorMessage.value = null;
  input.value = "";
  messages.value.push({
    id: `local_${Date.now()}`,
    authorType: "HUMAN_HR",
    content: text,
    createdAt: new Date().toISOString(),
  });
  await scrollToBottom();

  sending.value = true;
  try {
    const response = await sendPrepMessage(interviewId.value, text);
    messages.value.push({
      id: `local_${Date.now()}_reply`,
      authorType: "AGENT_COMPANY",
      content: response.message,
      createdAt: new Date().toISOString(),
    });
    lastReadyForConfirmation.value = response.readyForConfirmation;
    await scrollToBottom();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
  } finally {
    sending.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
}

async function onDeleteChat(): Promise<void> {
  if (!window.confirm("Видалити всю історію чату? Цю дію не можна скасувати.")) return;

  errorMessage.value = null;
  try {
    await deletePrepChat(interviewId.value);
    messages.value = [];
    isClosed.value = false;
    profile.value = null;
    viewingHistory.value = false;
    lastReadyForConfirmation.value = false;
    await triggerGreeting();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося видалити чат";
  }
}

async function onFinishChat(): Promise<void> {
  if (!lastReadyForConfirmation.value) {
    const proceed = window.confirm("Даних може бути недостатньо. Все одно завершити й сформувати профіль?");
    if (!proceed) return;
  }

  errorMessage.value = null;
  sending.value = true;
  try {
    const response = await finishPrepChat(interviewId.value);
    profile.value = response.profile;
    isClosed.value = true;
    viewingHistory.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завершити чат";
  } finally {
    sending.value = false;
  }
}

function backToChat(): void {
  viewingHistory.value = true;
}

function backToProfile(): void {
  viewingHistory.value = false;
}

function goHome(): void {
  router.push({ name: "home" });
}

onMounted(loadPrepState);
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>Анкета компанії</h1>
      <button type="button" class="btn-secondary" @click="goHome">← На головну</button>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else>
      <section v-if="isClosed && profile && !viewingHistory" class="profile-view">
        <h2>Зібраний профіль вакансії</h2>
        <dl>
          <dt>Посада</dt>
          <dd>{{ profile.role }}</dd>
          <dt>Вимоги</dt>
          <dd><ul><li v-for="(item, i) in profile.requirements" :key="i">{{ item }}</li></ul></dd>
          <dt>Культура</dt>
          <dd><ul><li v-for="(item, i) in profile.culture" :key="i">{{ item }}</li></ul></dd>
          <dt>Очікування</dt>
          <dd><ul><li v-for="(item, i) in profile.expectations" :key="i">{{ item }}</li></ul></dd>
        </dl>
        <div class="actions">
          <button type="button" class="btn-secondary" @click="backToChat">← Назад до чату</button>
          <button type="button" class="btn-secondary" @click="onDeleteChat">Видалити чат</button>
        </div>
      </section>

      <section v-else class="chat-view">
        <div class="chat-header">
          <h2>Чат з Company Agent</h2>
          <div class="chat-actions">
            <button type="button" class="btn-secondary" :disabled="sending" @click="onDeleteChat">
              Видалити чат
            </button>
            <button
              v-if="!isClosed"
              type="button"
              class="btn-primary"
              :disabled="sending"
              @click="onFinishChat"
            >
              Завершити чат
            </button>
            <button v-else type="button" class="btn-secondary" @click="backToProfile">
              Показати профіль
            </button>
          </div>
        </div>

        <div ref="messagesEl" class="messages" role="log" aria-live="polite">
          <div
            v-for="message in messages"
            :key="message.id"
            class="message"
            :class="message.authorType === 'HUMAN_HR' ? 'user' : 'assistant'"
          >
            <span class="message-label">{{ message.authorType === "HUMAN_HR" ? "Ви" : "Агент" }}</span>
            <p class="message-text">{{ message.content }}</p>
          </div>
          <p v-if="sending" class="thinking">Думаю…</p>
        </div>

        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>

        <form v-if="!isClosed" class="composer" @submit.prevent="sendMessage">
          <textarea
            v-model="input"
            class="composer-input"
            rows="2"
            placeholder="Напишіть відповідь…"
            :disabled="sending"
            @keydown="onKeydown"
          />
          <button type="submit" class="btn-primary" :disabled="sending || !input.trim()">
            Надіслати
          </button>
        </form>
      </section>
    </template>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  gap: 0.5rem;
}
.chat-actions {
  display: flex;
  gap: 0.5rem;
}
.messages {
  max-height: 24rem;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: #fafafa;
  margin-bottom: 0.75rem;
}
.message {
  margin-bottom: 0.75rem;
  max-width: 85%;
}
.message.user {
  margin-left: auto;
  text-align: right;
}
.message.assistant {
  margin-right: auto;
  text-align: left;
}
.message-label {
  display: block;
  font-size: 0.75rem;
  color: #666;
  margin-bottom: 0.25rem;
}
.message-text {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  white-space: pre-wrap;
  word-break: break-word;
  display: inline-block;
}
.message.user .message-text {
  background: #dbeafe;
  color: #1e3a5f;
}
.message.assistant .message-text {
  background: #e5e7eb;
  color: #1f2937;
}
.thinking {
  margin: 0;
  color: #666;
  font-size: 0.875rem;
  font-style: italic;
}
.error-banner {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fde8e8;
  color: #b00020;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.composer {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}
.composer-input {
  flex: 1;
  font-family: inherit;
  font-size: 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  resize: vertical;
  min-height: 2.5rem;
}
.btn-primary,
.btn-secondary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.btn-primary {
  background: #16a34a;
  color: #fff;
}
.btn-primary:disabled {
  background: #86efac;
  cursor: not-allowed;
}
.btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.profile-view dl {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.5rem 1rem;
  margin: 1rem 0;
}
.profile-view dt {
  font-weight: 600;
  color: #374151;
}
.profile-view dd {
  margin: 0;
}
.profile-view ul {
  margin: 0;
  padding-left: 1.25rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
}
</style>
```

- [ ] **Step 2: Add the route**

In `frontend/src/router/index.ts`, add the import and route entry:

```typescript
import CompanyPrepView from "../views/CompanyPrepView.vue";
```

```typescript
    { path: "/", name: "home", component: HomeView, meta: { requiresAuth: true } },
    {
      path: "/prep/:interviewId",
      name: "company-prep",
      component: CompanyPrepView,
      meta: { requiresAuth: true },
    },
```

- [ ] **Step 3: Run type-check**

Run: `npm --workspace frontend run lint`
Expected: PASS — no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/CompanyPrepView.vue frontend/src/router/index.ts
git commit -m "feat: add Company Prep chat page with delete/finish actions"
```

---

### Task 8: Navigation from `HomeView.vue`

**Files:**
- Modify: `frontend/src/views/HomeView.vue`

- [ ] **Step 1: Add the navigation button**

In `frontend/src/views/HomeView.vue`, add the import:

```typescript
import { fetchMyInterviews } from "../api/interviews";
```

Add a new ref and handler function inside `<script setup>` (near the other refs/functions):

```typescript
const prepNavError = ref<string | null>(null);

async function goToCompanyPrep(): Promise<void> {
  prepNavError.value = null;
  try {
    const interviews = await fetchMyInterviews();
    if (interviews.length === 0) {
      prepNavError.value = "Спочатку створіть співбесіду.";
      return;
    }
    router.push({ name: "company-prep", params: { interviewId: interviews[0].id } });
  } catch {
    prepNavError.value = "Не вдалося завантажити список співбесід.";
  }
}
```

In the `<template>`, add the button and error message right after the `<ul class="status-list">` block and before `<ChatPanel />`:

```html
      <div class="prep-nav">
        <button type="button" class="btn-primary" @click="goToCompanyPrep">Анкета компанії</button>
        <p v-if="prepNavError" class="fail">{{ prepNavError }}</p>
      </div>

```

Add a small style block for the new button (append inside the existing `<style scoped>` block):

```css
.prep-nav {
  margin: 1rem 0;
}
.btn-primary {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}
```

- [ ] **Step 2: Run type-check**

Run: `npm --workspace frontend run lint`
Expected: PASS — no TypeScript errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`

1. Log in as `hr@test.com` / `123456` on [http://localhost:5173](http://localhost:5173).
2. Click «Анкета компанії» → should navigate to `/prep/<interviewId>` and immediately show the agent's greeting.
3. Exchange a few messages.
4. Click «Видалити чат», confirm → chat clears and a fresh greeting appears.
5. Exchange a few messages again, then click «Завершити чат» → if not enough data yet, a confirm dialog appears; confirm it → the profile view replaces the chat.
6. Click «← Назад до чату» → read-only history is shown (no input, no send button, action buttons still present).
7. Click «Видалити чат» again from the profile or history view → full reset works from there too.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/HomeView.vue
git commit -m "feat: add navigation to Company Prep chat from home page"
```

---

### Task 9: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Day 5 section**

In `README.md`, find the "День 5 — Анкета HR в браузері" section. Replace its `Definition of Done` block:

```markdown
**Definition of Done:**
- [ ] Демонстрація: HR проходить анкету в браузері, як звичайний месенджер
- [ ] Сценарій: надіслати повідомлення → воно з’являється в UI → приходить відповідь агента; оновлення сторінки показує історію
- [ ] Збірка: `npm run build` проходить
- [ ] README: як відкрити анкету HR у UI, маршрут сторінки
```

with:

```markdown
**Definition of Done:**
- [x] Демонстрація: HR проходить анкету в браузері, як звичайний месенджер
- [x] Сценарій: надіслати повідомлення → воно з’являється в UI → приходить відповідь агента; оновлення сторінки показує історію
- [x] Збірка: `npm run build` проходить
- [x] README: як відкрити анкету HR у UI, маршрут сторінки
```

Then insert this new subsection immediately after that DoD block (before the `---` separator that precedes "День 6"):

```markdown
### Company Prep Chat UI Quick Start (Day 5)

**1. Увійти і відкрити анкету:**

```bash
npm run dev
```

Відкрий [http://localhost:5173](http://localhost:5173) → логін `hr@test.com` / `123456` → на головній сторінці натисни кнопку **«Анкета компанії»**. Тебе перенесе на `/prep/:interviewId` (перша співбесіда поточного HR), і агент одразу привітається першим повідомленням.

**2. Кнопки в чаті:**

- **«Видалити чат»** — видаляє всю історію діалогу і профіль (якщо вже сформований), і починає розмову заново. Доступна завжди, навіть після завершення.
- **«Завершити чат»** — аналізує весь діалог і формує структурований профіль вакансії (посада, вимоги, культура, очікування); закриває чат для подальших повідомлень. Якщо агент ще не позначив розмову як достатню, попросить підтвердження перед завершенням.

**3. Endpoints (для перевірки curl/Postman):**

```bash
TOKEN="<token-from-login>"
INTERVIEW_ID="<interviewId-from-seed>"
```

Стан анкети:

```bash
curl "http://localhost:3000/api/prep/$INTERVIEW_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Завершити чат і отримати профіль:

```bash
curl -X POST "http://localhost:3000/api/prep/$INTERVIEW_ID/finish" \
  -H "Authorization: Bearer $TOKEN"
```

Очікувана відповідь:

```json
{ "profile": { "role": "...", "requirements": ["..."], "culture": ["..."], "expectations": ["..."] } }
```

Видалити чат (повний рестарт):

```bash
curl -X DELETE "http://localhost:3000/api/prep/$INTERVIEW_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Список своїх співбесід (для навігації):

```bash
curl "http://localhost:3000/api/interviews/mine" \
  -H "Authorization: Bearer $TOKEN"
```
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS — both `backend` and `frontend` build without errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Day 5 Company Prep Chat UI quick start"
```

---

## Self-Review Notes (for the implementer)

- Every new endpoint follows the existing `prep.ts` error-handling convention: 404/403 ownership checks first, then a separate `try/catch` for LLM calls (503/502) and another separate `try/catch` for DB writes (500) — never mixed.
- `DELETE /api/prep/:interviewId` is intentionally idempotent (200 even with nothing to delete) so the frontend never needs to check state before calling it.
- `POST /api/prep/:interviewId/finish` never sets `confirmedAt` on `CompanyProfile` — that remains reserved for Day 7's explicit confirmation step.
- `buildProfileExtractionMessages` sends the whole transcript as a single `user`-role message (not a replayed multi-turn conversation) so it works uniformly across all three `LlmProvider` implementations (`omlx`, `gemini`, `openai`) — the Gemini provider specifically requires the last message to have `role: "user"`.

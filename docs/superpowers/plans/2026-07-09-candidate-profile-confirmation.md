# Candidate Profile Confirmation (Day 13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Після анкети кандидат бачить структурований AI-профіль (`experience`, `skills`, `goals`, `summary`) і підтверджує його кнопкою «Підтвердити профіль».

**Architecture:** Дзеркало HR-флоу: `POST /api/candidate-prep/:interviewId/finish` викликає LLM extraction і зберігає `CandidateProfile`; `POST /confirm` встановлює `confirmedAt` без зміни `Interview.status`. Frontend розширює `CandidatePrepView.vue` за патерном `VacancyPrepView.vue`.

**Tech Stack:** Express + Prisma (backend), Vue 3 `<script setup>` + TypeScript (frontend), Node's built-in `node:test`/`assert` test runner.

**Spec:** `docs/superpowers/specs/2026-07-09-candidate-profile-confirmation-design.md`

---

## File Structure (before tasks)

### Create

- `backend/src/agents/prompts/candidate-profile-extraction.uk.ts` — system prompt для LLM extraction

### Modify

- `backend/src/agents/candidate-agent.ts` — `parseCandidateProfileExtraction`, `buildCandidateProfileExtractionMessages`
- `backend/src/agents/candidate-agent.test.ts` — unit-тести парсера
- `backend/src/routes/candidate-prep.ts` — `POST /:interviewId/finish`, `POST /:interviewId/confirm`
- `backend/src/routes/candidate-prep.test.ts` — integration-тести finish/confirm
- `frontend/src/api/candidate-prep.ts` — типи + `finishCandidatePrepChat`, `confirmCandidatePrepProfile`
- `frontend/src/views/CandidatePrepView.vue` — profile view, finish/confirm UI
- `README.md` — Day 13 Quick Start, JSON-структура, curl

### Verification

- `npm --workspace backend test`
- `npm run build`

---

### Task 1: Candidate profile extraction prompt and parser

**Files:**
- Create: `backend/src/agents/prompts/candidate-profile-extraction.uk.ts`
- Modify: `backend/src/agents/candidate-agent.ts`
- Modify: `backend/src/agents/candidate-agent.test.ts`

- [ ] **Step 1: Create extraction prompt**

Create `backend/src/agents/prompts/candidate-profile-extraction.uk.ts`:

```ts
export const CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK = `Ти отримуєш повну стенограму діалогу між кандидатом і AI-агентом, який збирав інформацію для профілю перед співбесідою.

Твоє завдання — проаналізувати діалог і повернути СТРОГО валідний JSON без жодного тексту навколо (без пояснень, без markdown, без код-блоків) у такому форматі:

{"experience": ["пункт 1", "пункт 2"], "skills": {"strong": ["навичка 1"], "growth": ["зона росту 1"]}, "goals": ["ціль 1"], "summary": "короткий опис у 1-3 речення"}

Правила:
- "experience" — масив коротких рядків про досвід роботи, ролі, проєкти, технології.
- "skills.strong" — сильні сторони та конкретні навички з діалогу.
- "skills.growth" — зони росту / слабкі сторони (конструктивно).
- "goals" — кар'єрні цілі та очікування від нової ролі.
- "summary" — один абзац українською (1-3 речення), узагальнює профіль кандидата.
- Якщо про тему в діалозі не було сказано нічого конкретного, для масивів поверни ["не вказано"]; для summary — короткий опис на основі наявних даних.
- Не вигадуй фактів, яких немає в діалозі.
- Відповідь має містити лише JSON, без жодних інших символів до чи після нього.`;
```

- [ ] **Step 2: Write failing parser tests**

Append to `backend/src/agents/candidate-agent.test.ts`:

```ts
import {
  buildCandidateAgentMessages,
  parseCandidateProfileExtraction,
  CandidateProfileExtractionError,
} from "./candidate-agent";

const VALID_EXTRACTION = JSON.stringify({
  experience: ["3 роки backend у FinTech"],
  skills: { strong: ["TypeScript", "PostgreSQL"], growth: ["публічні виступи"] },
  goals: ["перейти на senior"],
  summary: "Backend-розробник з 3 роками досвіду.",
});

test("parseCandidateProfileExtraction parses plain JSON", () => {
  const result = parseCandidateProfileExtraction(VALID_EXTRACTION);
  assert.equal(result.experience[0], "3 роки backend у FinTech");
  assert.deepEqual(result.skills.strong, ["TypeScript", "PostgreSQL"]);
  assert.deepEqual(result.skills.growth, ["публічні виступи"]);
  assert.equal(result.goals[0], "перейти на senior");
  assert.equal(result.summary, "Backend-розробник з 3 роками досвіду.");
});

test("parseCandidateProfileExtraction strips markdown code fences", () => {
  const raw = "```json\n" + VALID_EXTRACTION + "\n```";
  const result = parseCandidateProfileExtraction(raw);
  assert.equal(result.summary, "Backend-розробник з 3 роками досвіду.");
});

test("parseCandidateProfileExtraction throws on invalid JSON", () => {
  assert.throws(
    () => parseCandidateProfileExtraction("не json"),
    CandidateProfileExtractionError
  );
});

test("parseCandidateProfileExtraction throws when skills.strong is missing", () => {
  const raw = JSON.stringify({
    experience: ["досвід"],
    skills: { growth: ["росту"] },
    goals: ["ціль"],
    summary: "опис",
  });
  assert.throws(() => parseCandidateProfileExtraction(raw), CandidateProfileExtractionError);
});

test("parseCandidateProfileExtraction throws when summary is empty", () => {
  const raw = JSON.stringify({
    experience: ["досвід"],
    skills: { strong: ["TS"], growth: ["росту"] },
    goals: ["ціль"],
    summary: "   ",
  });
  assert.throws(() => parseCandidateProfileExtraction(raw), CandidateProfileExtractionError);
});
```

Update the existing import at the top of `candidate-agent.test.ts` to include the new exports (merge with existing `buildCandidateAgentMessages` import).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --workspace backend test -- src/agents/candidate-agent.test.ts`

Expected: FAIL — `parseCandidateProfileExtraction is not exported` or `CandidateProfileExtractionError is not defined`

- [ ] **Step 4: Implement parser and extraction message builder**

Append to `backend/src/agents/candidate-agent.ts`:

```ts
import { CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/candidate-profile-extraction.uk";

export type ExtractedCandidateProfile = {
  experience: string[];
  skills: { strong: string[]; growth: string[] };
  goals: string[];
  summary: string;
};

export class CandidateProfileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateProfileExtractionError";
  }
}

function stripCodeFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CandidateProfileExtractionError(`missing or invalid field: ${field}`);
  }
  return value.map((item) => String(item));
}

function toSkillsObject(value: unknown): { strong: string[]; growth: string[] } {
  if (typeof value !== "object" || value === null) {
    throw new CandidateProfileExtractionError("missing or invalid field: skills");
  }
  const { strong, growth } = value as Record<string, unknown>;
  return {
    strong: toStringArray(strong, "skills.strong"),
    growth: toStringArray(growth, "skills.growth"),
  };
}

export function parseCandidateProfileExtraction(rawText: string): ExtractedCandidateProfile {
  const withoutFences = stripCodeFences(rawText.trim());

  let data: unknown;
  try {
    data = JSON.parse(withoutFences);
  } catch {
    throw new CandidateProfileExtractionError("LLM returned invalid JSON for profile extraction");
  }

  if (typeof data !== "object" || data === null) {
    throw new CandidateProfileExtractionError("LLM response is not a JSON object");
  }

  const { experience, skills, goals, summary } = data as Record<string, unknown>;

  if (typeof summary !== "string" || !summary.trim()) {
    throw new CandidateProfileExtractionError("missing or invalid field: summary");
  }

  return {
    experience: toStringArray(experience, "experience"),
    skills: toSkillsObject(skills),
    goals: toStringArray(goals, "goals"),
    summary: summary.trim(),
  };
}

export function buildCandidateProfileExtractionMessages(
  history: CandidatePrepHistoryItem[]
): ChatMessage[] {
  const transcript = history
    .map((item) =>
      `${item.authorType === "HUMAN_CANDIDATE" ? "Кандидат" : "Агент"}: ${item.content}`
    )
    .join("\n");

  return [
    { role: "system", content: CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK },
    { role: "user", content: transcript || "(розмова порожня)" },
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace backend test -- src/agents/candidate-agent.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/prompts/candidate-profile-extraction.uk.ts \
  backend/src/agents/candidate-agent.ts \
  backend/src/agents/candidate-agent.test.ts
git commit -m "feat(backend): add candidate profile extraction parser"
```

---

### Task 2: POST /candidate-prep/:interviewId/finish

**Files:**
- Modify: `backend/src/routes/candidate-prep.ts`
- Modify: `backend/src/routes/candidate-prep.test.ts`

- [ ] **Step 1: Extend fake Prisma with upsert, update, and interview status**

In `backend/src/routes/candidate-prep.test.ts`, update `FakeInterview`:

```ts
type FakeInterview = {
  id: string;
  vacancyId: string;
  hrUserId: string;
  status?: string;
};
```

Add to `prepSessionCandidate` in `makeFakePrisma`:

```ts
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { isClosed?: boolean };
      }) => {
        const session = sessions.find((item) => item.id === where.id);
        if (!session) throw new Error("session not found");
        if (data.isClosed !== undefined) session.isClosed = data.isClosed;
        return session;
      },
```

Replace the `candidateProfile` block with:

```ts
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { interviewId: string };
        create: Omit<FakeProfile, "id" | "confirmedAt">;
        update: Omit<FakeProfile, "id" | "interviewId" | "confirmedAt">;
      }) => {
        let profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) {
          profile = { id: `profile_${++counter}`, confirmedAt: null, ...create };
          profiles.push(profile);
        } else {
          Object.assign(profile, update);
        }
        return profile;
      },
      update: async ({
        where,
        data,
      }: {
        where: { interviewId: string };
        data: { confirmedAt?: Date };
      }) => {
        const profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) throw new Error("profile not found");
        if (data.confirmedAt !== undefined) profile.confirmedAt = data.confirmedAt;
        return profile;
      },
      deleteMany: async ({ where }: { where: { interviewId: string } }) => {
        const remaining = profiles.filter((item) => item.interviewId !== where.interviewId);
        const removedCount = profiles.length - remaining.length;
        profiles.length = 0;
        profiles.push(...remaining);
        return { count: removedCount };
      },
    },
```

- [ ] **Step 2: Write failing finish tests**

Append to `backend/src/routes/candidate-prep.test.ts`:

```ts
const SAMPLE_PROFILE_JSON = JSON.stringify({
  experience: ["3 роки backend"],
  skills: { strong: ["TypeScript"], growth: ["people management"] },
  goals: ["senior role"],
  summary: "Backend-розробник з досвідом у fintech.",
});

test("POST /candidate-prep/:interviewId/finish extracts profile and closes session", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    {
      id: "m1",
      sessionId: "session_1",
      authorType: "HUMAN_CANDIDATE",
      content: "3 роки backend",
      createdAt: new Date(1),
    },
    {
      id: "m2",
      sessionId: "session_1",
      authorType: "AGENT_CANDIDATE",
      content: "Дякую!",
      createdAt: new Date(2),
    }
  );
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return SAMPLE_PROFILE_JSON;
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.profile.experience, ["3 роки backend"]);
    assert.deepEqual(body.profile.skills, { strong: ["TypeScript"], growth: ["people management"] });
    assert.deepEqual(body.profile.goals, ["senior role"]);
    assert.equal(body.profile.summary, "Backend-розробник з досвідом у fintech.");
    assert.equal(body.profile.confirmedAt, null);
    assert.equal(fakePrisma.__sessions[0].isClosed, true);
    assert.equal(fakePrisma.__profiles.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/finish returns 404 when no session exists", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return SAMPLE_PROFILE_JSON;
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Prep session not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/finish returns 409 when session already closed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return SAMPLE_PROFILE_JSON;
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Prep session closed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/finish returns 502 when LLM returns invalid JSON", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push({
    id: "m1",
    sessionId: "session_1",
    authorType: "HUMAN_CANDIDATE",
    content: "досвід",
    createdAt: new Date(1),
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не json";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/finish`, {
      method: "POST",
    });
    assert.equal(response.status, 502);
    assert.equal(fakePrisma.__profiles.length, 0);
    assert.equal(fakePrisma.__sessions[0].isClosed, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --workspace backend test -- src/routes/candidate-prep.test.ts`

Expected: FAIL — finish route returns 404 (not implemented)

- [ ] **Step 4: Implement finish handler**

Add imports at top of `backend/src/routes/candidate-prep.ts`:

```ts
import {
  buildCandidateProfileExtractionMessages,
  CandidateProfileExtractionError,
  parseCandidateProfileExtraction,
} from "../agents/candidate-agent";
import { LlmError, LlmUnavailableError } from "../llm/errors";
```

Add before `router.delete` (after the message handler):

```ts
  router.post("/:interviewId/finish", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const session = await prisma.prepSessionCandidate.findUnique({ where: { interviewId } });
    if (!session) {
      res.status(404).json({ error: "Prep session not found" });
      return;
    }

    if (session.isClosed) {
      res.status(409).json({ error: "Prep session closed" });
      return;
    }

    const history = await prisma.prepMessageCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    const llmMessages = buildCandidateProfileExtractionMessages(
      history.map((item) => ({ authorType: item.authorType, content: item.content }))
    );

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let rawReply: string;
    try {
      rawReply = await provider.complete(llmMessages);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[candidate-prep:finish:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[candidate-prep:finish:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[candidate-prep:finish:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    let extracted;
    try {
      extracted = parseCandidateProfileExtraction(rawReply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] failed to parse profile extraction:", detail);
      res.status(502).json({ error: "LLM unavailable", detail });
      return;
    }

    let profile;
    try {
      profile = await prisma.candidateProfile.upsert({
        where: { interviewId },
        update: {
          experience: extracted.experience,
          skills: extracted.skills,
          goals: extracted.goals,
          summary: extracted.summary,
        },
        create: {
          interviewId,
          experience: extracted.experience,
          skills: extracted.skills,
          goals: extracted.goals,
          summary: extracted.summary,
        },
      });
      await prisma.prepSessionCandidate.update({
        where: { id: session.id },
        data: { isClosed: true },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:finish] failed to persist profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: {
        experience: profile.experience,
        skills: profile.skills,
        goals: profile.goals,
        summary: profile.summary,
        confirmedAt: profile.confirmedAt,
      },
    });
  });
```

Note: `LlmError` and `LlmUnavailableError` are already imported in this file — do not duplicate the import line; merge with existing imports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace backend test -- src/routes/candidate-prep.test.ts`

Expected: PASS (all tests including existing Day 11 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/candidate-prep.ts backend/src/routes/candidate-prep.test.ts
git commit -m "feat(backend): add candidate prep finish endpoint"
```

---

### Task 3: POST /candidate-prep/:interviewId/confirm

**Files:**
- Modify: `backend/src/routes/candidate-prep.ts`
- Modify: `backend/src/routes/candidate-prep.test.ts`

- [ ] **Step 1: Write failing confirm tests**

Append to `backend/src/routes/candidate-prep.test.ts`:

```ts
test("POST /candidate-prep/:interviewId/confirm sets confirmedAt without changing interview status", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: ["3 роки backend"],
        skills: { strong: ["TypeScript"], growth: ["росту"] },
        goals: ["senior"],
        summary: "Backend dev",
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.notEqual(body.profile.confirmedAt, null);
    assert.equal(body.interviewStatus, "AWAITING_CANDIDATE");
    assert.equal(fakePrisma.__profiles[0].confirmedAt !== null, true);
    assert.equal(fakePrisma.__interviews[0].status, "AWAITING_CANDIDATE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/confirm returns 404 when profile does not exist", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, {
      method: "POST",
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Profile not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/confirm returns 409 when already confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", vacancyId: "vacancy_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        experience: ["досвід"],
        skills: { strong: ["TS"], growth: ["росту"] },
        goals: ["ціль"],
        summary: "summary",
        confirmedAt: new Date("2026-07-09T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "не має викликатись";
    },
  };

  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Profile already confirmed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace backend test -- src/routes/candidate-prep.test.ts`

Expected: FAIL — confirm route returns 404

- [ ] **Step 3: Implement confirm handler**

Add before `router.delete` in `backend/src/routes/candidate-prep.ts`:

```ts
  router.post("/:interviewId/confirm", async (req: Request, res: Response) => {
    const { interviewId } = req.params;
    const prisma = getPrisma();

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    const profile = await prisma.candidateProfile.findUnique({ where: { interviewId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (profile.confirmedAt) {
      res.status(409).json({ error: "Profile already confirmed" });
      return;
    }

    let updatedProfile;
    try {
      updatedProfile = await prisma.candidateProfile.update({
        where: { interviewId },
        data: { confirmedAt: new Date() },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[candidate-prep:confirm] failed to confirm profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: {
        experience: updatedProfile.experience,
        skills: updatedProfile.skills,
        goals: updatedProfile.goals,
        summary: updatedProfile.summary,
        confirmedAt: updatedProfile.confirmedAt,
      },
      interviewStatus: interview.status,
    });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace backend test -- src/routes/candidate-prep.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-prep.ts backend/src/routes/candidate-prep.test.ts
git commit -m "feat(backend): add candidate prep confirm endpoint"
```

---

### Task 4: Frontend API client — finish and confirm

**Files:**
- Modify: `frontend/src/api/candidate-prep.ts`

- [ ] **Step 1: Update types and add API functions**

Replace `CandidateProfilePreview` and add finish/confirm in `frontend/src/api/candidate-prep.ts`:

```ts
export type CandidateSkills = {
  strong: string[];
  growth: string[];
};

export type CandidateProfile = {
  experience: string[];
  skills: CandidateSkills;
  goals: string[];
  summary: string;
  confirmedAt: string | null;
};

export type CandidatePrepState = {
  messages: CandidatePrepMessage[];
  isClosed: boolean;
  profile: CandidateProfile | null;
};
```

Add at end of file:

```ts
export async function finishCandidatePrepChat(
  interviewId: string
): Promise<{ profile: CandidateProfile }> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}/finish`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завершити чат");
  }
  return response.json() as Promise<{ profile: CandidateProfile }>;
}

export async function confirmCandidatePrepProfile(
  interviewId: string
): Promise<{ profile: CandidateProfile; interviewStatus: string }> {
  const response = await fetchWithAuth(`/api/candidate-prep/${interviewId}/confirm`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося підтвердити профіль");
  }
  return response.json() as Promise<{ profile: CandidateProfile; interviewStatus: string }>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm --workspace frontend run lint`

Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/candidate-prep.ts
git commit -m "feat(frontend): add candidate prep finish and confirm API"
```

---

### Task 5: CandidatePrepView — profile screen and finish/confirm UI

**Files:**
- Modify: `frontend/src/views/CandidatePrepView.vue`

- [ ] **Step 1: Update script imports and refs**

Replace imports:

```ts
import {
  confirmCandidatePrepProfile,
  deleteCandidatePrepChat,
  fetchCandidatePrepState,
  finishCandidatePrepChat,
  sendCandidatePrepMessage,
  type CandidatePrepMessage,
  type CandidateProfile,
} from "../api/candidate-prep";
```

Add refs after existing refs:

```ts
const profile = ref<CandidateProfile | null>(null);
const viewingHistory = ref(false);
const confirming = ref(false);
```

- [ ] **Step 2: Update loadPrepState and onDeleteChat**

In `loadPrepState`, after `isClosed.value = state.isClosed;` add:

```ts
    profile.value = state.profile;
    viewingHistory.value = false;
```

Change greeting condition to:

```ts
    if (!state.isClosed && state.messages.length === 0) {
      await triggerGreeting();
    }
```

In `onDeleteChat`, after successful delete add:

```ts
    profile.value = null;
    viewingHistory.value = false;
```

- [ ] **Step 3: Add finish, confirm, and navigation handlers**

Add before `goHome`:

```ts
async function onFinishChat(): Promise<void> {
  if (!lastReadyForConfirmation.value) {
    const proceed = window.confirm("Даних може бути недостатньо. Все одно завершити й сформувати профіль?");
    if (!proceed) return;
  }

  errorMessage.value = null;
  sending.value = true;
  try {
    const response = await finishCandidatePrepChat(interviewId.value);
    profile.value = response.profile;
    isClosed.value = true;
    viewingHistory.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося завершити чат";
  } finally {
    sending.value = false;
  }
}

async function onConfirmProfile(): Promise<void> {
  if (
    !window.confirm(
      "Профіль буде зафіксовано. Подальше редагування стане неможливим. Підтвердити?"
    )
  ) {
    return;
  }

  errorMessage.value = null;
  confirming.value = true;
  try {
    const response = await confirmCandidatePrepProfile(interviewId.value);
    profile.value = response.profile;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося підтвердити профіль";
  } finally {
    confirming.value = false;
  }
}

function backToChat(): void {
  viewingHistory.value = true;
}

function backToProfile(): void {
  viewingHistory.value = false;
}
```

- [ ] **Step 4: Replace template with chat + profile views**

Replace the `<template>` block (keep header as-is) with the structure from `VacancyPrepView.vue`:

```vue
    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="error-banner">{{ errorMessage }}</p>

    <template v-else>
      <section v-if="isClosed && profile && !viewingHistory" class="profile-view">
        <h2>Зібраний профіль кандидата</h2>
        <dl>
          <dt>Досвід</dt>
          <dd><ul><li v-for="(item, i) in profile.experience" :key="i">{{ item }}</li></ul></dd>
          <dt>Сильні сторони</dt>
          <dd><ul><li v-for="(item, i) in profile.skills.strong" :key="i">{{ item }}</li></ul></dd>
          <dt>Зони росту</dt>
          <dd><ul><li v-for="(item, i) in profile.skills.growth" :key="i">{{ item }}</li></ul></dd>
          <dt>Цілі</dt>
          <dd><ul><li v-for="(item, i) in profile.goals" :key="i">{{ item }}</li></ul></dd>
          <dt>Короткий опис</dt>
          <dd>{{ profile.summary }}</dd>
        </dl>
        <div class="actions">
          <button type="button" class="btn-secondary" @click="backToChat">← Назад до чату</button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="!!profile.confirmedAt"
            :title="profile.confirmedAt ? 'Підтверджений профіль не можна видалити' : ''"
            @click="onDeleteChat"
          >
            Видалити чат
          </button>
          <button
            v-if="!profile.confirmedAt"
            type="button"
            class="btn-primary"
            :disabled="confirming"
            @click="onConfirmProfile"
          >
            Підтвердити профіль
          </button>
          <p v-else class="confirmed-banner">
            ✓ Підтверджено {{ new Date(profile.confirmedAt!).toLocaleString("uk-UA") }}
          </p>
        </div>
      </section>

      <section v-else class="chat-view">
        <div class="chat-header">
          <h2>Чат з Candidate Agent</h2>
          <div class="chat-actions">
            <button
              type="button"
              class="btn-secondary"
              :disabled="sending || !!profile?.confirmedAt"
              :title="profile?.confirmedAt ? 'Підтверджений профіль не можна видалити' : ''"
              @click="onDeleteChat"
            >
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
            <button v-else-if="profile" type="button" class="btn-secondary" @click="backToProfile">
              Показати профіль
            </button>
          </div>
        </div>

        <div ref="messagesEl" class="messages" role="log" aria-live="polite">
          <div
            v-for="message in messages"
            :key="message.id"
            class="message"
            :class="message.authorType === 'HUMAN_CANDIDATE' ? 'user' : 'assistant'"
          >
            <span class="message-label">
              {{ message.authorType === "HUMAN_CANDIDATE" ? "Ви" : "Агент" }}
            </span>
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
```

- [ ] **Step 5: Add profile-view CSS**

Append to `<style scoped>` (from `VacancyPrepView.vue`):

```css
.chat-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
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
  align-items: center;
  flex-wrap: wrap;
}
.confirmed-banner {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #dcfce7;
  color: #166534;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
}
```

Remove the old standalone `.closed-hint` block if no longer used.

- [ ] **Step 6: Verify build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/CandidatePrepView.vue
git commit -m "feat(frontend): add candidate profile review and confirm UI"
```

---

### Task 6: README Day 13 documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Mark Day 13 DoD checkboxes and add API rows**

In the `## День 13` section, mark Definition of Done items as documented (leave demo checkboxes unchecked until manual verification).

In `### Candidate Prep API` table, add:

```markdown
| `POST` | `/candidate-prep/:interviewId/finish` | Згенерувати профіль з історії чату |
| `POST` | `/candidate-prep/:interviewId/confirm` | Підтвердити профіль (`confirmedAt`) |
```

- [ ] **Step 2: Add CandidateProfile JSON example and curl**

After Day 12 Quick Start section, add:

````markdown
### Candidate Profile Quick Start (Day 13)

**Структура `CandidateProfile` JSON:**

```json
{
  "experience": ["3 роки backend у FinTech"],
  "skills": {
    "strong": ["TypeScript", "PostgreSQL"],
    "growth": ["публічні виступи"]
  },
  "goals": ["перейти на senior"],
  "summary": "Backend-розробник з 3 роками досвіду."
}
```

**Finish (після чату):**

```bash
curl -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/finish" \
  -H "Authorization: Bearer $CANDIDATE_TOKEN"
```

**Confirm:**

```bash
curl -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/confirm" \
  -H "Authorization: Bearer $CANDIDATE_TOKEN"
```

**UI-сценарій:**
1. Пройти анкету в `/candidate/prep/:interviewId` (3+ обміни).
2. Натиснути «Завершити чат» → переглянути профіль.
3. Натиснути «Підтвердити профіль» → «✓ Підтверджено {дата}».
4. Reload — профіль і `confirmedAt` на місці; «Видалити чат» disabled.
````

- [ ] **Step 3: Final verification**

Run:

```bash
npm --workspace backend test
npm run build
```

Expected: all tests PASS, build PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add Day 13 candidate profile confirmation quick start"
```

---

## Manual Verification Checklist

- [ ] Кандидат: чат → «Завершити чат» → профіль з усіма секціями
- [ ] «Підтвердити профіль» → banner з датою
- [ ] Reload: profile view, read-only chat, delete disabled
- [ ] curl finish/confirm з candidate JWT
- [ ] `npm run build` проходить

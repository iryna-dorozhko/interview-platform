# HR Profile Confirmation (Day 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HR confirm the generated `CompanyProfile` via a "Підтвердити профіль" button, persisting `confirmedAt` and blocking chat reset (and future downstream steps) until confirmed.

**Architecture:** New `POST /api/prep/:interviewId/confirm` endpoint on the existing `prep.ts` router sets `CompanyProfile.confirmedAt` and transitions `Interview.status` from `DRAFT` to `AWAITING_CANDIDATE`. `DELETE /api/prep/:interviewId` gets a new guard rejecting resets once confirmed. The frontend adds a confirm button and a confirmed-state banner to the existing profile view in `CompanyPrepView.vue`, and disables the delete button once confirmed.

**Tech Stack:** Express + Prisma (backend), Vue 3 `<script setup>` + TypeScript (frontend), Node's built-in `node:test`/`assert` test runner.

**Spec:** `docs/superpowers/specs/2026-07-07-hr-profile-confirmation-design.md`

---

### Task 1: Expose `confirmedAt` in existing profile responses

**Files:**
- Modify: `backend/src/routes/prep.ts:52-68` (GET handler), `backend/src/routes/prep.ts:174-181` (finish handler)
- Modify: `backend/src/routes/prep.test.ts` (fake prisma `FakeProfile` type + `upsert` default, two new assertions)

- [ ] **Step 1: Extend the fake Prisma double to track `confirmedAt`**

In `backend/src/routes/prep.test.ts`, update the `FakeProfile` type and the `companyProfile.upsert` mock so every profile has a `confirmedAt` field (defaulting to `null` on creation):

```ts
type FakeProfile = {
  id: string;
  interviewId: string;
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
  confirmedAt: Date | null;
};
```

Update the `companyProfile.upsert` mock inside `makeFakePrisma`:

```ts
    companyProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
      upsert: async ({
        where,
        create,
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
    },
```

Then fix the two existing literal profile fixtures that build a `FakeProfile[]` directly (they now need `confirmedAt: null`):

In the `"GET /prep/:interviewId returns profile when session is closed"` test:

```ts
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: null,
      },
    ],
```

In the `"DELETE /prep/:interviewId removes session, messages, and profile"` test:

```ts
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["не вказано"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: null,
      },
    ],
```

- [ ] **Step 2: Write the failing tests for `confirmedAt` exposure**

Add to `backend/src/routes/prep.test.ts` (after the `"GET /prep/:interviewId returns profile when session is closed"` test):

```ts
test("GET /prep/:interviewId includes confirmedAt: null in an unconfirmed profile", async () => {
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
        confirmedAt: null,
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
    assert.equal(body.profile.confirmedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

Add after the `"POST /prep/:interviewId/finish extracts profile, saves it, and closes the session"` test:

```ts
test("POST /prep/:interviewId/finish returns confirmedAt: null for a freshly generated profile", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  fakePrisma.__messages.push(
    { id: "m1", sessionId: "session_1", authorType: "HUMAN_HR", content: "Middle Backend Developer", createdAt: new Date(1) }
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
    assert.equal(body.profile.confirmedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npm test`
Expected: the two new tests FAIL (`body.profile.confirmedAt` is `undefined`, not `null`), all other tests still pass.

- [ ] **Step 4: Implement — add `confirmedAt` to both response payloads**

In `backend/src/routes/prep.ts`, update the GET handler's profile serialization:

```ts
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
            confirmedAt: profile.confirmedAt,
          }
        : null,
    });
```

And the `finish` handler's response:

```ts
    res.status(200).json({
      profile: {
        role: profile.role,
        requirements: profile.requirements,
        culture: profile.culture,
        expectations: profile.expectations,
        confirmedAt: profile.confirmedAt,
      },
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: all tests, including the 2 new ones, PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "Expose confirmedAt in company profile responses"
```

---

### Task 2: `POST /prep/:interviewId/confirm` endpoint

**Files:**
- Modify: `backend/src/routes/prep.ts` (add new route)
- Modify: `backend/src/routes/prep.test.ts` (fake prisma: `FakeInterview.status`, `interview.update`, `companyProfile.update`, `__interviews`; new tests)

- [ ] **Step 1: Extend the fake Prisma double for status transitions**

In `backend/src/routes/prep.test.ts`, update `FakeInterview` and the `makeFakePrisma` factory:

```ts
type FakeInterview = { id: string; hrUserId: string; status?: string };
```

Inside `makeFakePrisma`, replace `const interviews = seed.interviews ?? [];` with:

```ts
  const interviews = (seed.interviews ?? []).map((item) => ({ status: "DRAFT", ...item }));
```

Add an `update` method to the `interview` mock and a matching `update` method to `companyProfile`, plus export `__interviews` for assertions:

```ts
    interview: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        interviews.find((item) => item.id === where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: string };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("interview not found");
        Object.assign(interview, data);
        return interview;
      },
    },
```

```ts
    companyProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        profiles.find((item) => item.interviewId === where.interviewId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { interviewId: string };
        data: { confirmedAt: Date };
      }) => {
        const profile = profiles.find((item) => item.interviewId === where.interviewId);
        if (!profile) throw new Error("profile not found");
        Object.assign(profile, data);
        return profile;
      },
      upsert: async ({
        where,
        create,
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
    },
```

This `companyProfile` block fully replaces the one introduced in Task 1 (same `upsert`/`deleteMany` bodies, plus the new `update` method).

Add `__interviews: interviews` to the object returned by `makeFakePrisma`, alongside `__sessions`, `__messages`, `__profiles`.

- [ ] **Step 2: Write the failing tests**

Add to `backend/src/routes/prep.test.ts`:

```ts
test("POST /prep/:interviewId/confirm sets confirmedAt and moves interview to AWAITING_CANDIDATE", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1", status: "DRAFT" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: null,
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/confirm`, { method: "POST" });
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

test("POST /prep/:interviewId/confirm returns 404 when profile does not exist yet", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1", status: "DRAFT" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: false }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/confirm`, { method: "POST" });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, "Profile not found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/confirm returns 409 when already confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["3+ роки"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/confirm`, { method: "POST" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Profile already confirmed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/confirm returns 403 when interview belongs to another HR", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [{ id: "interview_1", hrUserId: "hr_other" }] });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/confirm`, { method: "POST" });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /prep/:interviewId/confirm returns 404 when interview does not exist", async () => {
  const fakePrisma = makeFakePrisma();
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };

  const app = express();
  app.use(express.json());
  app.use(withUser({ id: "hr_1", email: "hr@test.com", role: "HR" }));
  app.use("/api", createPrepRouter(() => fakePrisma as never, () => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/prep/interview_1/confirm`, { method: "POST" });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npm test`
Expected: the 5 new tests FAIL with 404 (route doesn't exist yet — Express returns its default 404 handler, not the JSON error shapes asserted).

- [ ] **Step 4: Implement the `confirm` route**

In `backend/src/routes/prep.ts`, add this route (placed after the `finish` route, before `message`):

```ts
  router.post("/prep/:interviewId/confirm", async (req: Request, res: Response) => {
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

    const profile = await prisma.companyProfile.findUnique({ where: { interviewId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (profile.confirmedAt) {
      res.status(409).json({ error: "Profile already confirmed" });
      return;
    }

    let updatedProfile;
    let interviewStatus = interview.status;
    try {
      updatedProfile = await prisma.companyProfile.update({
        where: { interviewId },
        data: { confirmedAt: new Date() },
      });

      if (interview.status === "DRAFT") {
        await prisma.interview.update({
          where: { id: interviewId },
          data: { status: "AWAITING_CANDIDATE" },
        });
        interviewStatus = "AWAITING_CANDIDATE";
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[prep:confirm] failed to confirm profile:", detail);
      res.status(500).json({ error: "Internal error", detail });
      return;
    }

    res.status(200).json({
      profile: {
        role: updatedProfile.role,
        requirements: updatedProfile.requirements,
        culture: updatedProfile.culture,
        expectations: updatedProfile.expectations,
        confirmedAt: updatedProfile.confirmedAt,
      },
      interviewStatus,
    });
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: all tests, including the 5 new ones, PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "Add POST /prep/:interviewId/confirm endpoint"
```

---

### Task 3: Block `DELETE /prep/:interviewId` once confirmed

**Files:**
- Modify: `backend/src/routes/prep.ts:276-306` (`delete` handler)
- Modify: `backend/src/routes/prep.test.ts` (new test)

- [ ] **Step 1: Write the failing test**

Add to `backend/src/routes/prep.test.ts`, after the existing `"DELETE /prep/:interviewId removes session, messages, and profile"` test:

```ts
test("DELETE /prep/:interviewId returns 409 when profile is confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "interview_1", hrUserId: "hr_1", status: "AWAITING_CANDIDATE" }],
    sessions: [{ id: "session_1", interviewId: "interview_1", isClosed: true }],
    profiles: [
      {
        id: "profile_1",
        interviewId: "interview_1",
        role: "QA Engineer",
        requirements: ["не вказано"],
        culture: ["не вказано"],
        expectations: ["не вказано"],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
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
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Profile is confirmed and cannot be reset");
    assert.equal(fakePrisma.__sessions.length, 1);
    assert.equal(fakePrisma.__profiles.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test`
Expected: the new test FAILS (delete currently succeeds with 200 and wipes the confirmed profile).

- [ ] **Step 3: Implement the guard**

In `backend/src/routes/prep.ts`, inside the `delete` handler, add the check right after the ownership check (`interview.hrUserId !== req.user?.id`) and before the existing `try` block:

```ts
    const existingProfile = await prisma.companyProfile.findUnique({ where: { interviewId } });
    if (existingProfile?.confirmedAt) {
      res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
      return;
    }

    try {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: all tests, including the new one, PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "Block deleting a confirmed prep chat"
```

---

### Task 4: Frontend API client — `confirmPrepProfile`

**Files:**
- Modify: `frontend/src/api/prep.ts`

There is no frontend test runner in this repo yet (verified: no `*.test.ts` under `frontend/src`, no test script in `frontend/package.json`). This task is verified via `npm run build` (which runs `vue-tsc -b`) and manual testing in Task 6.

- [ ] **Step 1: Add `confirmedAt` to the `CompanyProfile` type**

In `frontend/src/api/prep.ts`:

```ts
export type CompanyProfile = {
  role: string;
  requirements: string[];
  culture: string[];
  expectations: string[];
  confirmedAt: string | null;
};
```

- [ ] **Step 2: Add the `confirmPrepProfile` function**

In `frontend/src/api/prep.ts`, after `finishPrepChat`:

```ts
export async function confirmPrepProfile(
  interviewId: string
): Promise<{ profile: CompanyProfile; interviewStatus: string }> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}/confirm`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося підтвердити профіль");
  }
  return response.json() as Promise<{ profile: CompanyProfile; interviewStatus: string }>;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors (this file has no consumers yet, so it can't fail on usage — this just checks the new code itself is well-typed).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/prep.ts
git commit -m "Add confirmPrepProfile API client function"
```

---

### Task 5: Frontend UI — confirm button and confirmed state

**Files:**
- Modify: `frontend/src/views/CompanyPrepView.vue`

- [ ] **Step 1: Import `confirmPrepProfile` and add a handler**

In `frontend/src/views/CompanyPrepView.vue`, update the import block:

```ts
import {
  confirmPrepProfile,
  deletePrepChat,
  fetchPrepState,
  finishPrepChat,
  sendPrepMessage,
  type CompanyProfile,
  type PrepMessage,
} from "../api/prep";
```

Add a `confirming` ref next to `sending`:

```ts
const sending = ref(false);
const confirming = ref(false);
```

Add the handler after `onFinishChat`:

```ts
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
    const response = await confirmPrepProfile(interviewId.value);
    profile.value = response.profile;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Не вдалося підтвердити профіль";
  } finally {
    confirming.value = false;
  }
}
```

- [ ] **Step 2: Update the profile-view template**

Replace the `.actions` block in the `profile-view` section:

```html
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
            ✓ Підтверджено {{ new Date(profile.confirmedAt).toLocaleString("uk-UA") }}
          </p>
        </div>
```

- [ ] **Step 3: Add styling for the confirmed banner**

In the `<style scoped>` block, after `.actions`:

```css
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

- [ ] **Step 4: Verify types compile**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/CompanyPrepView.vue
git commit -m "Add profile confirmation UI to CompanyPrepView"
```

---

### Task 6: Manual verification, README update, final commit

**Files:**
- Modify: `README.md` (Day 7 section, currently at `README.md:405-419`)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests pass (including all tests added in Tasks 1–3).

- [ ] **Step 2: Run the full build**

Run: `npm run build` (from repo root)
Expected: both workspaces build with no errors.

- [ ] **Step 3: Manual scenario — start both servers**

Run backend: `cd backend && npm run dev` (background)
Run frontend: `cd frontend && npm run dev` (background)

- [ ] **Step 4: Manual scenario — walk through confirm flow**

1. Log in as `hr@test.com` / `123456` at the frontend login page.
2. Open the seeded interview's prep chat (`/prep/:interviewId`, `interviewId` from `db:seed` log output or `GET /api/interviews/mine`).
3. If the chat isn't finished yet, complete it and click "Завершити чат" to generate the profile.
4. On the profile screen, click "Підтвердити профіль", confirm the browser dialog.
5. Verify: the button disappears, "✓ Підтверджено {date}" appears, and "Видалити чат" is now disabled.
6. Reload the page (`GET /prep/:interviewId`) — verify the confirmed state persists (confirmedAt still shown).
7. Query the DB (`npx prisma studio` or a direct query) — verify `CompanyProfile.confirmedAt` is set and `Interview.status = AWAITING_CANDIDATE`.
8. Attempt `curl -X DELETE http://localhost:3000/api/prep/$INTERVIEW_ID -H "Authorization: Bearer $TOKEN"` — verify it returns `409 { "error": "Profile is confirmed and cannot be reset" }`.

- [ ] **Step 5: Update README Day 7 section**

Replace the Day 7 section (`README.md:405-419`) with a filled-in version following the style of the Day 6 section above it (`README.md:389-401`) and the Day 4/5 curl-example style further up. Include:
- The `POST /api/prep/:interviewId/confirm` curl example (with Bearer token) and its expected JSON response (`profile` with `confirmedAt`, `interviewStatus`).
- A short note on error responses: `404 Profile not found` (finish not called yet), `409 Profile already confirmed`.
- A short note that `DELETE /api/prep/:interviewId` now returns `409` once the profile is confirmed.
- Keep the existing Definition of Done checklist items, marking them checked (`[x]`) since they're now implemented.

- [ ] **Step 6: Commit the README update**

```bash
git add README.md
git commit -m "Document Day 7 profile confirmation endpoint in README"
```

---

## Out of scope (unchanged from spec)

- `POST /interviews` (Day 8) and any logic depending on `AWAITING_CANDIDATE`.
- Candidate join, room, report — not implemented, no gating for them yet.
- Candidate profile confirmation (same pattern, future day).
- Editing or un-confirming a profile after `confirm`.

# Candidate Join-by-Code (Day 14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завершити join-by-code — валідація join, прив’язка кандидата, перехід `Interview.status` у `READY` («Обидва готові»), коли кандидат приєднався і підтвердив профіль.

**Architecture:** Спільний модуль `interview-readiness.ts` з `canCandidateJoinInterview` і `maybeTransitionToReady`. Виклики з `POST /candidate/interview/join` і `POST /candidate-prep/:id/confirm`. Frontend join UI вже є; оновлюємо лейбли статусу та 409-помилки.

**Tech Stack:** Express + Prisma (backend), Node `node:test`/`assert`, Vue 3 `<script setup>` + TypeScript (frontend).

**Spec:** `docs/superpowers/specs/2026-07-09-candidate-join-by-code-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/utils/interview-readiness.ts` | Join validation + READY transition helper |
| `backend/src/utils/interview-readiness.test.ts` | Unit tests for readiness helpers |
| `backend/src/routes/candidate-interview.ts` | Wire join validation + maybeTransitionToReady |
| `backend/src/routes/candidate-interview.test.ts` | Integration tests for join edge cases |
| `backend/src/routes/candidate-prep.ts` | maybeTransitionToReady after confirm |
| `backend/src/routes/candidate-prep.test.ts` | Confirm → READY when joined |
| `backend/package.json` | Add interview-readiness.test.ts to test script |
| `frontend/src/api/candidate-interview.ts` | Map new 409 errors to Ukrainian |
| `frontend/src/views/CandidateHomeView.vue` | READY label |
| `frontend/src/views/CandidateInterviewView.vue` | READY label |
| `frontend/src/views/InterviewListView.vue` | READY label |
| `frontend/src/views/InterviewDetailView.vue` | READY label |
| `README.md` | Day 14 Quick Start + DoD |

---

### Task 1: `interview-readiness` unit tests (TDD)

**Files:**
- Create: `backend/src/utils/interview-readiness.test.ts`

- [ ] **Step 1: Create failing unit test file**

Create `backend/src/utils/interview-readiness.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  canCandidateJoinInterview,
  maybeTransitionToReady,
} from "./interview-readiness";

type FakeInterview = {
  id: string;
  status: string;
  candidateUserId: string | null;
  vacancyId: string;
};

type FakeVacancy = {
  id: string;
  status: string;
  companyProfile: { confirmedAt: Date | null } | null;
};

type FakeCandidateProfile = {
  interviewId: string;
  confirmedAt: Date | null;
};

function makeFakePrisma(seed: {
  interviews: FakeInterview[];
  vacancies: FakeVacancy[];
  candidateProfiles: FakeCandidateProfile[];
}) {
  const interviews = seed.interviews.map((item) => ({ ...item }));
  const vacancies = seed.vacancies.map((item) => ({ ...item }));
  const candidateProfiles = seed.candidateProfiles.map((item) => ({ ...item }));

  return {
    interview: {
      findFirst: async ({
        where,
      }: {
        where: {
          candidateUserId: string;
          status: { in: string[] };
          NOT?: { id: string };
        };
      }) =>
        interviews.find(
          (item) =>
            item.candidateUserId === where.candidateUserId &&
            where.status.in.includes(item.status) &&
            item.id !== where.NOT?.id,
        ) ?? null,
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: {
          vacancy?: { include?: { companyProfile?: boolean } };
          candidateProfile?: boolean;
        };
      }) => {
        const interview = interviews.find((item) => item.id === where.id) ?? null;
        if (!interview || !include) return interview;
        const vacancy = vacancies.find((item) => item.id === interview.vacancyId) ?? null;
        return {
          ...interview,
          vacancy: vacancy
            ? {
                ...vacancy,
                companyProfile: include.vacancy?.include?.companyProfile ? vacancy.companyProfile : undefined,
              }
            : null,
          candidateProfile: include.candidateProfile
            ? candidateProfiles.find((item) => item.interviewId === interview.id) ?? null
            : undefined,
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: string };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("Interview not found");
        if (data.status !== undefined) interview.status = data.status;
        return { ...interview };
      },
    },
    __interviews: interviews,
  };
}

test("maybeTransitionToReady moves AWAITING_CANDIDATE to READY when all conditions met", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i1",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
    ],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "READY");
  assert.equal(fakePrisma.__interviews[0].status, "READY");
});

test("maybeTransitionToReady is no-op when candidate not joined", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: null, vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when candidate profile not confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: null }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when HR profile reset", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "DRAFT", companyProfile: { confirmedAt: null } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when already READY", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "READY", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "READY");
  assert.equal(fakePrisma.__interviews[0].status, "READY");
});

test("canCandidateJoinInterview rejects LIVE and ENDED", async () => {
  for (const status of ["LIVE", "ENDED"] as const) {
    const fakePrisma = makeFakePrisma({ interviews: [], vacancies: [], candidateProfiles: [] });
    const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
      id: "i1",
      status,
      candidateUserId: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Interview is not joinable");
  }
});

test("canCandidateJoinInterview rejects when taken by another candidate", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [], vacancies: [], candidateProfiles: [] });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i1",
    status: "AWAITING_CANDIDATE",
    candidateUserId: "other",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Interview already taken");
});

test("canCandidateJoinInterview rejects when candidate has another active interview", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i_other", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [],
    candidateProfiles: [],
  });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i_new",
    status: "AWAITING_CANDIDATE",
    candidateUserId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Candidate already has active interview");
});

test("canCandidateJoinInterview allows re-join of same interview", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [],
    candidateProfiles: [],
  });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i1",
    status: "AWAITING_CANDIDATE",
    candidateUserId: "cd_1",
  });
  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`):

```bash
node --import tsx --test src/utils/interview-readiness.test.ts
```

Expected: FAIL — `Cannot find module './interview-readiness'`

- [ ] **Step 3: Commit failing test**

```bash
git add backend/src/utils/interview-readiness.test.ts
git commit -m "test: add interview-readiness unit tests (red)"
```

---

### Task 2: Implement `interview-readiness` module

**Files:**
- Create: `backend/src/utils/interview-readiness.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Create implementation**

Create `backend/src/utils/interview-readiness.ts`:

```ts
import type { Interview, PrismaClient } from "@prisma/client";

export const ACTIVE_CANDIDATE_INTERVIEW_STATUSES = ["AWAITING_CANDIDATE", "READY", "LIVE"] as const;

const NON_JOINABLE_INTERVIEW_STATUSES = ["LIVE", "ENDED"] as const;

type JoinCheckInterview = Pick<Interview, "id" | "status" | "candidateUserId">;

export type JoinCheckResult = { ok: true } | { ok: false; error: string };

export async function canCandidateJoinInterview(
  prisma: PrismaClient,
  candidateUserId: string,
  interview: JoinCheckInterview,
): Promise<JoinCheckResult> {
  if (
    NON_JOINABLE_INTERVIEW_STATUSES.includes(
      interview.status as (typeof NON_JOINABLE_INTERVIEW_STATUSES)[number],
    )
  ) {
    return { ok: false, error: "Interview is not joinable" };
  }

  if (interview.candidateUserId && interview.candidateUserId !== candidateUserId) {
    return { ok: false, error: "Interview already taken" };
  }

  const existingActive = await prisma.interview.findFirst({
    where: {
      candidateUserId,
      status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
      NOT: { id: interview.id },
    },
  });

  if (existingActive) {
    return { ok: false, error: "Candidate already has active interview" };
  }

  return { ok: true };
}

export async function maybeTransitionToReady(
  prisma: PrismaClient,
  interviewId: string,
): Promise<Interview | null> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      vacancy: { include: { companyProfile: true } },
      candidateProfile: true,
    },
  });

  if (!interview || interview.status !== "AWAITING_CANDIDATE") {
    return interview;
  }

  const hrReady =
    interview.vacancy.status === "CONFIRMED" &&
    interview.vacancy.companyProfile?.confirmedAt != null;
  const candidateReady =
    interview.candidateUserId != null && interview.candidateProfile?.confirmedAt != null;

  if (!hrReady || !candidateReady) {
    return interview;
  }

  return prisma.interview.update({
    where: { id: interviewId },
    data: { status: "READY" },
  });
}
```

- [ ] **Step 2: Add test file to package.json**

In `backend/package.json`, append `src/utils/interview-readiness.test.ts` to the `test` script (after `joinCode.test.ts`).

- [ ] **Step 3: Run unit tests**

Run:

```bash
node --import tsx --test src/utils/interview-readiness.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/utils/interview-readiness.ts backend/package.json
git commit -m "feat: add interview readiness helpers for join and READY transition"
```

---

### Task 3: Wire join route + integration tests

**Files:**
- Modify: `backend/src/routes/candidate-interview.ts`
- Modify: `backend/src/routes/candidate-interview.test.ts`

- [ ] **Step 1: Add failing integration tests**

Append to `backend/src/routes/candidate-interview.test.ts`:

```ts
test("POST /candidate/interview/join returns 409 for ENDED interview", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "END001",
      candidateUserId: null,
      status: "ENDED",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: "END001" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Interview is not joinable");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join returns 409 when candidate already has active interview", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_active",
      displayName: "Active",
      joinCode: "ACT001",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
    {
      id: "interview_new",
      displayName: "New",
      joinCode: "NEW001",
      candidateUserId: null,
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: "NEW001" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "Candidate already has active interview");
  } finally {
    server.close();
  }
});

test("POST /candidate/interview/join is idempotent for same candidate", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "interview_1",
      displayName: "Frontend Dev",
      joinCode: "TEST01",
      candidateUserId: "candidate_1",
      status: "AWAITING_CANDIDATE",
      createdAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/interview/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: "TEST01" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interview.id, "interview_1");
  } finally {
    server.close();
  }
});
```

Also extend `makeFakePrisma` in the same file — add `findFirst` support used by `canCandidateJoinInterview`:

```ts
findFirst: async ({
  where,
}: {
  where: {
    candidateUserId: string;
    status: { in: string[] };
    NOT?: { id: string };
  };
}) =>
  interviews.find(
    (item) =>
      item.candidateUserId === where.candidateUserId &&
      where.status.in.includes(item.status) &&
      item.id !== where.NOT?.id,
  ) ?? null,
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run:

```bash
node --import tsx --test src/routes/candidate-interview.test.ts
```

Expected: FAIL on ENDED / active-interview tests (route does not validate yet).

- [ ] **Step 3: Update join route**

Replace `backend/src/routes/candidate-interview.ts` with:

```ts
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  ACTIVE_CANDIDATE_INTERVIEW_STATUSES,
  canCandidateJoinInterview,
  maybeTransitionToReady,
} from "../utils/interview-readiness";

type JoinBody = { joinCode?: unknown };

export function createCandidateInterviewRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.get("/candidate/interview", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user?.id as string;

    const interview = await prisma.interview.findFirst({
      where: {
        candidateUserId,
        status: { in: [...ACTIVE_CANDIDATE_INTERVIEW_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!interview) {
      res.status(200).json({ interview: null });
      return;
    }

    res.status(200).json({
      interview: {
        id: interview.id,
        displayName: interview.displayName,
        status: interview.status,
      },
    });
  });

  router.post("/candidate/interview/join", async (req: Request, res: Response) => {
    const prisma = getPrisma();
    const candidateUserId = req.user?.id as string;
    const body = (req.body ?? {}) as JoinBody;
    const joinCode = typeof body.joinCode === "string" ? body.joinCode.trim().toUpperCase() : "";

    if (!joinCode) {
      res.status(400).json({ error: "joinCode is required" });
      return;
    }

    const interview = await prisma.interview.findUnique({ where: { joinCode } });
    if (!interview) {
      res.status(404).json({ error: "Invalid join code" });
      return;
    }

    const joinCheck = await canCandidateJoinInterview(prisma, candidateUserId, interview);
    if (!joinCheck.ok) {
      res.status(409).json({ error: joinCheck.error });
      return;
    }

    const linked =
      interview.candidateUserId === candidateUserId
        ? interview
        : await prisma.interview.update({
            where: { id: interview.id },
            data: { candidateUserId },
          });

    const finalInterview = (await maybeTransitionToReady(prisma, linked.id)) ?? linked;

    res.status(200).json({
      interview: {
        id: finalInterview.id,
        displayName: finalInterview.displayName,
        status: finalInterview.status,
      },
    });
  });

  return router;
}
```

- [ ] **Step 4: Run integration tests**

Run:

```bash
node --import tsx --test src/routes/candidate-interview.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-interview.ts backend/src/routes/candidate-interview.test.ts
git commit -m "feat: validate candidate join and call maybeTransitionToReady"
```

---

### Task 4: Wire confirm route → READY

**Files:**
- Modify: `backend/src/routes/candidate-prep.ts`
- Modify: `backend/src/routes/candidate-prep.test.ts`

- [ ] **Step 1: Extend fake prisma in candidate-prep.test.ts**

Update `FakeInterview` type to include optional fields:

```ts
type FakeInterview = {
  id: string;
  vacancyId: string;
  hrUserId: string;
  status?: string;
  candidateUserId?: string | null;
};
```

Add to `makeFakePrisma` seed parameter:

```ts
vacancies?: Array<{ id: string; status: string; companyProfile?: { confirmedAt: Date | null } | null }>;
```

Default vacancies in makeFakePrisma if not provided:

```ts
const vacancies = seed.vacancies ?? [
  { id: "vacancy_1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } },
];
```

Replace `interview.findUnique` with version that supports `include`:

```ts
findUnique: async ({
  where,
  include,
}: {
  where: { id: string };
  include?: {
    vacancy?: { include?: { companyProfile?: boolean } };
    candidateProfile?: boolean;
  };
}) => {
  const interview = interviews.find((item) => item.id === where.id) ?? null;
  if (!interview) return null;
  if (!include) return interview;
  const vacancy = vacancies.find((item) => item.id === interview.vacancyId) ?? null;
  return {
    ...interview,
    vacancy: vacancy
      ? {
          status: vacancy.status,
          companyProfile: include.vacancy?.include?.companyProfile ? vacancy.companyProfile : undefined,
        }
      : null,
    candidateProfile: include.candidateProfile
      ? profiles.find((item) => item.interviewId === interview.id) ?? null
      : undefined,
  };
},
update: async ({
  where,
  data,
}: {
  where: { id: string };
  data: { status?: string };
}) => {
  const interview = interviews.find((item) => item.id === where.id);
  if (!interview) throw new Error("interview not found");
  if (data.status !== undefined) interview.status = data.status;
  return interview;
},
```

Add `__vacancies: vacancies` to returned object.

- [ ] **Step 2: Replace confirm test**

Replace test `"POST /candidate-prep/:interviewId/confirm sets confirmedAt without changing interview status"` with:

```ts
test("POST /candidate-prep/:interviewId/confirm stays AWAITING_CANDIDATE when candidate not joined", async () => {
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
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };
  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.notEqual(body.profile.confirmedAt, null);
    assert.equal(body.interviewStatus, "AWAITING_CANDIDATE");
    assert.equal(fakePrisma.__interviews[0].status, "AWAITING_CANDIDATE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /candidate-prep/:interviewId/confirm transitions to READY when candidate joined", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "interview_1",
        vacancyId: "vacancy_1",
        hrUserId: "hr_1",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
      },
    ],
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
    vacancies: [{ id: "vacancy_1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
  });
  const fakeProvider: LlmProvider = { name: "omlx", async complete() { return "не має викликатись"; } };
  const app = mountApp(fakePrisma, fakeProvider, { id: "cd_1", email: "cd@test.com", role: "CANDIDATE" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate-prep/interview_1/confirm`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.interviewStatus, "READY");
    assert.equal(fakePrisma.__interviews[0].status, "READY");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
```

- [ ] **Step 3: Run confirm test to verify READY test fails**

Run:

```bash
node --import tsx --test src/routes/candidate-prep.test.ts
```

Expected: FAIL — `"POST /candidate-prep/:interviewId/confirm transitions to READY when candidate joined"` returns `interviewStatus: "AWAITING_CANDIDATE"`.

- [ ] **Step 4: Update confirm handler**

In `backend/src/routes/candidate-prep.ts`, add import:

```ts
import { maybeTransitionToReady } from "../utils/interview-readiness";
```

After successful profile update in confirm handler, replace the response block:

```ts
    const finalInterview = (await maybeTransitionToReady(prisma, interviewId)) ?? interview;

    res.status(200).json({
      profile: {
        experience: updatedProfile.experience,
        skills: updatedProfile.skills,
        goals: updatedProfile.goals,
        summary: updatedProfile.summary,
        confirmedAt: updatedProfile.confirmedAt,
      },
      interviewStatus: finalInterview.status,
    });
```

(Remove the old `interviewStatus: interview.status` line that used stale status.)

- [ ] **Step 5: Run all backend tests**

Run (from `backend/`):

```bash
npm test
```

Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/candidate-prep.ts backend/src/routes/candidate-prep.test.ts
git commit -m "feat: transition interview to READY on candidate profile confirm"
```

---

### Task 5: Frontend error mapping and status labels

**Files:**
- Modify: `frontend/src/api/candidate-interview.ts`
- Modify: `frontend/src/views/CandidateHomeView.vue`
- Modify: `frontend/src/views/CandidateInterviewView.vue`
- Modify: `frontend/src/views/InterviewListView.vue`
- Modify: `frontend/src/views/InterviewDetailView.vue`

- [ ] **Step 1: Update API client 409 mapping**

In `frontend/src/api/candidate-interview.ts`, replace the 409 block in `joinInterviewByCode`:

```ts
    if (response.status === 409) {
      let body: ErrorBody = {};
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        // ignore
      }
      const code = body.error;
      if (code === "Interview is not joinable") {
        throw new Error("Співбесіду вже завершено або вона в ефірі");
      }
      if (code === "Candidate already has active interview") {
        throw new Error("У вас уже є активна співбесіда");
      }
      throw new Error("Ця співбесіда вже зайнята іншим кандидатом");
    }
```

- [ ] **Step 2: Update READY labels in four views**

In each file, change `STATUS_LABELS`:

```ts
READY: "Обидва готові",
```

Files:
- `frontend/src/views/CandidateHomeView.vue`
- `frontend/src/views/CandidateInterviewView.vue`
- `frontend/src/views/InterviewListView.vue`
- `frontend/src/views/InterviewDetailView.vue`

- [ ] **Step 3: Run typecheck**

Run (from `frontend/`):

```bash
npx vue-tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/candidate-interview.ts frontend/src/views/CandidateHomeView.vue frontend/src/views/CandidateInterviewView.vue frontend/src/views/InterviewListView.vue frontend/src/views/InterviewDetailView.vue
git commit -m "feat: update join errors and READY status label to Обидва готові"
```

---

### Task 6: README Day 14 + verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Day 14 section**

In README, replace Day 14 Definition of Done checkboxes and add Quick Start after the Day 14 heading:

```markdown
**Definition of Done:**
- [ ] Демонстрація: HR дав код → кандидат ввів → prep → confirm → обидва в `READY` («Обидва готові»)
- [ ] Сценарій: невалідний код → помилка; код зайнятий → помилка; валідний join → `candidateUserId` встановлено
- [ ] Збірка: `npm run build` проходить
- [ ] README: endpoint `POST /api/candidate/interview/join`, сценарій HR + кандидат до `READY`

### Candidate Join Quick Start (Day 14)

**Endpoint:** `POST /api/candidate/interview/join`  
**Auth:** Bearer token, `role: CANDIDATE`  
**Body:** `{ "joinCode": "TEST01" }`

**Потік:**

1. HR створює співбесіду з підтвердженої анкети → отримує 6-символьний код
2. Кандидат: `/candidate` → «Приєднатися до зустрічі» → вводить код
3. Кандидат проходить prep → finish → confirm
4. `Interview.status` → `READY` («Обидва готові») у HR і candidate UI

**Помилки join:**

| HTTP | error | Значення |
|------|-------|----------|
| 404 | `Invalid join code` | Невірний код |
| 409 | `Interview already taken` | Код зайнятий іншим кандидатом |
| 409 | `Interview is not joinable` | LIVE або ENDED |
| 409 | `Candidate already has active interview` | У кандидата вже є активна співбесіда |
```

- [ ] **Step 2: Run full build**

Run (from repo root):

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run backend tests**

Run (from `backend/`):

```bash
npm test
```

Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add Day 14 candidate join-by-code quick start"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `interview-readiness.ts` helpers | Task 1–2 |
| Join validation (status, active interview) | Task 3 |
| `maybeTransitionToReady` on join | Task 3 |
| `maybeTransitionToReady` on confirm | Task 4 |
| Frontend 409 errors | Task 5 |
| READY label «Обидва готові» | Task 5 |
| README Day 14 | Task 6 |
| Full test suite + build | Task 6 |

---

## Manual verification checklist

1. HR: login → confirmed vacancy → create interview → copy code
2. Candidate: login → join modal → enter code → success banner
3. HR `/interviews`: status «Очікує кандидата»
4. Candidate: prep → finish → confirm
5. Both UIs show «Обидва готові»
6. Invalid code → error in modal
7. Second candidate on same code → «вже зайнята»

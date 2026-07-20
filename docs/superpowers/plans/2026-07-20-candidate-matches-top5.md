# Candidate Matches Top-5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити sequential offer (1 вакансія) на список **топ-5** найкращих вакансій з % match; reject миттєво оновлює список з підвантаженням наступної з рейтингу.

**Architecture:** Розширити існуючий match-сервіс: `pickTopOffers` замість `pickNextOffer`, `getTopMatchOffers` замість `getNextMatchOffer`. API `{ offers: [...] }` замість одного об'єкта. UI — список рядків з badge `% match` і кнопками на кожному. LLM, кеш, accept — без змін.

**Tech Stack:** TypeScript, Express, Prisma, Vue 3, node:test

## Global Constraints

- Усі user-facing тексти — українською.
- Кандидат **ніколи** не отримує company culture / philosophy / HR notes у JSON (лише `vacancyId`, `title`, `matchScore` у кожному елементі `offers`).
- Ліміт топ-5 — **hardcode `5`** у v1 (не конфігurable).
- Лише одна `VacancyApplication` зі статусом `PENDING` на кандидата (без змін).
- Spec: `docs/superpowers/specs/2026-07-20-candidate-matches-top5-design.md`.
- **Worktree:** реалізація vacancy match у `.worktrees/vacancy-match-application` (гілка `feat/vacancy-match-application`). План виконувати там; spec/plan — у корені репо.

---

## File Structure

- **Modify**
  - `backend/src/services/vacancy-match.ts` — `pickTopOffers`, `getTopMatchOffers`
  - `backend/src/services/vacancy-match.test.ts` — unit tests
  - `backend/src/routes/candidate-matches.ts` — `{ offers: [...] }` response
  - `backend/src/routes/candidate-matches.test.ts` — route tests
  - `frontend/src/api/candidate-matches.ts` — types + fetch/reject
  - `frontend/src/views/CandidateMatchesView.vue` — list UI
  - `README.md` — секція «Vacancy match & applications»

---

### Task 1: `pickTopOffers` service function

**Files:**
- Modify: `backend/src/services/vacancy-match.ts`
- Test: `backend/src/services/vacancy-match.test.ts`

**Interfaces:**
- Consumes: `sortScoresDesc`, `CandidateMatchOffer` (already exported)
- Produces: `pickTopOffers(scores, rejectedVacancyIds, limit?) → CandidateMatchOffer[]`

- [ ] **Step 1: Write failing tests for `pickTopOffers`**

Add to `backend/src/services/vacancy-match.test.ts` (after existing `pickNextOffer` tests):

```typescript
import {
  ensureMatchScores,
  getTopMatchOffers,
  pickTopOffers,
  pickNextOffer,
  sortScoresDesc,
  VacancyMatchServiceError,
} from "./vacancy-match";

test("pickTopOffers returns top 5 by matchScore descending", () => {
  const scores = [
    { vacancyId: "v1", title: "One", matchScore: 95 },
    { vacancyId: "v2", title: "Two", matchScore: 90 },
    { vacancyId: "v3", title: "Three", matchScore: 85 },
    { vacancyId: "v4", title: "Four", matchScore: 80 },
    { vacancyId: "v5", title: "Five", matchScore: 75 },
    { vacancyId: "v6", title: "Six", matchScore: 70 },
  ];
  const top = pickTopOffers(scores, new Set());
  assert.equal(top.length, 5);
  assert.deepEqual(
    top.map((item) => item.vacancyId),
    ["v1", "v2", "v3", "v4", "v5"],
  );
});

test("pickTopOffers skips rejected vacancies", () => {
  const scores = [
    { vacancyId: "v1", title: "One", matchScore: 95 },
    { vacancyId: "v2", title: "Two", matchScore: 90 },
    { vacancyId: "v3", title: "Three", matchScore: 85 },
  ];
  const top = pickTopOffers(scores, new Set(["v1"]));
  assert.deepEqual(
    top.map((item) => item.vacancyId),
    ["v2", "v3"],
  );
});

test("pickTopOffers returns empty array when all rejected", () => {
  const top = pickTopOffers(
    [{ vacancyId: "v1", title: "One", matchScore: 50 }],
    new Set(["v1"]),
  );
  assert.deepEqual(top, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`

Expected: FAIL — `pickTopOffers is not exported` or `pickTopOffers is not a function`

- [ ] **Step 3: Implement `pickTopOffers`**

In `backend/src/services/vacancy-match.ts`, add after `pickNextOffer`:

```typescript
export function pickTopOffers(
  scores: CandidateMatchOffer[],
  rejectedVacancyIds: Set<string>,
  limit = 5,
): CandidateMatchOffer[] {
  const ordered = sortScoresDesc(scores);
  const result: CandidateMatchOffer[] = [];
  for (const item of ordered) {
    if (rejectedVacancyIds.has(item.vacancyId)) continue;
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`

Expected: PASS (including existing `pickNextOffer` tests — still present)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/vacancy-match.ts backend/src/services/vacancy-match.test.ts
git commit -m "feat: add pickTopOffers for candidate match list"
```

---

### Task 2: `getTopMatchOffers` service function

**Files:**
- Modify: `backend/src/services/vacancy-match.ts`
- Test: `backend/src/services/vacancy-match.test.ts`

**Interfaces:**
- Consumes: `ensureMatchScores`, `getRejectedVacancyIds`, `pickTopOffers`
- Produces: `getTopMatchOffers(prisma, llm, candidateUserId) → Promise<CandidateMatchOffer[]>`

- [ ] **Step 1: Write failing test replacing `getNextMatchOffer` integration test**

Replace test `"getNextMatchOffer skips rejected vacancies"` with:

```typescript
test("getTopMatchOffers skips rejected vacancies and returns remaining", async () => {
  const fakePrisma = makeFakePrisma(
    confirmedCandidateSeed({
      vacancies: [
        {
          id: "v1",
          title: "Senior Backend",
          status: "CONFIRMED",
          companyProfile: {
            role: "Backend",
            requirements: {},
            culture: {},
            expectations: {},
            confirmedAt,
          },
        },
        {
          id: "v2",
          title: "Platform Engineer",
          status: "CONFIRMED",
          companyProfile: {
            role: "Platform",
            requirements: {},
            culture: {},
            expectations: {},
            confirmedAt,
          },
        },
      ],
      matchScores: [
        {
          id: "s1",
          candidateUserId: "cd_1",
          vacancyId: "v1",
          matchScore: 90,
          rankedForConfirmedAt: confirmedAt,
        },
        {
          id: "s2",
          candidateUserId: "cd_1",
          vacancyId: "v2",
          matchScore: 80,
          rankedForConfirmedAt: confirmedAt,
        },
      ],
      offerDecisions: [{ candidateUserId: "cd_1", vacancyId: "v1", decision: "REJECTED" }],
    }),
  );
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => '{"scores":[]}',
  };

  const offers = await getTopMatchOffers(
    fakePrisma as unknown as PrismaClient,
    fakeLlm,
    "cd_1",
  );

  assert.deepEqual(offers, [
    { vacancyId: "v2", title: "Platform Engineer", matchScore: 80 },
  ]);
});
```

Replace test `"getNextMatchOffer throws QUESTIONNAIRE_NOT_CONFIRMED"` to use `getTopMatchOffers`:

```typescript
test("getTopMatchOffers throws QUESTIONNAIRE_NOT_CONFIRMED when profile missing", async () => {
  const fakePrisma = makeFakePrisma({ vacancies: [], interviews: [], candidateProfiles: [] });
  const fakeLlm: LlmProvider = {
    name: "fake",
    complete: async () => {
      throw new Error("should not call LLM");
    },
  };

  await assert.rejects(
    () => getTopMatchOffers(fakePrisma as unknown as PrismaClient, fakeLlm, "cd_1"),
    (error: unknown) => {
      assert.ok(error instanceof VacancyMatchServiceError);
      assert.equal(error.code, "QUESTIONNAIRE_NOT_CONFIRMED");
      return true;
    },
  );
});
```

Remove `getNextMatchOffer` from imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`

Expected: FAIL — `getTopMatchOffers is not exported`

- [ ] **Step 3: Implement `getTopMatchOffers`, remove `getNextMatchOffer`**

Replace `getNextMatchOffer` in `vacancy-match.ts`:

```typescript
export async function getTopMatchOffers(
  prisma: PrismaClient,
  llm: LlmProvider,
  candidateUserId: string,
): Promise<CandidateMatchOffer[]> {
  const offers = await ensureMatchScores(prisma, llm, candidateUserId);
  const rejected = await getRejectedVacancyIds(prisma, candidateUserId);
  return pickTopOffers(offers, rejected, 5);
}
```

Delete `getNextMatchOffer` entirely. Keep `pickNextOffer` for now (unused) or delete if no references — grep and remove if unused.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/vacancy-match.ts backend/src/services/vacancy-match.test.ts
git commit -m "feat: replace getNextMatchOffer with getTopMatchOffers"
```

---

### Task 3: Candidate matches routes — `{ offers: [...] }` response

**Files:**
- Modify: `backend/src/routes/candidate-matches.ts`
- Test: `backend/src/routes/candidate-matches.test.ts`

**Interfaces:**
- Consumes: `getTopMatchOffers` from `../services/vacancy-match`
- Produces: `GET /matches/next` and `POST /matches/:id/reject` return `{ offers: CandidateMatchOffer[] }`

- [ ] **Step 1: Update route tests**

Replace test `"GET /matches/next returns only vacancyId title matchScore keys"`:

```typescript
test("GET /matches/next returns offers array with contract keys only", async () => {
  const fakePrisma = makeFakePrisma(confirmedSeed());
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/next`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      offers: Array<Record<string, unknown>>;
    };
    assert.ok(Array.isArray(body.offers));
    assert.equal(body.offers.length, 2);
    assert.deepEqual(Object.keys(body).sort(), ["offers"]);
    for (const offer of body.offers) {
      assert.deepEqual(Object.keys(offer).sort(), ["matchScore", "title", "vacancyId"]);
      assert.ok(!("culture" in offer));
    }
    assert.equal(body.offers[0]?.vacancyId, "v1");
    assert.equal(body.offers[0]?.matchScore, 90);
    assert.equal(body.offers[1]?.vacancyId, "v2");
    assert.equal(body.offers[1]?.matchScore, 80);
  } finally {
    server.close();
  }
});
```

Replace test `"POST /matches/:id/reject records decision and returns next"`:

```typescript
test("POST /matches/:id/reject records decision and returns updated offers", async () => {
  const fakePrisma = makeFakePrisma(confirmedSeed());
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/reject`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      offers: Array<{ vacancyId: string; title: string; matchScore: number }>;
    };
    assert.deepEqual(Object.keys(body).sort(), ["offers"]);
    assert.equal(body.offers.length, 1);
    assert.equal(body.offers[0]?.vacancyId, "v2");
    assert.equal(body.offers[0]?.title, "Platform Engineer");
    assert.equal(body.offers[0]?.matchScore, 80);
    assert.equal(fakePrisma.__offerDecisions.length, 1);
    assert.equal(fakePrisma.__offerDecisions[0]?.vacancyId, "v1");
  } finally {
    server.close();
  }
});
```

Add new test for top-5 cap and backfill after reject:

```typescript
test("GET /matches/next returns at most 5 offers sorted by score", async () => {
  const vacancies = Array.from({ length: 6 }, (_, index) => ({
    id: `v${index + 1}`,
    hrUserId: "hr_1",
    title: `Role ${index + 1}`,
    status: "CONFIRMED",
    companyProfile: {
      role: "Dev",
      requirements: {},
      culture: {},
      expectations: {},
      confirmedAt,
    },
  }));
  const matchScores = Array.from({ length: 6 }, (_, index) => ({
    id: `s${index + 1}`,
    candidateUserId: "candidate_1",
    vacancyId: `v${index + 1}`,
    matchScore: 99 - index,
    rankedForConfirmedAt: confirmedAt,
  }));

  const fakePrisma = makeFakePrisma(
    confirmedSeed({ vacancies, matchScores }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/next`, {
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { offers: Array<{ vacancyId: string }> };
    assert.equal(body.offers.length, 5);
    assert.deepEqual(
      body.offers.map((item) => item.vacancyId),
      ["v1", "v2", "v3", "v4", "v5"],
    );
  } finally {
    server.close();
  }
});

test("POST /matches/:id/reject backfills sixth offer when available", async () => {
  const vacancies = Array.from({ length: 6 }, (_, index) => ({
    id: `v${index + 1}`,
    hrUserId: "hr_1",
    title: `Role ${index + 1}`,
    status: "CONFIRMED",
    companyProfile: {
      role: "Dev",
      requirements: {},
      culture: {},
      expectations: {},
      confirmedAt,
    },
  }));
  const matchScores = Array.from({ length: 6 }, (_, index) => ({
    id: `s${index + 1}`,
    candidateUserId: "candidate_1",
    vacancyId: `v${index + 1}`,
    matchScore: 99 - index,
    rankedForConfirmedAt: confirmedAt,
  }));

  const fakePrisma = makeFakePrisma(
    confirmedSeed({ vacancies, matchScores }),
  );
  const app = makeApp(fakePrisma);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/candidate/matches/v1/reject`, {
      method: "POST",
      headers: authHeaders(candidateUser),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { offers: Array<{ vacancyId: string }> };
    assert.equal(body.offers.length, 5);
    assert.deepEqual(
      body.offers.map((item) => item.vacancyId),
      ["v2", "v3", "v4", "v5", "v6"],
    );
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/routes/candidate-matches.test.ts`

Expected: FAIL on updated assertions (old single-object shape)

- [ ] **Step 3: Update router**

In `backend/src/routes/candidate-matches.ts`:

Replace import `getNextMatchOffer` → `getTopMatchOffers`.

Replace helpers:

```typescript
function offersPayload(offers: CandidateMatchOffer[]) {
  return {
    offers: offers.map((offer) => ({
      vacancyId: offer.vacancyId,
      title: offer.title,
      matchScore: offer.matchScore,
    })),
  };
}
```

Remove `emptyOfferPayload` and `offerPayload`.

Update `GET /matches/next`:

```typescript
const offers = await getTopMatchOffers(prisma, getLlmProvider(), candidateUserId);
res.status(200).json(offersPayload(offers));
```

Update `POST /matches/:vacancyId/reject`:

```typescript
const offers = await getTopMatchOffers(prisma, getLlmProvider(), candidateUserId);
res.status(200).json(offersPayload(offers));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/routes/candidate-matches.test.ts`

Expected: PASS (all route tests including accept unchanged)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-matches.ts backend/src/routes/candidate-matches.test.ts
git commit -m "feat: return top-5 offers from candidate matches API"
```

---

### Task 4: Frontend API client

**Files:**
- Modify: `frontend/src/api/candidate-matches.ts`

**Interfaces:**
- Consumes: backend `{ offers: [...] }` from Task 3
- Produces: `fetchNextMatch(): Promise<CandidateMatchOffersResponse>`, `rejectMatch(vacancyId): Promise<CandidateMatchOffersResponse>`

- [ ] **Step 1: Update types and functions**

Replace contents of `frontend/src/api/candidate-matches.ts` types section:

```typescript
export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
};

export type CandidateMatchOffersResponse = {
  offers: CandidateMatchOffer[];
};
```

Update `fetchNextMatch`:

```typescript
export async function fetchNextMatch(): Promise<CandidateMatchOffersResponse> {
  const response = await fetchWithAuth("/api/candidate/matches/next");
  if (!response.ok) {
    if (response.status === 503) {
      throw await parseError(response, "Підбір тимчасово недоступний");
    }
    throw await parseError(response, "Не вдалося завантажити вакансії");
  }
  return response.json() as Promise<CandidateMatchOffersResponse>;
}
```

Update `rejectMatch`:

```typescript
export async function rejectMatch(vacancyId: string): Promise<CandidateMatchOffersResponse> {
  const response = await fetchWithAuth(`/api/candidate/matches/${vacancyId}/reject`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 503) {
      throw await parseError(response, "Підбір тимчасово недоступний");
    }
    throw await parseError(response, "Не вдалося відхилити вакансію");
  }
  return response.json() as Promise<CandidateMatchOffersResponse>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npm run build`

Expected: FAIL until Task 5 updates `CandidateMatchesView.vue` (uses old single-offer shape)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/candidate-matches.ts
git commit -m "feat: update candidate matches API client for offers array"
```

---

### Task 5: Candidate matches list UI

**Files:**
- Modify: `frontend/src/views/CandidateMatchesView.vue`

**Interfaces:**
- Consumes: `CandidateMatchOffersResponse`, `fetchNextMatch`, `rejectMatch`, `acceptMatch`
- Produces: list UI with up to 5 rows, per-row Accept/Reject

- [ ] **Step 1: Update script — array state and handlers**

Replace single `offer` ref with `offers`:

```typescript
import {
  acceptMatch,
  fetchActiveApplication,
  fetchNextMatch,
  rejectMatch,
  type ActiveApplication,
  type CandidateMatchOffer,
} from "../api/candidate-matches";

const offers = ref<CandidateMatchOffer[]>([]);
const rejectingVacancyId = ref<string | null>(null);

function applyOffers(next: CandidateMatchOffer[]): void {
  offers.value = next;
  viewState.value = next.length > 0 ? "offer" : "empty";
}

async function loadMatches(): Promise<void> {
  viewState.value = "loading";
  errorMessage.value = null;
  application.value = null;
  offers.value = [];

  try {
    const active = await fetchActiveApplication();
    if (active?.status === "PENDING") {
      application.value = active;
      viewState.value = "pending";
      return;
    }

    const { offers: nextOffers } = await fetchNextMatch();
    applyOffers(nextOffers);
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося завантажити підбір";
  }
}

async function onReject(vacancyId: string): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  rejectingVacancyId.value = vacancyId;
  errorMessage.value = null;
  try {
    const { offers: nextOffers } = await rejectMatch(vacancyId);
    applyOffers(nextOffers);
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося відхилити вакансію";
  } finally {
    actionBusy.value = false;
    rejectingVacancyId.value = null;
  }
}

async function onAccept(vacancyId: string): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  errorMessage.value = null;
  try {
    const { application: created } = await acceptMatch(vacancyId);
    application.value = created;
    offers.value = [];
    viewState.value = "pending";
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося подати заявку";
  } finally {
    actionBusy.value = false;
  }
}
```

- [ ] **Step 2: Update template — list of offer rows**

Replace single offer section:

```vue
<section v-else-if="viewState === 'offer' && offers.length > 0" class="offers-list">
  <article
    v-for="item in offers"
    :key="item.vacancyId"
    class="offer-row"
  >
    <div class="offer-main">
      <h3 class="offer-title">{{ item.title }}</h3>
      <span class="offer-score-badge">{{ item.matchScore }}%</span>
    </div>
    <div class="actions">
      <button
        type="button"
        class="btn-secondary"
        :disabled="actionBusy"
        @click="onReject(item.vacancyId)"
      >
        {{
          rejectingVacancyId === item.vacancyId
            ? "Зачекайте…"
            : "Відхилити"
        }}
      </button>
      <button
        type="button"
        class="btn-primary"
        :disabled="actionBusy"
        @click="onAccept(item.vacancyId)"
      >
        {{ actionBusy ? "Зачекайте…" : "Прийняти" }}
      </button>
    </div>
  </article>
</section>
```

- [ ] **Step 3: Update styles**

Add/replace scoped styles:

```css
.offers-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.offer-row {
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}
.offer-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.offer-score-badge {
  flex-shrink: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #166534;
  background: #dcfce7;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
}
```

Remove unused `.offer-card` if fully replaced.

- [ ] **Step 4: Verify frontend build**

Run: `cd frontend && npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/CandidateMatchesView.vue
git commit -m "feat: show top-5 vacancy matches in candidate UI"
```

---

### Task 6: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Vacancy match section**

Find section `## Vacancy match & applications` and replace sequential wording:

```markdown
**Кандидат:** підтвердити профіль → `/candidate/matches` → бачить **топ-5** вакансій (назва + % match) → Accept / Reject на кожній → при Accept створюється заявка.

**Candidate / HR flow (EN):** candidate confirms profile → top-5 ranked matches (title + % only; no company data) → accept creates application + HR notification → HR opens applications inbox → manually creates interview from the application.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update vacancy match flow to top-5 list"
```

---

## Verification (final)

Run full backend test suite for touched files:

```bash
cd backend && npm test -- src/services/vacancy-match.test.ts src/routes/candidate-matches.test.ts
```

Run frontend build:

```bash
cd frontend && npm run build
```

Manual smoke (optional):

1. Confirm candidate profile
2. Open `/candidate/matches` — see up to 5 rows with % badges
3. Reject one — list refreshes, next vacancy appears if available
4. Accept one — pending status screen

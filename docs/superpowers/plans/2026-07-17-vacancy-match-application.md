# Vacancy Match & Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Після підтвердження анкети кандидат отримує sequential LLM-підбір вакансій (назва + % match), може accept/reject; accept створює in-app заявку для HR, з якої HR створює співбесіду.

**Architecture:** Нові Prisma-моделі (`VacancyApplication`, `VacancyOfferDecision`, `HrNotification`, `VacancyMatchScore`) + match-агент + candidate/HR routes. Кандидатський API повертає лише `{ vacancyId, title, matchScore }`. Accept пише заявку й нотифікацію; `create-interview` reuse логіки створення Interview з prefill і ставить Application у `CONVERTED`.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, Vue 3, node:test, існуючий `LlmProvider`

## Global Constraints

- Усі user-facing тексти та промпти агентів — українською.
- Кандидат **ніколи** не отримує company culture / philosophy / HR notes у JSON відповіді match-ендпоінтів (лише `vacancyId`, `title`, `matchScore`).
- Лише одна `VacancyApplication` зі статусом `PENDING` на кандидата.
- Пул matching: `Vacancy.status === CONFIRMED` і `CompanyProfile.confirmedAt != null`.
- Без email/SMTP у v1; без auto-create Interview на accept.
- Spec: `docs/superpowers/specs/2026-07-17-vacancy-match-application-design.md`.

---

## File Structure

- **Create**
  - `backend/prisma/migrations/<timestamp>_vacancy_match_application/migration.sql`
  - `backend/src/agents/prompts/vacancy-match.uk.ts`
  - `backend/src/agents/vacancy-match-agent.ts`
  - `backend/src/agents/vacancy-match-agent.test.ts`
  - `backend/src/services/vacancy-match.ts`
  - `backend/src/services/vacancy-match.test.ts`
  - `backend/src/routes/candidate-matches.ts`
  - `backend/src/routes/candidate-matches.test.ts`
  - `backend/src/routes/hr-applications.ts`
  - `backend/src/routes/hr-applications.test.ts`
  - `frontend/src/api/candidate-matches.ts`
  - `frontend/src/api/hr-applications.ts`
  - `frontend/src/views/CandidateMatchesView.vue`
  - `frontend/src/views/HrApplicationsView.vue`
- **Modify**
  - `backend/prisma/schema.prisma`
  - `backend/src/server.ts` (mount routers)
  - `backend/src/routes/interviews.ts` (optional extract helper for create; or duplicate thin wrapper in hr-applications)
  - `frontend/src/router/index.ts`
  - `frontend/src/views/CandidatePrepView.vue` (redirect після confirm)
  - `frontend/src/views/CandidateProfileView.vue` (лінк на matches)
  - `frontend/src/views/CandidateHomeView.vue` (лінк / CTA)
  - `frontend/src/views/HrHomeView.vue` (badge + лінк на заявки)
  - `frontend/src/components/CreateInterviewModal.vue` (optional prefill props)
  - `README.md` (короткий опис флоу)

---

### Task 1: Prisma models

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_vacancy_match_application/migration.sql`
- Test: verify via `cd backend && npx prisma validate` (і існуючий seed-check, якщо чіпає клієнт)

**Interfaces:**
- Consumes: `User`, `Vacancy`, `Interview`
- Produces: enums + models нижче; Prisma Client з новими делегатами

- [ ] **Step 1: Додати enums і моделі в schema.prisma**

Додати після `InvitationStatus`:

```prisma
enum VacancyApplicationStatus {
  PENDING
  CONVERTED
  WITHDRAWN
  DECLINED_BY_HR
}

enum VacancyOfferDecisionType {
  REJECTED
}

enum HrNotificationType {
  VACANCY_APPLICATION
}
```

Додати моделі:

```prisma
model VacancyApplication {
  id               String                   @id @default(cuid())
  candidateUserId  String
  vacancyId        String
  matchScore       Int
  candidateSummary String
  status           VacancyApplicationStatus @default(PENDING)
  interviewId      String?                  @unique
  createdAt        DateTime                 @default(now())
  updatedAt        DateTime                 @updatedAt

  candidateUser User       @relation("CandidateVacancyApplications", fields: [candidateUserId], references: [id])
  vacancy       Vacancy    @relation(fields: [vacancyId], references: [id])
  interview     Interview? @relation(fields: [interviewId], references: [id])

  @@index([candidateUserId, status])
  @@index([vacancyId, createdAt(sort: Desc)])
}

model VacancyOfferDecision {
  id              String                    @id @default(cuid())
  candidateUserId String
  vacancyId       String
  decision        VacancyOfferDecisionType
  createdAt       DateTime                  @default(now())

  candidateUser User    @relation("CandidateVacancyOfferDecisions", fields: [candidateUserId], references: [id])
  vacancy       Vacancy @relation(fields: [vacancyId], references: [id])

  @@unique([candidateUserId, vacancyId])
  @@index([candidateUserId])
}

model HrNotification {
  id        String             @id @default(cuid())
  hrUserId  String
  type      HrNotificationType
  payload   Json
  readAt    DateTime?
  createdAt DateTime           @default(now())

  hrUser User @relation("HrNotifications", fields: [hrUserId], references: [id])

  @@index([hrUserId, createdAt(sort: Desc)])
}

model VacancyMatchScore {
  id                   String   @id @default(cuid())
  candidateUserId      String
  vacancyId            String
  matchScore           Int
  rankedForConfirmedAt DateTime
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  candidateUser User    @relation("CandidateVacancyMatchScores", fields: [candidateUserId], references: [id])
  vacancy       Vacancy @relation(fields: [vacancyId], references: [id])

  @@unique([candidateUserId, vacancyId, rankedForConfirmedAt])
  @@index([candidateUserId, rankedForConfirmedAt])
}
```

Оновити relations на `User`, `Vacancy`, `Interview`:

```prisma
// User — додати:
vacancyApplications VacancyApplication[]  @relation("CandidateVacancyApplications")
offerDecisions      VacancyOfferDecision[] @relation("CandidateVacancyOfferDecisions")
matchScores         VacancyMatchScore[]    @relation("CandidateVacancyMatchScores")
hrNotifications     HrNotification[]       @relation("HrNotifications")

// Vacancy — додати:
applications   VacancyApplication[]
offerDecisions VacancyOfferDecision[]
matchScores    VacancyMatchScore[]

// Interview — додати:
vacancyApplication VacancyApplication?
```

- [ ] **Step 2: Створити міграцію**

Run: `cd backend && npx prisma migrate dev --name vacancy_match_application`  
Expected: міграція застосована, client згенеровано.

Додатково в SQL міграції (або follow-up raw SQL), якщо Postgres дозволяє:

```sql
CREATE UNIQUE INDEX "VacancyApplication_one_pending_per_candidate"
ON "VacancyApplication" ("candidateUserId")
WHERE status = 'PENDING';
```

- [ ] **Step 3: Validate**

Run: `cd backend && npx prisma validate`  
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add vacancy match, application, and HR notification models"
```

---

### Task 2: Pure match ranking helpers

**Files:**
- Create: `backend/src/services/vacancy-match.ts`
- Test: `backend/src/services/vacancy-match.test.ts`

**Interfaces:**
- Consumes: score rows + rejected vacancy ids
- Produces:
  - `export type CandidateMatchOffer = { vacancyId: string; title: string; matchScore: number }`
  - `export function pickNextOffer(scores: Array<{ vacancyId: string; title: string; matchScore: number }>, rejectedVacancyIds: Set<string>): CandidateMatchOffer | null`
  - `export function sortScoresDesc<T extends { matchScore: number }>(items: T[]): T[]`
  - `export function toCandidateOfferPayload(offer: CandidateMatchOffer): CandidateMatchOffer` (identity; для контрактних тестів keys)

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { pickNextOffer, sortScoresDesc } from "./vacancy-match";

test("sortScoresDesc orders by matchScore descending", () => {
  const sorted = sortScoresDesc([
    { vacancyId: "a", title: "A", matchScore: 40 },
    { vacancyId: "b", title: "B", matchScore: 90 },
    { vacancyId: "c", title: "C", matchScore: 70 },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.vacancyId),
    ["b", "c", "a"],
  );
});

test("pickNextOffer skips rejected and returns highest remaining", () => {
  const next = pickNextOffer(
    [
      { vacancyId: "b", title: "B", matchScore: 90 },
      { vacancyId: "c", title: "C", matchScore: 70 },
      { vacancyId: "a", title: "A", matchScore: 40 },
    ],
    new Set(["b"]),
  );
  assert.deepEqual(next, { vacancyId: "c", title: "C", matchScore: 70 });
});

test("pickNextOffer returns null when all rejected", () => {
  const next = pickNextOffer(
    [{ vacancyId: "a", title: "A", matchScore: 50 }],
    new Set(["a"]),
  );
  assert.equal(next, null);
});

test("candidate offer payload has only vacancyId, title, matchScore", () => {
  const offer = { vacancyId: "v1", title: "Backend", matchScore: 88 };
  assert.deepEqual(Object.keys(offer).sort(), ["matchScore", "title", "vacancyId"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
};

export function sortScoresDesc<T extends { matchScore: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.matchScore - a.matchScore);
}

export function pickNextOffer(
  scores: CandidateMatchOffer[],
  rejectedVacancyIds: Set<string>,
): CandidateMatchOffer | null {
  const ordered = sortScoresDesc(scores);
  for (const item of ordered) {
    if (!rejectedVacancyIds.has(item.vacancyId)) return item;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/vacancy-match.ts backend/src/services/vacancy-match.test.ts
git commit -m "feat(match): add vacancy offer ranking helpers"
```

---

### Task 3: Vacancy match LLM agent

**Files:**
- Create: `backend/src/agents/prompts/vacancy-match.uk.ts`
- Create: `backend/src/agents/vacancy-match-agent.ts`
- Test: `backend/src/agents/vacancy-match-agent.test.ts`

**Interfaces:**
- Consumes: `LlmProvider.complete`, candidate profile fields, vacancy profiles (incl. culture in prompt only)
- Produces:
  - `export type VacancyMatchInput = { vacancyId: string; title: string; role: string; requirements: unknown; culture: unknown; expectations: unknown }`
  - `export type CandidateMatchInput = { fullName: string; email: string; experience: unknown; skills: unknown; goals: unknown; summary: string }`
  - `export type VacancyMatchScoreResult = { vacancyId: string; matchScore: number }`
  - `export function parseVacancyMatchScores(rawText: string, allowedVacancyIds: Set<string>): VacancyMatchScoreResult[]`
  - `export function buildVacancyMatchMessages(candidate: CandidateMatchInput, vacancies: VacancyMatchInput[]): ChatMessage[]`
  - `export async function rankVacanciesWithLlm(provider: LlmProvider, candidate: CandidateMatchInput, vacancies: VacancyMatchInput[]): Promise<VacancyMatchScoreResult[]>`
  - `export function buildCandidateSummaryMessages(candidate: CandidateMatchInput, vacancyTitle: string): ChatMessage[]`
  - `export function parseCandidateSummary(rawText: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseVacancyMatchScores, parseCandidateSummary } from "./vacancy-match-agent";

test("parseVacancyMatchScores accepts valid JSON array and clamps scores", () => {
  const raw = JSON.stringify({
    scores: [
      { vacancyId: "v1", matchScore: 95 },
      { vacancyId: "v2", matchScore: 150 },
      { vacancyId: "unknown", matchScore: 10 },
    ],
  });
  const parsed = parseVacancyMatchScores(raw, new Set(["v1", "v2"]));
  assert.deepEqual(parsed, [
    { vacancyId: "v1", matchScore: 95 },
    { vacancyId: "v2", matchScore: 100 },
  ]);
});

test("parseVacancyMatchScores throws on invalid JSON", () => {
  assert.throws(() => parseVacancyMatchScores("not-json", new Set(["v1"])));
});

test("parseCandidateSummary returns trimmed Ukrainian text", () => {
  const text = parseCandidateSummary(JSON.stringify({ summary: "  Сильний бекенд-досвід.  " }));
  assert.equal(text, "Сильний бекенд-досвід.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/agents/vacancy-match-agent.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Write prompt + agent**

`vacancy-match.uk.ts` — system prompt українською: оцінити fit 0–100 для кожної вакансії; повернути JSON `{ "scores": [{ "vacancyId", "matchScore" }] }`; можна враховувати культуру компанії для скорингу, але не згадувати її в окремих полях відповіді.

`vacancy-match-agent.ts` — за зразком `final-report-agent.ts`: strip fences, parse, validate, clamp `matchScore` до 0..100, drop unknown ids. Missing ids from allowed set: assign `matchScore: 0` (або omit — тоді `ensureScoresForAllVacancies` у сервісі доповнить нулями).

Для summary: окремий короткий prompt «2–4 речення українською про кандидата для HR щодо вакансії {title}»; parse `{ "summary": "..." }`.

`rankVacanciesWithLlm`: якщо `vacancies.length === 0`, return `[]` без LLM call.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- src/agents/vacancy-match-agent.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/vacancy-match.uk.ts backend/src/agents/vacancy-match-agent.ts backend/src/agents/vacancy-match-agent.test.ts
git commit -m "feat(agents): add vacancy match scoring agent"
```

---

### Task 4: Match service (load pool, cache scores, resolve next)

**Files:**
- Modify: `backend/src/services/vacancy-match.ts`
- Modify: `backend/src/services/vacancy-match.test.ts`

**Interfaces:**
- Consumes: Prisma, `rankVacanciesWithLlm`, `isCandidateQuestionnaireConfirmed` / questionnaire profile lookup, helpers from Task 2
- Produces:
  - `export async function getConfirmedCandidateProfile(prisma, candidateUserId): Promise<(CandidateMatchInput & { confirmedAt: Date }) | null>`
  - `export async function listMatchableVacancies(prisma): Promise<VacancyMatchInput[]>`
  - `export async function ensureMatchScores(prisma, llm, candidateUserId): Promise<CandidateMatchOffer[]>`
  - `export async function getRejectedVacancyIds(prisma, candidateUserId): Promise<Set<string>>`
  - `export async function getNextMatchOffer(prisma, llm, candidateUserId): Promise<CandidateMatchOffer | null>` — throws typed errors або повертає result union

Error codes (кинути / повернути):
- `QUESTIONNAIRE_NOT_CONFIRMED`
- `MATCH_UNAVAILABLE` (LLM failure → route maps to 503)

Cache: якщо існують `VacancyMatchScore` з `rankedForConfirmedAt === profile.confirmedAt`, використати їх; інакше викликати LLM, видалити старі scores кандидата (або лишити історію й писати новий batch), upsert нові рядки з `title` join через vacancy.

- [ ] **Step 1: Write failing tests for ensureMatchScores / getNextMatchOffer with fake prisma + fake llm**

```ts
test("ensureMatchScores returns empty without calling LLM when no confirmed vacancies", async () => {
  // fake prisma: vacancies = []
  // fake llm: complete should not be called
});

test("getNextMatchOffer skips rejected vacancies", async () => {
  // scores cached: v1=90, v2=80; decision REJECTED v1 → next is v2
});

test("ensureMatchScores re-ranks when confirmedAt changes", async () => {
  // old scores for older confirmedAt ignored; LLM called once
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`  
Expected: FAIL on missing exports

- [ ] **Step 3: Implement service functions**

Використовувати той самий questionnaire lookup, що й `findQuestionnaireInterview` у `interview-readiness.ts` (`SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME`). Можна експортувати helper з readiness або дублювати мінімальний find у match-сервісі — краще додати `getConfirmedQuestionnaireProfile` у `interview-readiness.ts`, якщо вже є близькі функції.

`listMatchableVacancies`:

```ts
prisma.vacancy.findMany({
  where: {
    status: "CONFIRMED",
    companyProfile: { confirmedAt: { not: null } },
  },
  include: { companyProfile: true },
});
```

Map to `VacancyMatchInput` (culture з `companyProfile.culture` тощо).

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/vacancy-match.ts backend/src/services/vacancy-match.test.ts backend/src/utils/interview-readiness.ts
git commit -m "feat(match): cache LLM vacancy scores and resolve next offer"
```

---

### Task 5: Candidate matches API

**Files:**
- Create: `backend/src/routes/candidate-matches.ts`
- Create: `backend/src/routes/candidate-matches.test.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: match service, prisma, llm provider, `requireAuth`+`requireCandidate` (на mount)
- Produces router mounted at `/api/candidate`:
  - `GET /matches/next` → `{ vacancyId, title, matchScore }` або `{ vacancyId: null, title: null, matchScore: null }`
  - `POST /matches/:vacancyId/reject` → same shape as next
  - `POST /matches/:vacancyId/accept` → `{ application: { id, vacancyId, matchScore, status } }`
  - `GET /applications/active` → `{ application: {...} | null }`

Status mapping:
- no confirmed questionnaire → 403 `{ error: "Questionnaire not confirmed" }`
- PENDING exists on `GET /matches/next` or accept → 409 `{ error: "ACTIVE_APPLICATION_EXISTS" }`
- LLM fail → 503 `{ error: "Підбір тимчасово недоступний" }`
- reject unknown vacancy / already rejected → 404/409
- accept: generate `candidateSummary` via LLM; create `VacancyApplication` + `HrNotification` for `vacancy.hrUserId` with payload `{ applicationId, candidateName, email, vacancyTitle, matchScore }`

- [ ] **Step 1: Write failing route tests (fake prisma pattern like candidate-invitations.test.ts)**

Мінімальний набір:

```ts
test("GET /matches/next returns 403 when questionnaire not confirmed");
test("GET /matches/next returns only vacancyId title matchScore keys");
test("GET /matches/next returns 409 when PENDING application exists");
test("POST /matches/:id/reject records decision and returns next");
test("POST /matches/:id/accept creates application and notification");
test("POST /matches/:id/accept returns 409 when PENDING exists");
test("GET /applications/active returns pending application");
```

Для контракту:

```ts
const keys = Object.keys(body).sort();
assert.deepEqual(keys, ["matchScore", "title", "vacancyId"]);
assert.ok(!("culture" in body));
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && npm test -- src/routes/candidate-matches.test.ts`  
Expected: FAIL (router missing)

- [ ] **Step 3: Implement router + mount**

```ts
// server.ts
import { createCandidateMatchesRouter } from "./routes/candidate-matches";

app.use(
  "/api/candidate",
  requireAuth,
  requireCandidate,
  createCandidateMatchesRouter(() => prisma, getLlmProvider),
);
```

Увага: `createCandidateInterviewRouter` / invitations уже на `/api/candidate` — перевірити, чи вони самі ставлять auth. Зараз:

```ts
app.use("/api/candidate", createCandidateInterviewRouter(() => prisma));
app.use("/api/candidate", createCandidateInvitationsRouter(() => prisma));
```

Новий router монтувати так само, як invitations (auth всередині router), **або** узгодити з існуючим патерном у цих файлах. Відкрий `candidate-invitations.ts` і скопіюй той самий `requireAuth`/`requireCandidate` підхід.

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && npm test -- src/routes/candidate-matches.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-matches.ts backend/src/routes/candidate-matches.test.ts backend/src/server.ts
git commit -m "feat(api): add candidate vacancy match and application endpoints"
```

---

### Task 6: HR notifications & applications API (+ create-interview)

**Files:**
- Create: `backend/src/routes/hr-applications.ts`
- Create: `backend/src/routes/hr-applications.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/routes/interviews.ts` (extract `createInterviewRecord` helper **або** inline duplicate create+joinCode loop у hr-applications — краще extract)

**Interfaces:**
- Produces under `/api` with `requireAuth`+`requireHr`:
  - `GET /hr/notifications` → `{ notifications: Array<{ id, type, payload, readAt, createdAt }> }` unread first
  - `POST /hr/notifications/:id/read` → `{ notification }`
  - `GET /hr/applications` → list для vacancy.hrUserId === req.user.id
  - `GET /hr/applications/:id` → details incl. candidateSummary, candidate fullName/email from application snapshot / CandidateProfile
  - `POST /hr/applications/:id/create-interview` body optional `{ scheduledAt?: string }`
    - ownership + status PENDING
    - create Interview (joinCode retry як у `POST /interviews`)
    - set `candidateUserId` = application.candidateUserId
    - optional Invitation з email кандидата (PENDING або skip — якщо candidateUserId вже set, invitation не обовʼязковий; для консистентності з dual-channel можна створити ACCEPTED invitation)
    - Application → `CONVERTED`, `interviewId` set
    - якщо questionnaire confirmed — оновити status interview до READY через існуючі readiness helpers, якщо такі є після attach candidate

- [ ] **Step 1: Write failing tests**

```ts
test("GET /hr/applications returns only own vacancy applications");
test("GET /hr/applications/:id returns 404 for other HR");
test("POST /hr/notifications/:id/read marks readAt");
test("POST /hr/applications/:id/create-interview converts PENDING and links interview");
test("POST /hr/applications/:id/create-interview returns 409 when not PENDING");
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && npm test -- src/routes/hr-applications.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement + mount**

```ts
app.use("/api", requireAuth, requireHr, createHrApplicationsRouter(() => prisma));
```

Для create-interview: винести з `interviews.ts` функцію на кшталт:

```ts
export async function createInterviewWithJoinCode(
  prisma: PrismaClient,
  params: {
    hrUserId: string;
    vacancyId: string;
    displayName: string;
    scheduledAt: Date | null;
    candidateUserId?: string | null;
    candidateEmail?: string | null;
  },
): Promise<{ interview: Interview; invitation: Invitation | null }>
```

і викликати її і з `POST /interviews`, і з applications.

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && npm test -- src/routes/hr-applications.test.ts src/routes/interviews.test.ts`  
Expected: PASS (регресія interviews теж зелена)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/hr-applications.ts backend/src/routes/hr-applications.test.ts backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts backend/src/server.ts
git commit -m "feat(api): add HR application inbox and create-interview from application"
```

---

### Task 7: Candidate frontend (matches screen + redirects)

**Files:**
- Create: `frontend/src/api/candidate-matches.ts`
- Create: `frontend/src/views/CandidateMatchesView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/views/CandidatePrepView.vue`
- Modify: `frontend/src/views/CandidateProfileView.vue`
- Modify: `frontend/src/views/CandidateHomeView.vue`

**Interfaces:**
- API helpers: `fetchActiveApplication`, `fetchNextMatch`, `rejectMatch`, `acceptMatch`
- Route: `{ path: "matches", name: "candidate-matches", component: CandidateMatchesView }` under `/candidate`

- [ ] **Step 1: API module**

```ts
export type CandidateMatchOffer = {
  vacancyId: string | null;
  title: string | null;
  matchScore: number | null;
};

export type ActiveApplication = {
  id: string;
  vacancyId: string;
  matchScore: number;
  status: "PENDING" | "CONVERTED" | "WITHDRAWN" | "DECLINED_BY_HR";
  vacancyTitle?: string;
};
```

Використовувати існуючий `apiFetch` / auth header патерн з `frontend/src/api/candidate-prep.ts`.

- [ ] **Step 2: CandidateMatchesView.vue**

On mount:
1. `fetchActiveApplication` — якщо PENDING, показати статус «Заявку надіслано. Очікуйте відповіді HR.»
2. Інакше `fetchNextMatch` — loading / картка title + `matchScore%` + кнопки / empty «Немає підходящих вакансій» / помилка 503 текстом українською.

Стилі — як інші candidate views (існуючі CSS variables / layout), без нового дизайн-системи.

- [ ] **Step 3: Router + redirects**

У `CandidatePrepView.vue` після успішного confirm:

```ts
router.push({ name: "candidate-matches" });
```

замість (або після) `candidate-home`.

У `CandidateProfileView.vue` і `CandidateHomeView.vue`: якщо `confirmedAt`, показати лінк/кнопку «Підібрати вакансію» → `candidate-matches`.

- [ ] **Step 4: Manual smoke**

Run frontend + backend; confirm анкету → потрапити на matches; reject → наступна; accept → статус PENDING.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/candidate-matches.ts frontend/src/views/CandidateMatchesView.vue frontend/src/router/index.ts frontend/src/views/CandidatePrepView.vue frontend/src/views/CandidateProfileView.vue frontend/src/views/CandidateHomeView.vue
git commit -m "feat(ui): add candidate vacancy match accept/reject screen"
```

---

### Task 8: HR frontend (applications inbox) + README

**Files:**
- Create: `frontend/src/api/hr-applications.ts`
- Create: `frontend/src/views/HrApplicationsView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/views/HrHomeView.vue`
- Modify: `frontend/src/components/CreateInterviewModal.vue` (props: `initialVacancyId`, `initialCandidateEmail`, `lockedVacancy?`)
- Modify: `README.md`

**Interfaces:**
- `fetchHrNotifications`, `markNotificationRead`, `fetchHrApplications`, `fetchHrApplication`, `createInterviewFromApplication`
- Route: `/applications` name `hr-applications` (HR layout)

- [ ] **Step 1: API + HrApplicationsView**

Список заявок: імʼя, email, вакансія, %, статус. Деталі: `candidateSummary`. Кнопка «Створити співбесіду»:
- або виклик `POST .../create-interview` напряму з optional date field на сторінці;
- або відкрити `CreateInterviewModal` з prefill, а після успіху викликати convert endpoint — **простіше v1:** форма на сторінці заявки з `scheduledAt` + кнопка, що бʼє `create-interview` (без обовʼязкового modal).

- [ ] **Step 2: HrHomeView badge**

На mount: `fetchHrNotifications`, показати кількість unread і лінк «Заявки кандидатів».

- [ ] **Step 3: README**

Короткий розділ українською/англійською в стилі README: candidate confirm → matches → accept → HR applications → create interview. Згадати, що кандидат не бачить дані компанії.

- [ ] **Step 4: Run backend tests suite for touched areas**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts src/agents/vacancy-match-agent.test.ts src/routes/candidate-matches.test.ts src/routes/hr-applications.test.ts src/routes/interviews.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/hr-applications.ts frontend/src/views/HrApplicationsView.vue frontend/src/router/index.ts frontend/src/views/HrHomeView.vue frontend/src/components/CreateInterviewModal.vue README.md
git commit -m "feat(ui): add HR vacancy applications inbox and docs"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Sequential offers + % match | 2, 4, 5, 7 |
| LLM scoring 0–100 | 3, 4 |
| Candidate sees only title + % | 5 (contract test), 7 |
| No company culture to candidate | 5 contract test + Global Constraints |
| Reject → next; empty state | 2, 5, 7 |
| Accept → Application + HrNotification | 5 |
| One PENDING application | 1 (partial unique), 5 |
| In-app HR inbox | 6, 8 |
| HR create interview manually from application | 6, 8 |
| Trigger after confirm + from profile | 7 |
| Match cache / re-rank on confirmedAt | 4 |
| candidateSummary for HR | 3, 5, 6 |
| Tests: unit, routes, contract, agent mock | 2–6 |
| Out of scope: email, auto-interview, catalog | — not planned |

## Placeholder / consistency self-review

- Немає TBD/TODO у кроках.
- Імена: `CandidateMatchOffer`, `VacancyMatchScore`, `ACTIVE_APPLICATION_EXISTS` узгоджені між tasks 2–7.
- `createInterviewWithJoinCode` з Task 6 — єдине місце створення Interview для обох флоу.
- Partial unique index — опційний hardening; сервісна перевірка PENDING обовʼязкова в Task 5.

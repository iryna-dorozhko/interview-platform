# Candidate Contact Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати стартовий збір контактних даних кандидата (ім'я, email, телефон) у prep-діалозі та зберігати їх у `CandidateProfile` без блокування flow при повторній відмові від телефону.

**Architecture:** Розширюємо контракт `CandidateProfile` на рівні Prisma, extraction prompt і parse-функції, після чого зберігаємо нові поля в `POST /api/candidate-prep/:interviewId/finish`. Email у профілі має fallback на `req.user.email`. UI сторінки профілю кандидата показує новий блок контактних даних.

**Tech Stack:** TypeScript, Node.js, Express, Prisma, Vue 3, node:test

## Global Constraints

- Усі тексти для користувача та промпти агентів — українською.
- Не змінювати поточну модель auth (`User`), лише розширити `CandidateProfile`.
- `phone` у `CandidateProfile` має бути nullable (`String?`) і не блокує завершення анкети.
- Якщо extraction не дає email, `finish` обов'язково підставляє `req.user.email`.
- Зберегти чинний flow `READY:true` / `READY:false`, додавши pre-phase збору контактів.

---

## File Structure

- **Create**
  - `backend/prisma/migrations/<timestamp>_candidate_profile_contact_fields/migration.sql`
  - `docs/manual-test-dialogues.uk.md` (додати нові ручні сценарії, якщо файл уже ведеться як чекліст)
- **Modify**
  - `backend/prisma/schema.prisma`
  - `backend/src/agents/prompts/candidate-agent.uk.ts`
  - `backend/src/agents/prompts/candidate-profile-extraction.uk.ts`
  - `backend/src/agents/candidate-agent.ts`
  - `backend/src/agents/candidate-agent.test.ts`
  - `backend/src/routes/candidate-prep.ts`
  - `backend/src/routes/candidate-prep.test.ts`
  - `frontend/src/api/candidate-prep.ts`
  - `frontend/src/views/CandidateProfileView.vue`
  - `README.md` (коротко: нові поля профілю кандидата)

---

### Task 1: Data Model and API Contract

**Files:**
- Create: `backend/prisma/migrations/<timestamp>_candidate_profile_contact_fields/migration.sql`
- Modify: `backend/prisma/schema.prisma`
- Modify: `frontend/src/api/candidate-prep.ts`
- Test: `backend/src/routes/candidate-prep.test.ts`

**Interfaces:**
- Consumes: існуючий `CandidateProfile` (`experience`, `skills`, `goals`, `summary`, `confirmedAt`)
- Produces:
  - Prisma model:
    - `fullName: string`
    - `email: string`
    - `phone: string | null`
  - Frontend type `CandidateProfile` з новими полями

- [ ] **Step 1: Write the failing test**

```ts
test("finish persists contact fields in candidate profile", async () => {
  // arrange: extraction returns fullName/email/phone + existing fields
  // act: POST /api/candidate-prep/:interviewId/finish
  // assert: response.profile.fullName/email/phone exist
  // and db candidateProfile has those fields persisted
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/routes/candidate-prep.test.ts`  
Expected: FAIL with missing `fullName/email/phone` in schema or response payload.

- [ ] **Step 3: Write minimal implementation**

```prisma
model CandidateProfile {
  id          String    @id @default(cuid())
  interviewId String    @unique
  fullName    String
  email       String
  phone       String?
  experience  Json
  skills      Json
  goals       Json
  summary     String
  confirmedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  interview   Interview @relation(fields: [interviewId], references: [id])
}
```

```ts
export type CandidateProfile = {
  fullName: string;
  email: string;
  phone: string | null;
  experience: string[];
  skills: { strong: string[]; growth: string[] };
  goals: string[];
  summary: string;
  confirmedAt: string | null;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- src/routes/candidate-prep.test.ts`  
Expected: PASS for contact-field persistence case.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations frontend/src/api/candidate-prep.ts backend/src/routes/candidate-prep.test.ts
git commit -m "feat(profile): add candidate contact fields to candidate profile model"
```

---

### Task 2: Candidate Agent Prompt + Extraction Parsing

**Files:**
- Modify: `backend/src/agents/prompts/candidate-agent.uk.ts`
- Modify: `backend/src/agents/prompts/candidate-profile-extraction.uk.ts`
- Modify: `backend/src/agents/candidate-agent.ts`
- Test: `backend/src/agents/candidate-agent.test.ts`

**Interfaces:**
- Consumes: `buildCandidateAgentMessages(history)` and `parseCandidateProfileExtraction(rawText)`
- Produces:
  - `ExtractedCandidateProfile`:
    - `fullName: string`
    - `email: string`
    - `phone: string | null`
    - existing profile fields unchanged

- [ ] **Step 1: Write the failing test**

```ts
test("candidate prompt includes contact bootstrap rules", () => {
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /представ/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /email.*реєстрац/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /телефон.*поясн/i);
});

test("parseCandidateProfileExtraction parses full contact payload", () => {
  const parsed = parseCandidateProfileExtraction(JSON.stringify({
    fullName: "Іван Петренко",
    email: "ivan@example.com",
    phone: null,
    experience: ["3 роки backend"],
    skills: { strong: ["TypeScript"], growth: ["публічні виступи"] },
    goals: ["Senior role"],
    summary: "Сильний backend-фахівець."
  }));
  assert.equal(parsed.phone, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/agents/candidate-agent.test.ts`  
Expected: FAIL, бо промпт/типи extraction ще не містять контактні поля.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ExtractedCandidateProfile {
  fullName: string;
  email: string;
  phone: string | null;
  experience: string[];
  skills: { strong: string[]; growth: string[] };
  goals: string[];
  summary: string;
}
```

```ts
function toOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}
```

```ts
const fullName = String((data as Record<string, unknown>).fullName ?? "").trim();
const email = String((data as Record<string, unknown>).email ?? "").trim().toLowerCase();
const phone = toOptionalString((data as Record<string, unknown>).phone);
if (!fullName) throw new CandidateProfileExtractionError("missing or invalid field: fullName");
if (!email) throw new CandidateProfileExtractionError("missing or invalid field: email");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- src/agents/candidate-agent.test.ts`  
Expected: PASS for prompt and parser cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/candidate-agent.uk.ts backend/src/agents/prompts/candidate-profile-extraction.uk.ts backend/src/agents/candidate-agent.ts backend/src/agents/candidate-agent.test.ts
git commit -m "feat(candidate-agent): add contact bootstrap and extraction fields"
```

---

### Task 3: Finish Route Persistence + Email Fallback

**Files:**
- Modify: `backend/src/routes/candidate-prep.ts`
- Test: `backend/src/routes/candidate-prep.test.ts`

**Interfaces:**
- Consumes: `ExtractedCandidateProfile` from Task 2, `req.user.email`
- Produces:
  - `finish` response:
    - `profile.fullName`
    - `profile.email`
    - `profile.phone`
  - DB persistence with fallback rule:
    - if extracted email empty/invalid -> use `req.user.email`

- [ ] **Step 1: Write the failing test**

```ts
test("finish falls back to authenticated user email when extraction email missing", async () => {
  // mock extraction result with empty email
  // call finish as authenticated candidate with req.user.email = "auth@example.com"
  // expect response.profile.email === "auth@example.com"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/routes/candidate-prep.test.ts`  
Expected: FAIL because fallback is not implemented.

- [ ] **Step 3: Write minimal implementation**

```ts
const fallbackEmail = req.user?.email?.trim().toLowerCase() ?? "";
const normalizedExtractedEmail = extracted.email.trim().toLowerCase();
const persistedEmail = normalizedExtractedEmail || fallbackEmail;

if (!persistedEmail) {
  res.status(502).json({ error: "LLM unavailable", detail: "missing email for candidate profile" });
  return;
}
```

```ts
update: {
  fullName: extracted.fullName,
  email: persistedEmail,
  phone: extracted.phone,
  experience: extracted.experience,
  skills: extracted.skills,
  goals: extracted.goals,
  summary: extracted.summary,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- src/routes/candidate-prep.test.ts`  
Expected: PASS for fallback and persistence cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/candidate-prep.ts backend/src/routes/candidate-prep.test.ts
git commit -m "fix(candidate-prep): persist contact fields with auth email fallback"
```

---

### Task 4: Candidate Profile UI Contact Block

**Files:**
- Modify: `frontend/src/views/CandidateProfileView.vue`
- Modify: `frontend/src/api/candidate-prep.ts`
- Test: `frontend` component test file if present; otherwise manual verification in `docs/manual-test-dialogues.uk.md`

**Interfaces:**
- Consumes: `CandidateProfile` with new contact fields
- Produces: UI section "Контактні дані" with graceful fallback for `phone: null`

- [ ] **Step 1: Write the failing test**

```ts
// If project has Vue test harness:
it("renders contact block with fallback dash when phone missing", async () => {
  // mount CandidateProfileView with profile.phone = null
  // expect text: "Контактні дані", "—"
});
```

```md
<!-- If no automated frontend test exists, add manual QA checklist entry -->
- Відкрити /candidate/profile після finish: блок "Контактні дані" містить ім'я, email, телефон.
- Для phone = null відображається "—".
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test` (якщо налаштовано)  
Expected: FAIL on missing contact section, або N/A якщо тести не налаштовані.

- [ ] **Step 3: Write minimal implementation**

```vue
<dt>Ім'я</dt>
<dd>{{ profile.fullName }}</dd>
<dt>Email</dt>
<dd>{{ profile.email }}</dd>
<dt>Телефон</dt>
<dd>{{ profile.phone ?? "—" }}</dd>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run build`  
Expected: PASS, сторінка компілюється з новими полями типів.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/CandidateProfileView.vue frontend/src/api/candidate-prep.ts docs/manual-test-dialogues.uk.md
git commit -m "feat(candidate-ui): show contact details in candidate profile view"
```

---

### Task 5: Docs and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-test-dialogues.uk.md`

**Interfaces:**
- Consumes: implemented behavior from Tasks 1-4
- Produces: актуальна документація та repeatable verification commands

- [ ] **Step 1: Write failing docs-check task**

```md
Add a section describing:
- startup contact bootstrap order (name, registration email prompt, phone retry)
- email fallback to authenticated account
- optional phone behavior after second refusal
```

- [ ] **Step 2: Run docs-check**

Run: `rg "fullName|email fallback|phone" README.md docs/manual-test-dialogues.uk.md`  
Expected: before update matches are incomplete.

- [ ] **Step 3: Write docs updates**

```md
### Candidate contact bootstrap
1. Candidate Agent introduces itself.
2. Collects full name.
3. Asks for registration email as additional contact method.
4. If email not provided, backend stores authenticated email.
5. Asks phone; retries once with explanation; allows continue without phone.
```

- [ ] **Step 4: Run full verification**

Run: `npm run build && cd backend && npm test -- src/agents/candidate-agent.test.ts src/routes/candidate-prep.test.ts`  
Expected: PASS for build and updated backend tests.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/manual-test-dialogues.uk.md
git commit -m "docs: document candidate contact bootstrap flow"
```

---

## Spec-to-Plan Self-Review

- **Spec coverage:** Усі ключові вимоги зі spec покриті задачами:
  - стартове представлення + збір `fullName/email/phone` -> Task 2
  - повторний запит телефону з поясненням -> Task 2
  - fallback email на `req.user.email` -> Task 3
  - персистентність у `CandidateProfile` -> Tasks 1, 3
  - відображення у профілі кабінету -> Task 4
  - тести й документація -> Tasks 1-5
- **Placeholder scan:** "TBD/TODO/implement later" відсутні; кожен кодовий крок має конкретні фрагменти.
- **Type consistency:** `fullName/email/phone` використовуються однаково в Prisma, parse-типі, route persistence і frontend API типі.


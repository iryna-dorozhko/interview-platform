# Vacancy Work Conditions & Company AI Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Збирати умови роботи per-vacancy в HR-анкеті, давати live AI компанії відповідати кандидату з профілю, показувати зарплату + формат у match-картці.

**Architecture:** Два нові JSON-поля на `CompanyProfile` (`workConditions`, `compensation`); розширення vacancy Company Agent + extraction; нова Arbiter-команда `COMPANY_ANSWER` → Company Live `ANSWER_CANDIDATE`; display-хелпери для match API без зміни LLM scoring.

**Tech Stack:** TypeScript, Vue 3, Prisma, PostgreSQL, node:test, Socket.io orchestrator

## Global Constraints

- Усі тексти для користувача та промпти агентів — українською.
- Умови роботи — **per-vacancy** (не в global Company Profile Agent).
- Зарплата — гібрид: `{ min?, max?, currency?, grossNet?, displayText }`; `displayText` обов'язковий.
- `workConditions` — `string[]` з префіксами: `Формат:`, `Графік:`, `Бенефіти:`, `Релокація:`, `Випробувальний:`, `Обладнання:`.
- Match scoring **не змінюємо**; лише display-поля в offer payload.
- Match-картка кандидата показує **лише** `salaryDisplay` + `workFormatDisplay`; решта — через live AI.
- Global Company Profile Agent — без змін.
- Legacy вакансії без backfill: порожні `workConditions` → live AI делегує HR.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Нові поля `workConditions`, `compensation` |
| `backend/src/utils/vacancy-work-conditions.ts` | `VacancyCompensation`, парсинг/display-хелпери |
| `backend/src/agents/prompts/company-agent.uk.ts` | 4-та тема «Умови роботи» |
| `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts` | Extraction JSON з новими полями |
| `backend/src/agents/company-agent.ts` | `ExtractedVacancyProfile`, парсер |
| `backend/src/routes/prep.ts` | serialize / patch / finish |
| `frontend/src/api/prep.ts` | Тип `CompanyProfile` |
| `frontend/src/views/VacancyPrepView.vue` | Секція «Умови роботи» |
| `backend/src/agents/live-agent-turn-context.ts` | `ANSWER_CANDIDATE` у turn context |
| `backend/src/agents/company-live-agent.ts` | Розширений profile context + nudge |
| `backend/src/agents/arbiter-agent.ts` | `COMPANY_ANSWER` action + context |
| `backend/src/socket/orchestrator.ts` | Routing `COMPANY_ANSWER` → Company |
| `backend/src/services/vacancy-match.ts` | `salaryDisplay`, `workFormatDisplay` на offers |
| `frontend/src/api/candidate-matches.ts` | Розширений `CandidateMatchOffer` |
| `frontend/src/views/CandidateMatchesView.vue` | UI мета-рядки |
| `docs/manual-test-dialogues.uk.md` | HR-відповіді для умов вакансії |

---

### Task 1: Prisma Schema & Shared Types

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `CompanyProfile`)
- Create: `backend/src/utils/vacancy-work-conditions.ts`
- Create: `backend/src/utils/vacancy-work-conditions.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `VacancyCompensation` type
  - `WORK_CONDITION_PREFIXES` constant
  - `parseVacancyCompensation(value: unknown): VacancyCompensation | null`
  - `formatSalaryDisplay(compensation: unknown): string | null`
  - `formatWorkFormatDisplay(workConditions: unknown): string | null`
  - `parseWorkConditionsArray(value: unknown): string[]`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/utils/vacancy-work-conditions.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSalaryDisplay,
  formatWorkFormatDisplay,
  parseVacancyCompensation,
  parseWorkConditionsArray,
} from "./vacancy-work-conditions";

test("formatSalaryDisplay returns displayText when present", () => {
  assert.equal(
    formatSalaryDisplay({ displayText: "$3000–4500 gross, USD" }),
    "$3000–4500 gross, USD",
  );
});

test("formatSalaryDisplay returns null for missing or не вказано", () => {
  assert.equal(formatSalaryDisplay(null), null);
  assert.equal(formatSalaryDisplay({ displayText: "не вказано" }), null);
});

test("formatWorkFormatDisplay strips Формат prefix", () => {
  assert.equal(
    formatWorkFormatDisplay(["Формат: remote, 2 дні в офісі"]),
    "remote, 2 дні в офісі",
  );
});

test("formatWorkFormatDisplay returns null for не вказано", () => {
  assert.equal(formatWorkFormatDisplay(["Формат: не вказано"]), null);
});

test("parseVacancyCompensation requires displayText", () => {
  assert.deepEqual(parseVacancyCompensation({ displayText: "5000 USD gross" }), {
    displayText: "5000 USD gross",
  });
  assert.equal(parseVacancyCompensation({ min: 1000 }), null);
});

test("parseWorkConditionsArray validates string array", () => {
  assert.deepEqual(parseWorkConditionsArray(["Формат: remote"]), ["Формат: remote"]);
  assert.deepEqual(parseWorkConditionsArray([]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/utils/vacancy-work-conditions.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Add schema fields and implement helpers**

In `backend/prisma/schema.prisma`, inside `model CompanyProfile`:

```prisma
  workConditions  Json     @default("[]")
  compensation    Json?
```

Create `backend/src/utils/vacancy-work-conditions.ts`:

```ts
export type VacancyCompensation = {
  min?: number;
  max?: number;
  currency?: string;
  grossNet?: "gross" | "net";
  displayText: string;
};

export const WORK_CONDITION_PREFIXES = [
  "Формат:",
  "Графік:",
  "Бенефіти:",
  "Релокація:",
  "Випробувальний:",
  "Обладнання:",
] as const;

const NOT_SPECIFIED = "не вказано";

export function parseWorkConditionsArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseVacancyCompensation(value: unknown): VacancyCompensation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.displayText !== "string" || !record.displayText.trim()) return null;
  const result: VacancyCompensation = { displayText: record.displayText.trim() };
  if (typeof record.min === "number") result.min = record.min;
  if (typeof record.max === "number") result.max = record.max;
  if (typeof record.currency === "string") result.currency = record.currency;
  if (record.grossNet === "gross" || record.grossNet === "net") result.grossNet = record.grossNet;
  return result;
}

export function formatSalaryDisplay(compensation: unknown): string | null {
  const parsed = parseVacancyCompensation(compensation);
  if (!parsed) return null;
  const text = parsed.displayText.trim();
  if (!text || text.toLowerCase() === NOT_SPECIFIED) return null;
  return text;
}

export function formatWorkFormatDisplay(workConditions: unknown): string | null {
  const items = parseWorkConditionsArray(workConditions);
  const formatLine = items.find((item) => item.startsWith("Формат:"));
  if (!formatLine) return null;
  const value = formatLine.slice("Формат:".length).trim();
  if (!value || value.toLowerCase() === NOT_SPECIFIED) return null;
  return value;
}
```

Run migration:

```bash
cd backend && npx prisma migrate dev --name add_vacancy_work_conditions
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- src/utils/vacancy-work-conditions.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/utils/vacancy-work-conditions.ts backend/src/utils/vacancy-work-conditions.test.ts
git commit -m "feat(db): add vacancy workConditions and compensation fields"
```

---

### Task 2: Vacancy Company Agent Prompt & Extraction Parser

**Files:**
- Modify: `backend/src/agents/prompts/company-agent.uk.ts`
- Modify: `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts`
- Modify: `backend/src/agents/company-agent.ts`
- Modify: `backend/src/agents/company-agent.test.ts`

**Interfaces:**
- Consumes: `VacancyCompensation`, `parseVacancyCompensation`, `parseWorkConditionsArray` from Task 1
- Produces:
  - Updated `COMPANY_AGENT_SYSTEM_PROMPT_UK`
  - Updated `VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK`
  - `ExtractedVacancyProfile` with `workConditions: string[]` and `compensation: VacancyCompensation`
  - `parseVacancyProfileExtraction(rawText: string): ExtractedVacancyProfile`

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/agents/company-agent.test.ts`:

```ts
test("company agent system prompt includes work conditions block with seven subtopics", () => {
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /умови роботи/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /зарплат/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /формат/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /графік/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /бенефіт/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /релокац/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /випробувальн/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /обладнан/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /чотир/i); // 4 themes
});

test("extraction prompt encodes workConditions and compensation", () => {
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /workConditions/i);
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /compensation/i);
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /displayText/i);
  assert.match(VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /Формат:/);
});

test("parseVacancyProfileExtraction parses workConditions and compensation", () => {
  const raw = JSON.stringify({
    role: "Backend Developer",
    requirements: ["Node.js"],
    expectations: ["Ownership"],
    workConditions: [
      "Формат: remote",
      "Графік: повний день",
      "Бенефіти: 24 дні відпустки",
      "Релокація: не вказано",
      "Випробувальний: 3 місяці",
      "Обладнання: MacBook Pro",
    ],
    compensation: {
      min: 3000,
      max: 4500,
      currency: "USD",
      grossNet: "gross",
      displayText: "$3000–4500 gross, USD",
    },
  });
  const result = parseVacancyProfileExtraction(raw);
  assert.equal(result.workConditions.length, 6);
  assert.equal(result.compensation.displayText, "$3000–4500 gross, USD");
  assert.equal(result.compensation.min, 3000);
});
```

Update existing test `parseVacancyProfileExtraction parses vacancy-only fields` expected object to include `workConditions` and `compensation` once parser requires them.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npm test -- src/agents/company-agent.test.ts`

Expected: FAIL on new assertions

- [ ] **Step 3: Update prompts**

Replace `backend/src/agents/prompts/company-agent.uk.ts` — додати 4-ту тему «Умови роботи» з 7 підтемами (зарплата, формат, графік, бенефіти, релокація, випробувальний, обладнання). READY gate: усі 4 теми + усі 7 підтем.

Replace `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts`:

```ts
export const VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK = `Ти отримуєш повну стенограму діалогу між HR-менеджером і AI-агентом компанії, який збирав інформацію про вакансію.

Твоє завдання — проаналізувати діалог і повернути СТРОГО валідний JSON без жодного тексту навколо (без пояснень, без markdown, без код-блоків) у такому форматі:

{"role": "назва посади", "requirements": ["вимога 1"], "expectations": ["очікування 1"], "workConditions": ["Формат: ...", "Графік: ...", "Бенефіти: ...", "Релокація: ...", "Випробувальний: ...", "Обладнання: ..."], "compensation": {"min": 3000, "max": 4500, "currency": "USD", "grossNet": "gross", "displayText": "$3000–4500 gross, USD"}}

Правила:
- "role" — короткий рядок з назвою посади.
- "requirements", "expectations", "workConditions" — масиви коротких рядків українською.
- "workConditions" — рівно шість рядків з префіксами: "Формат:", "Графік:", "Бенефіти:", "Релокація:", "Випробувальний:", "Обладнання:". Якщо підтема не обговорювалась — "<префікс> не вказано".
- "compensation" — об'єкт з обов'язковим "displayText" (людський опис зарплати). За можливості додай min, max, currency, grossNet ("gross" або "net"). Якщо зарплата не названа — {"displayText": "не вказано"}.
- Не вигадуй фактів, яких немає в діалозі.
- Відповідь має містити лише JSON.`;
```

- [ ] **Step 4: Extend parser in `company-agent.ts`**

```ts
import type { VacancyCompensation } from "../utils/vacancy-work-conditions";
import { parseVacancyCompensation, parseWorkConditionsArray } from "../utils/vacancy-work-conditions";

export interface ExtractedVacancyProfile {
  role: string;
  requirements: string[];
  expectations: string[];
  workConditions: string[];
  compensation: VacancyCompensation;
}

// inside parseVacancyProfileExtraction, after parsing role/requirements/expectations:
const { workConditions, compensation } = data as Record<string, unknown>;
const parsedWorkConditions = parseWorkConditionsArray(workConditions);
if (parsedWorkConditions.length === 0) {
  throw new ProfileExtractionError("missing or invalid field: workConditions");
}
const parsedCompensation = parseVacancyCompensation(compensation);
if (!parsedCompensation) {
  throw new ProfileExtractionError("missing or invalid field: compensation");
}
return { role: role.trim(), requirements: ..., expectations: ..., workConditions: parsedWorkConditions, compensation: parsedCompensation };
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npm test -- src/agents/company-agent.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/prompts/company-agent.uk.ts backend/src/agents/prompts/vacancy-profile-extraction.uk.ts backend/src/agents/company-agent.ts backend/src/agents/company-agent.test.ts
git commit -m "feat(agents): collect vacancy work conditions in HR prep"
```

---

### Task 3: Prep API — Persist & Patch Work Conditions

**Files:**
- Modify: `backend/src/routes/prep.ts`

**Interfaces:**
- Consumes: `ExtractedVacancyProfile`, `parseVacancyCompensation`, `parseWorkConditionsArray`
- Produces: `serializeVacancyProfile()` including `workConditions: string[]`, `compensation: VacancyCompensation | null`

- [ ] **Step 1: Extend serialize and patch types**

In `backend/src/routes/prep.ts`:

```ts
import { parseVacancyCompensation, parseWorkConditionsArray } from "../utils/vacancy-work-conditions";

type ProfilePatchBody = {
  // existing fields...
  workConditions?: unknown;
  compensation?: unknown;
};

function serializeVacancyProfile(profile: CompanyProfile) {
  return {
    // existing fields...
    workConditions: parseWorkConditionsArray(profile.workConditions),
    compensation: parseVacancyCompensation(profile.compensation),
    confirmedAt: profile.confirmedAt,
  };
}
```

In `parseProfilePatch`, add:

```ts
if (hasField("workConditions")) {
  const parsed = parseStringArray(body.workConditions);
  if (!parsed) return { ok: false, error: "Invalid workConditions" };
  data.workConditions = parsed;
}

if (hasField("compensation")) {
  const parsed = parseVacancyCompensation(body.compensation);
  if (!parsed) return { ok: false, error: "Invalid compensation" };
  data.compensation = parsed;
}
```

In `finish` upsert `update`/`create`, add:

```ts
workConditions: extracted.workConditions,
compensation: extracted.compensation,
```

- [ ] **Step 2: Run backend tests**

Run: `cd backend && npm test`

Expected: PASS (no regressions)

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/prep.ts
git commit -m "feat(prep): persist vacancy workConditions and compensation"
```

---

### Task 4: HR VacancyPrepView — Editable Work Conditions

**Files:**
- Modify: `frontend/src/api/prep.ts`
- Modify: `frontend/src/views/VacancyPrepView.vue`

**Interfaces:**
- Consumes: `serializeVacancyProfile()` shape from Task 3
- Produces: UI для редагування `compensation.displayText` і `workConditions[]`

- [ ] **Step 1: Extend frontend types**

In `frontend/src/api/prep.ts`:

```ts
export type VacancyCompensation = {
  min?: number;
  max?: number;
  currency?: string;
  grossNet?: "gross" | "net";
  displayText: string;
};

export type CompanyProfile = {
  // existing fields...
  workConditions: string[];
  compensation: VacancyCompensation | null;
};
```

- [ ] **Step 2: Add form fields in VacancyPrepView.vue**

In script: default `workConditions: []`, `compensation: null` when syncing profile.

Add helpers:

```ts
function getCompensationDisplayText(): string {
  return editableProfile.value?.compensation?.displayText ?? "";
}

function setCompensationDisplayText(text: string): void {
  if (!editableProfile.value) return;
  editableProfile.value.compensation = { displayText: text.trim() };
}
```

In `onSaveProfileEdits`, include `workConditions` and `compensation`.

In template (editable form, after «Очікування»):

```vue
<h3 class="section-heading">Умови роботи</h3>
<label class="field">
  <span class="field-label">Зарплата</span>
  <input
    type="text"
    class="field-input"
    :value="getCompensationDisplayText()"
    @input="setCompensationDisplayText(($event.target as HTMLInputElement).value)"
  />
</label>
<label class="field">
  <span class="field-label">Умови (один пункт на рядок, з префіксами)</span>
  <textarea
    class="field-input"
    rows="6"
    :value="getArrayField('workConditions')"
    @input="onArrayFieldInput('workConditions', $event)"
  />
</label>
```

Add read-only `<dl>` entries for confirmed profile view.

Extend `setArrayField`/`getArrayField` union type to include `"workConditions"`.

- [ ] **Step 3: Manual smoke**

Run frontend dev server; open `/vacancies/:id/prep` after finish — переконатися, що секція «Умови роботи» видима і зберігається.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/prep.ts frontend/src/views/VacancyPrepView.vue
git commit -m "feat(ui): editable vacancy work conditions in HR prep"
```

---

### Task 5: Live AI — COMPANY_ANSWER & Extended Profile Context

**Files:**
- Modify: `backend/src/agents/live-agent-turn-context.ts`
- Modify: `backend/src/agents/company-live-agent.ts`
- Modify: `backend/src/agents/prompts/company-live-agent.uk.ts`
- Modify: `backend/src/agents/company-live-agent.test.ts`
- Modify: `backend/src/agents/arbiter-agent.ts`
- Modify: `backend/src/agents/prompts/arbiter-agent.uk.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`
- Modify: `backend/src/socket/orchestrator.ts`
- Modify: `backend/src/socket/orchestrator.test.ts`

**Interfaces:**
- Consumes: `workConditions`, `compensation` from `CompanyProfile`
- Produces:
  - `ArbiterAction` includes `"COMPANY_ANSWER"`
  - `LiveAgentTurnContext.action` includes `"ANSWER_CANDIDATE"`
  - `CompanyLiveProfileContext` with `workConditions` and `compensation`
  - `formatCompanyTurnNudge({ action: "ANSWER_CANDIDATE" })`

- [ ] **Step 1: Write failing tests**

`backend/src/agents/arbiter-agent.test.ts`:

```ts
test("arbiter system prompt includes COMPANY_ANSWER", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /COMPANY_ANSWER/);
});

test("parseArbiterCommand parses COMPANY_ANSWER", () => {
  const result = parseArbiterCommand(
    '{ "action": "COMPANY_ANSWER", "summaryUk": "Company відповість", "briefUk": "Зарплата" }',
  );
  assert.equal(result.action, "COMPANY_ANSWER");
});
```

`backend/src/agents/company-live-agent.test.ts`:

```ts
test("buildCompanyLiveMessages includes workConditions and compensation in profile block", () => {
  const messages = buildCompanyLiveMessages({
    companyProfile: {
      ...companyProfile,
      workConditions: ["Формат: remote"],
      compensation: { displayText: "$4000 gross" },
    },
    history: [],
  });
  assert.match(messages[0].content, /workConditions/);
  assert.match(messages[0].content, /remote/);
  assert.match(messages[0].content, /\$4000 gross/);
});

test("formatCompanyTurnNudge handles ANSWER_CANDIDATE", () => {
  const nudge = formatCompanyTurnNudge({ action: "ANSWER_CANDIDATE", briefUk: "Бенефіти" });
  assert.match(nudge, /ANSWER_CANDIDATE/);
  assert.match(nudge, /Бенефіти/);
});
```

`backend/src/socket/orchestrator.test.ts` — new test:

```ts
test("orchestrator COMPANY_ANSWER runs company with ANSWER_CANDIDATE", async () => {
  // setup like existing START test; arbiter returns COMPANY_ANSWER on first call
  // assert runCompanyLiveTurn called with turnContext.action === "ANSWER_CANDIDATE"
});
```

- [ ] **Step 2: Run tests — verify FAIL**

Run: `cd backend && npm test -- src/agents/arbiter-agent.test.ts src/agents/company-live-agent.test.ts src/socket/orchestrator.test.ts`

- [ ] **Step 3: Implement**

`live-agent-turn-context.ts`:

```ts
export type LiveAgentTurnContext = {
  action: ArbiterAction | "ANSWER_CANDIDATE";
  briefUk?: string;
};
```

`arbiter-agent.ts` — add `"COMPANY_ANSWER"` to `ARBITER_ACTIONS`.

`arbiter-agent.uk.ts` — add rule:

```
- COMPANY_ANSWER — кандидат (людина або Candidate Agent) поставив питання компанії/вакансії/умов; Company відповідає з профілю. briefUk — про що відповісти.
```

Update `PENDING_QUESTION_NUDGE_UK` to distinguish candidate→company questions.

`company-live-agent.uk.ts` — add command `ANSWER_CANDIDATE` with rules from spec.

`company-live-agent.ts`:

```ts
export interface CompanyLiveProfileContext {
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
  workConditions: string[];
  compensation: VacancyCompensation | null;
}

export const ANSWER_CANDIDATE_NUDGE_UK =
  "[Система] Команда Arbiter: ANSWER_CANDIDATE. Відповідай на питання кандидата про компанію або умови вакансії з профілю. Якщо факту немає — попроси HR відповісти самому.";

export function formatCompanyTurnNudge(turnContext: LiveAgentTurnContext): string {
  if (turnContext.action === "ANSWER_CANDIDATE") {
    const briefPart = turnContext.briefUk?.trim() ? ` Підказка Arbiter: ${turnContext.briefUk}` : "";
    return `${ANSWER_CANDIDATE_NUDGE_UK}${briefPart}`;
  }
  // existing CLARIFY / NEXT_QUESTION
}
```

In `runCompanyLiveTurn`, map DB fields:

```ts
workConditions: parseWorkConditionsArray(companyProfile.workConditions),
compensation: parseVacancyCompensation(companyProfile.compensation),
```

`orchestrator.ts`:

```ts
const runCompanyActions =
  command.action === "START" ||
  command.action === "NEXT_QUESTION" ||
  command.action === "CLARIFY" ||
  command.action === "COMPANY_ANSWER";

// turnContext mapping:
command.action === "COMPANY_ANSWER" ? "ANSWER_CANDIDATE" : ...

// applyPendingBeforeRoute — add COMPANY_ANSWER to actions that clear pending
```

Update `runArbiterTurn` profile context same as company live.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- src/agents/arbiter-agent.test.ts src/agents/company-live-agent.test.ts src/socket/orchestrator.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/live-agent-turn-context.ts backend/src/agents/company-live-agent.ts backend/src/agents/prompts/company-live-agent.uk.ts backend/src/agents/company-live-agent.test.ts backend/src/agents/arbiter-agent.ts backend/src/agents/prompts/arbiter-agent.uk.ts backend/src/agents/arbiter-agent.test.ts backend/src/socket/orchestrator.ts backend/src/socket/orchestrator.test.ts
git commit -m "feat(live): COMPANY_ANSWER lets company AI reply on work conditions"
```

---

### Task 6: Match Offer Display Fields

**Files:**
- Modify: `backend/src/services/vacancy-match.ts`
- Modify: `backend/src/services/vacancy-match.test.ts`
- Modify: `backend/src/routes/candidate-matches.ts`
- Modify: `frontend/src/api/candidate-matches.ts`
- Modify: `frontend/src/views/CandidateMatchesView.vue`

**Interfaces:**
- Consumes: `formatSalaryDisplay`, `formatWorkFormatDisplay` from Task 1
- Produces: `CandidateMatchOffer` with `salaryDisplay: string | null`, `workFormatDisplay: string | null`

- [ ] **Step 1: Write failing tests**

Update `backend/src/services/vacancy-match.test.ts`:

```ts
import { enrichOfferWithDisplays } from "./vacancy-match";

test("enrichOfferWithDisplays adds salary and format from company profile", () => {
  const offer = enrichOfferWithDisplays(
    { vacancyId: "v1", title: "Backend", matchScore: 88 },
    {
      workConditions: ["Формат: remote, 2 дні в офісі"],
      compensation: { displayText: "$4000 gross, USD" },
    },
  );
  assert.equal(offer.salaryDisplay, "$4000 gross, USD");
  assert.equal(offer.workFormatDisplay, "remote, 2 дні в офісі");
});

test("enrichOfferWithDisplays returns null displays for не вказано", () => {
  const offer = enrichOfferWithDisplays(
    { vacancyId: "v1", title: "Backend", matchScore: 50 },
    {
      workConditions: ["Формат: не вказано"],
      compensation: { displayText: "не вказано" },
    },
  );
  assert.equal(offer.salaryDisplay, null);
  assert.equal(offer.workFormatDisplay, null);
});
```

Replace test `candidate offer payload has only vacancyId, title, matchScore` with assertion that keys include display fields.

- [ ] **Step 2: Implement backend enrichment**

In `vacancy-match.ts`:

```ts
export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
  salaryDisplay: string | null;
  workFormatDisplay: string | null;
};

export function enrichOfferWithDisplays(
  base: { vacancyId: string; title: string; matchScore: number },
  profile: { workConditions: unknown; compensation: unknown } | null,
): CandidateMatchOffer {
  return {
    ...base,
    salaryDisplay: formatSalaryDisplay(profile?.compensation ?? null),
    workFormatDisplay: formatWorkFormatDisplay(profile?.workConditions ?? null),
  };
}
```

Add `attachDisplaysToOffers(prisma, offers)` that batch-loads `companyProfile` by vacancyIds and maps through `enrichOfferWithDisplays`. Call from `ensureMatchScores` return path and `getTopMatchOffers`.

Update cached scores query include:

```ts
include: { vacancy: { include: { companyProfile: true } } },
```

- [ ] **Step 3: Update frontend**

`frontend/src/api/candidate-matches.ts`:

```ts
export type CandidateMatchOffer = {
  vacancyId: string;
  title: string;
  matchScore: number;
  salaryDisplay: string | null;
  workFormatDisplay: string | null;
};
```

`CandidateMatchesView.vue` template inside `.offer-main`:

```vue
<p v-if="item.salaryDisplay" class="offer-meta">💰 {{ item.salaryDisplay }}</p>
<p v-if="item.workFormatDisplay" class="offer-meta">🏢 {{ item.workFormatDisplay }}</p>
```

Add CSS:

```css
.offer-meta {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: #6b7280;
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- src/services/vacancy-match.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/vacancy-match.ts backend/src/services/vacancy-match.test.ts backend/src/routes/candidate-matches.ts frontend/src/api/candidate-matches.ts frontend/src/views/CandidateMatchesView.vue
git commit -m "feat(match): show salary and work format on candidate offer cards"
```

---

### Task 7: Manual Test Dialogues

**Files:**
- Modify: `docs/manual-test-dialogues.uk.md`

- [ ] **Step 1: Add HR vacancy work conditions section**

After existing HR company profile section, add block «Vacancy prep — умови роботи» з прикладовими відповідями HR на 7 підтем (зарплата, формат, графік, бенефіти, релокація, випробувальний, обладнання) і очікуваним профілем після finish.

- [ ] **Step 2: Add live E2E check**

Додати сценарій: Candidate Agent питає про бенефіти → Company AI відповідає; питання поза профілем → Company просить HR.

- [ ] **Step 3: Commit**

```bash
git add docs/manual-test-dialogues.uk.md
git commit -m "docs: manual test dialogues for vacancy work conditions"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Prisma `workConditions` + `compensation` | Task 1 |
| 7 subtopics in vacancy agent | Task 2 |
| Extraction JSON | Task 2 |
| prep finish/patch/serialize | Task 3 |
| VacancyPrepView editable UI | Task 4 |
| Live profile context extended | Task 5 |
| `COMPANY_ANSWER` / `ANSWER_CANDIDATE` | Task 5 |
| Match `salaryDisplay` + `workFormatDisplay` | Task 6 |
| Match scoring unchanged | Task 6 (enrichment only) |
| Manual E2E docs | Task 7 |

## Verification (full suite)

Run: `cd backend && npm test`

Run frontend typecheck if available: `cd frontend && npm run build`

Manual E2E per Task 7 and spec section «Manual E2E».

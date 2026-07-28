# Decision letter REJECT argumentation + ACCEPT offer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У decision letters після звіту: REJECT з аргументацією зі звіту/risks; ACCEPT з повним офером вакансії (або фразою про узгодження в діалозі, якщо умов немає).

**Architecture:** Хелпер `extractVacancyOffer` нормалізує `compensation` + `workConditions` з company profile вакансії; розширює `DecisionLetterContext`; промпт вимагає аргументацію (REJECT) і включення оферу / діалогового fallback (ACCEPT); draft у `reports.ts` передає офер у агент. UI/API контракт без змін.

**Tech Stack:** TypeScript, Node test runner (`node --import tsx --test`), Express, існуючий `LlmProvider`, utils з `vacancy-work-conditions.ts`.

**Spec:** `docs/superpowers/specs/2026-07-28-decision-letter-reject-argumentation-accept-offer-design.md`

## Global Constraints

- Українська мова в листах і промптах
- Не вигадувати умови оферу / причини відмови поза вхідними даними
- API draft/send request/response без змін для клієнта
- Відсутність оферу не блокує draft/send
- `ADDITIONAL_MEETING` поведінка без регресії
- Не чіпати `application-decline-letter`
- Перевикористовувати `parseVacancyCompensation` / `parseWorkConditionsArray` / `formatSalaryDisplay` з `backend/src/utils/vacancy-work-conditions.ts`

---

## File Structure

| File | Role |
|------|------|
| `backend/src/agents/decision-letter-agent.ts` | `extractVacancyOffer`, розширений контекст, `buildDecisionLetterMessages` |
| `backend/src/agents/prompts/decision-letter.uk.ts` | Правила REJECT/ACCEPT + офер |
| `backend/src/agents/decision-letter-agent.test.ts` | Unit-тести хелпера, messages, промпту |
| `backend/src/routes/reports.ts` | Передача `offerAvailable` / `offerLines` у draft |

---

### Task 1: `extractVacancyOffer` + тести

**Files:**
- Modify: `backend/src/agents/decision-letter-agent.ts`
- Modify: `backend/src/agents/decision-letter-agent.test.ts`

**Interfaces:**
- Consumes: `parseVacancyCompensation`, `parseWorkConditionsArray`, `formatSalaryDisplay` from `../utils/vacancy-work-conditions`
- Produces:
  - `export type VacancyOfferExtraction = { offerAvailable: boolean; offerLines: string[] }`
  - `export function extractVacancyOffer(companyProfile: unknown): VacancyOfferExtraction`

- [ ] **Step 1: Write failing tests**

Додай у `decision-letter-agent.test.ts` (існуючі тести поки можуть ламатися на відсутніх полях контексту — у цьому таску ще не чіпай `buildDecisionLetterMessages` сигнатуру; якщо імпортуєш лише `extractVacancyOffer`, старі тести лишаються як є):

```typescript
import {
  extractVacancyOffer,
  buildDecisionLetterMessages,
  normalizeDecisionLetter,
} from "./decision-letter-agent";

test("extractVacancyOffer includes salary and all specified workConditions", () => {
  const result = extractVacancyOffer({
    compensation: { displayText: "$4000 gross, USD" },
    workConditions: [
      "Формат: remote",
      "Графік: гнучкий",
      "Бенефіти: страховка",
      "Релокація: не вказано",
      "Випробувальний: 3 місяці",
      "Обладнання: ноутбук",
    ],
  });
  assert.equal(result.offerAvailable, true);
  assert.deepEqual(result.offerLines, [
    "Зарплата: $4000 gross, USD",
    "Формат: remote",
    "Графік: гнучкий",
    "Бенефіти: страховка",
    "Випробувальний: 3 місяці",
    "Обладнання: ноутбук",
  ]);
});

test("extractVacancyOffer returns empty when all unspecified", () => {
  const result = extractVacancyOffer({
    compensation: { displayText: "не вказано" },
    workConditions: [
      "Формат: не вказано",
      "Графік: не вказано",
    ],
  });
  assert.equal(result.offerAvailable, false);
  assert.deepEqual(result.offerLines, []);
});

test("extractVacancyOffer handles invalid profile", () => {
  assert.deepEqual(extractVacancyOffer(null), {
    offerAvailable: false,
    offerLines: [],
  });
  assert.deepEqual(extractVacancyOffer("x"), {
    offerAvailable: false,
    offerLines: [],
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && node --import tsx --test src/agents/decision-letter-agent.test.ts
```

Expected: FAIL — `extractVacancyOffer` is not a function / not exported.

- [ ] **Step 3: Implement `extractVacancyOffer`**

У `decision-letter-agent.ts` додай:

```typescript
import {
  formatSalaryDisplay,
  parseWorkConditionsArray,
} from "../utils/vacancy-work-conditions";

export type VacancyOfferExtraction = {
  offerAvailable: boolean;
  offerLines: string[];
};

const NOT_SPECIFIED = "не вказано";

function isUnspecifiedValue(value: string): boolean {
  return value.trim().toLowerCase() === NOT_SPECIFIED;
}

function workConditionLineIsSpecified(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const colon = trimmed.indexOf(":");
  const value = colon >= 0 ? trimmed.slice(colon + 1).trim() : trimmed;
  return !isUnspecifiedValue(value);
}

export function extractVacancyOffer(companyProfile: unknown): VacancyOfferExtraction {
  if (typeof companyProfile !== "object" || companyProfile === null) {
    return { offerAvailable: false, offerLines: [] };
  }
  const record = companyProfile as Record<string, unknown>;
  const offerLines: string[] = [];

  const salary = formatSalaryDisplay(record.compensation);
  if (salary) {
    offerLines.push(`Зарплата: ${salary}`);
  }

  for (const line of parseWorkConditionsArray(record.workConditions)) {
    if (workConditionLineIsSpecified(line)) {
      offerLines.push(line.trim());
    }
  }

  return {
    offerAvailable: offerLines.length > 0,
    offerLines,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS** (нові тести; старі ще без змін)

```bash
cd backend && node --import tsx --test src/agents/decision-letter-agent.test.ts
```

Expected: PASS для трьох нових + існуючих.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/decision-letter-agent.ts \
  backend/src/agents/decision-letter-agent.test.ts
git commit -m "feat(api): extract vacancy offer lines for decision letters"
```

---

### Task 2: Контекст, промпт і збірка messages

**Files:**
- Modify: `backend/src/agents/decision-letter-agent.ts`
- Modify: `backend/src/agents/prompts/decision-letter.uk.ts`
- Modify: `backend/src/agents/decision-letter-agent.test.ts`

**Interfaces:**
- Consumes: `VacancyOfferExtraction` fields
- Produces: оновлений
  ```ts
  export type DecisionLetterContext = {
    type: DecisionLetterType;
    vacancyTitle: string;
    reportMarkdown: string;
    recommendation: string;
    matchScore: number;
    strengths: string[];
    risks: string[];
    companyProfileJson: string;
    candidateProfileJson: string;
    offerAvailable: boolean;
    offerLines: string[];
  };
  ```

- [ ] **Step 1: Update failing/existing tests for new context fields**

Онови всі виклики `buildDecisionLetterMessages` — додай `offerAvailable` і `offerLines`. Додай тести:

```typescript
test("buildDecisionLetterMessages includes offer block when available", () => {
  const messages = buildDecisionLetterMessages({
    type: "ACCEPT",
    vacancyTitle: "Backend Engineer",
    reportMarkdown: "## Ок",
    recommendation: "HIRE",
    matchScore: 80,
    strengths: ["Nest"],
    risks: [],
    companyProfileJson: "{}",
    candidateProfileJson: "{}",
    offerAvailable: true,
    offerLines: ["Зарплата: $4000", "Формат: remote"],
  });
  const user = messages[1]?.content ?? "";
  assert.match(user, /=== ОФЕР \(УМОВИ ВАКАНСІЇ\) ===/);
  assert.match(user, /available: true/);
  assert.match(user, /Зарплата: \$4000/);
  assert.match(user, /Формат: remote/);
});

test("buildDecisionLetterMessages marks offer unavailable", () => {
  const messages = buildDecisionLetterMessages({
    type: "ACCEPT",
    vacancyTitle: "Backend Engineer",
    reportMarkdown: "## Ок",
    recommendation: "HIRE",
    matchScore: 80,
    strengths: [],
    risks: [],
    companyProfileJson: "{}",
    candidateProfileJson: "{}",
    offerAvailable: false,
    offerLines: [],
  });
  const user = messages[1]?.content ?? "";
  assert.match(user, /available: false/);
  assert.match(user, /умови не вказані — узгодити в діалозі/);
});

test("decision letter prompt requires REJECT argumentation and ACCEPT offer rules", () => {
  const { DECISION_LETTER_SYSTEM_PROMPT_UK } = require("./prompts/decision-letter.uk") as {
    DECISION_LETTER_SYSTEM_PROMPT_UK: string;
  };
  assert.match(DECISION_LETTER_SYSTEM_PROMPT_UK, /REJECT/i);
  assert.match(DECISION_LETTER_SYSTEM_PROMPT_UK, /аргумент/i);
  assert.match(DECISION_LETTER_SYSTEM_PROMPT_UK, /офер|ОФЕР|умови/i);
  assert.match(DECISION_LETTER_SYSTEM_PROMPT_UK, /діалозі/i);
});
```

Краще імпортувати промпт статично:

```typescript
import { DECISION_LETTER_SYSTEM_PROMPT_UK } from "./prompts/decision-letter.uk";
```

і assert.match на нього (без require).

Також у старому тесті `buildDecisionLetterMessages includes type and vacancy` додай:

```typescript
offerAvailable: false,
offerLines: [],
```

- [ ] **Step 2: Run — expect FAIL** (відсутні поля / промпт без нових правил)

```bash
cd backend && node --import tsx --test src/agents/decision-letter-agent.test.ts
```

- [ ] **Step 3: Update prompt**

Заміни `backend/src/agents/prompts/decision-letter.uk.ts` на:

```typescript
export const DECISION_LETTER_SYSTEM_PROMPT_UK = `Ти — HR-асистент. Пишеш персональний лист кандидату українською мовою за рішенням після співбесіди.

Типи рішення (поле type у контексті):
- ACCEPT — позитивне рішення / запрошення далі
- REJECT — ввічлива відмова
- ADDITIONAL_MEETING — потрібна додаткова зустріч або уточнення

Правила:
- Спирайся ЛИШЕ на надані факти: звіт, recommendation, matchScore, strengths, risks, профілі компанії та кандидата, блок ОФЕР. Не вигадуй фактів, цифр, умов оферу чи деталей, яких немає у вхідних даних.
- Тон: професійний, людяний, без канцеляриту й без зайвої жорсткості.
- Для REJECT: обов'язково коротко аргументуй рішення, спираючись на risks і факти зі звіту; не вигадуй причин поза вхідними даними.
- Для ACCEPT: якщо в блоці ОФЕР available: true — обов'язково включи умови з цього блоку в лист (не переказуй весь профіль компанії). Якщо available: false — не вигадуй умови; явно напиши, що деталі пропозиції узгоджуються в цьому діалозі.
- Для ADDITIONAL_MEETING: поясни потребу в уточненнях; НЕ вигадуй конкретну дату чи час; запропонуй узгодити деталі в цьому діалозі (або через окреме планування в системі).
- Відповідь — ЛИШЕ звичайний текст листа (plain text). Без JSON, без markdown-огорож (\`\`\`), без заголовків типу «Лист:».`;
```

- [ ] **Step 4: Update `DecisionLetterContext` і `buildDecisionLetterMessages`**

Розшир тип полями `offerAvailable` і `offerLines`. У `userContent` після блоків ризиків (або перед профілями) додай:

```typescript
"",
`=== ОФЕР (УМОВИ ВАКАНСІЇ) ===`,
`available: ${ctx.offerAvailable ? "true" : "false"}`,
ctx.offerAvailable
  ? ctx.offerLines.map((item) => `- ${item}`).join("\n")
  : "(умови не вказані — узгодити в діалозі)",
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && node --import tsx --test src/agents/decision-letter-agent.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/decision-letter-agent.ts \
  backend/src/agents/prompts/decision-letter.uk.ts \
  backend/src/agents/decision-letter-agent.test.ts
git commit -m "feat(api): require reject argumentation and accept offer in decision letters"
```

---

### Task 3: Wire draft endpoint

**Files:**
- Modify: `backend/src/routes/reports.ts`
- Modify: `backend/src/routes/reports.test.ts` (якщо є тести draft, що викликають generate з повним ctx — оновити; якщо mock цілого agent — можливо змін не треба)

**Interfaces:**
- Consumes: `extractVacancyOffer`, оновлений `generateDecisionLetter` ctx
- Produces: той самий HTTP `{ type, body }`

- [ ] **Step 1: Find call sites**

```bash
cd backend && rg "generateDecisionLetter|DecisionLetterContext|offerAvailable" -n src
```

Очікувано: `reports.ts` + agent tests.

- [ ] **Step 2: Update draft handler**

У `POST /reports/:id/decisions/draft` перед `generateDecisionLetter`:

```typescript
const offer = extractVacancyOffer(report.interview.vacancy.companyProfile);
const body = await generateDecisionLetter(getLlmProvider(), {
  type,
  vacancyTitle: report.interview.vacancy.title,
  reportMarkdown: report.reportMarkdown,
  recommendation: report.recommendation,
  matchScore: report.matchScore,
  strengths: report.strengths as string[],
  risks: report.risks as string[],
  companyProfileJson: JSON.stringify(report.interview.vacancy.companyProfile ?? {}),
  candidateProfileJson: JSON.stringify(report.interview.candidateProfile ?? {}),
  offerAvailable: offer.offerAvailable,
  offerLines: offer.offerLines,
});
```

Імпорт: `import { extractVacancyOffer, generateDecisionLetter } from "../agents/decision-letter-agent";`

- [ ] **Step 3: Fix any broken route tests**

```bash
cd backend && node --import tsx --test src/routes/reports.test.ts
```

Якщо тести мокають agent і не збирають ctx вручну — мають пройти. Якщо збирають ctx — додай `offerAvailable`/`offerLines`.

- [ ] **Step 4: Run agent + reports tests**

```bash
cd backend && node --import tsx --test \
  src/agents/decision-letter-agent.test.ts \
  src/routes/reports.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts
git commit -m "feat(api): pass vacancy offer into decision letter draft"
```

---

### Task 4: Verification

- [ ] **Step 1: Run focused suite once more**

```bash
cd backend && node --import tsx --test \
  src/agents/decision-letter-agent.test.ts \
  src/routes/reports.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Spec coverage check (manual)**

| Spec AC | Task |
|---------|------|
| REJECT аргументація в промпті | Task 2 |
| ACCEPT офер у контексті | Task 1–3 |
| ACCEPT fallback діалог | Task 2 |
| API/UI без змін | Task 3 (лише внутрішня передача) |
| Unit-тести | Task 1–2 |

---

## Self-Review (plan author)

1. **Spec coverage:** REJECT argumentation, ACCEPT full offer, unavailable→dialog phrase, no API/UI change, no application-decline — covered.
2. **Placeholders:** none.
3. **Types:** `offerAvailable` / `offerLines` consistent across tasks.

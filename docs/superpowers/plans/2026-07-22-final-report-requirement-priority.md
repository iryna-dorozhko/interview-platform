# Final Report Requirement Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Фінальний звіт після live-співбесіди враховує `critical`/`desired` вимог вакансії в тексті й обчислює `matchScore` через `computeMatchScore`, як у матчингу вакансій.

**Architecture:** LLM повертає `assessments[]` + `contextFit` (без `matchScore`). `parseFinalReport(raw, requirements)` валідує assessments і викликає `computeMatchScore`. Промпт вимагає розділити критичні/бажані у markdown і блокувати `HIRE` при unmet critical. Route `POST /interviews/:id/end` нормалізує requirements і передає їх у build/parse.

**Tech Stack:** Express + Prisma + TypeScript + `node:test` + існуючі `computeMatchScore` / `normalizeVacancyRequirements`.

**Spec:** `docs/superpowers/specs/2026-07-22-final-report-requirement-priority-design.md`

## Global Constraints

- `matchScore` рахує лише бекенд через `computeMatchScore` (ваги 0.75/0.25, mix 0.8/0.2, cap 69).
- LLM не повертає `matchScore`; повертає `contextFit` і повний `assessments`.
- Assessments у БД не зберігаємо (YAGNI).
- Legacy `requirements: string[]` → усі `desired` через `normalizeVacancyRequirements`.
- Якщо normalize повертає `null` → трактувати як `{ critical: [], desired: [] }`.
- Unmet critical блокує `recommendation: HIRE` (правило промпту).
- Candidate `skills.strong`/`growth` — лише evidence, не пріоритет вакансії.
- Без міграцій Prisma / без зміни UI.

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/agents/prompts/final-report.uk.ts` | Новий JSON-контракт + правила пріоритетів |
| `backend/src/agents/final-report-agent.ts` | Парсинг assessments/contextFit, computeMatchScore, явний блок вимог у messages |
| `backend/src/agents/final-report-agent.test.ts` | Unit-тести агента |
| `backend/src/routes/interviews.ts` | normalize + передача requirements у build/parse |
| `backend/src/routes/interviews.test.ts` | Мок нового JSON; assert обчисленого score |
| `README.md` | Нотатка про формулу пріоритетів у Final Report |

---

### Task 1: Промпт фінального звіту з пріоритетами

**Files:**
- Modify: `backend/src/agents/prompts/final-report.uk.ts`
- Modify: `backend/src/agents/final-report-agent.test.ts` (assert на вміст промпту через імпорт константи)

**Interfaces:**
- Produces: оновлений `FINAL_REPORT_SYSTEM_PROMPT_UK` з контрактом `contextFit` + `assessments`, без `matchScore`

- [ ] **Step 1: Write the failing test**

Додай у `backend/src/agents/final-report-agent.test.ts`:

```typescript
import { FINAL_REPORT_SYSTEM_PROMPT_UK } from "./prompts/final-report.uk";

test("FINAL_REPORT_SYSTEM_PROMPT_UK requires assessments and contextFit without matchScore", () => {
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /contextFit/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /assessments/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /critical/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /desired/);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /Критичні|критичн/i);
  assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /не повертай поле matchScore|Не повертай поле matchScore/i);
  assert.doesNotMatch(
    FINAL_REPORT_SYSTEM_PROMPT_UK,
    /\{"reportMarkdown":".*","recommendation":"HIRE\|MAYBE\|REJECT","matchScore":0-100/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/agents/final-report-agent.test.ts`

Expected: FAIL — промпт ще містить старий контракт з `matchScore`.

- [ ] **Step 3: Update the prompt**

Заміни вміст `backend/src/agents/prompts/final-report.uk.ts` на:

```typescript
export const FINAL_REPORT_SYSTEM_PROMPT_UK = `Ти HR-аналітик. Отримуєш стенограму live-співбесіди, JSON-профілі компанії і кандидата, та явний список вимог вакансії з пріоритетами critical/desired.

Поверни СТРОГО валідний JSON без тексту навколо (без markdown-обгортки, без пояснень):

{"reportMarkdown":"...","recommendation":"HIRE|MAYBE|REJECT","contextFit":0-100,"assessments":[{"requirement":"...","priority":"critical|desired","status":"met|unknown|unmet","evidence":"..."}],"strengths":["..."],"risks":["..."]}

Правила:
- reportMarkdown — markdown українською з розділами: ## Підсумок, ## Відповідність вимогам, ## Сильні сторони, ## Ризики, ## Рекомендація
- У ## Відповідність вимогам обовʼязково підзаголовки ### Критичні та ### Бажані (навіть якщо один зі списків порожній — напиши «немає»)
- recommendation — лише HIRE, MAYBE або REJECT; якщо будь-яка critical вимога має status unmet — recommendation НЕ може бути HIRE
- contextFit — ціле число 0–100 (відповідність культурі/очікуванням/контексту, не дубль вимог)
- assessments — рівно всі пункти critical+desired з вхідного списку, без доданих і без пропусків; priority має збігатися зі входом; status: met|unknown|unmet; evidence — коротке обґрунтування українською
- якщо вимог немає — assessments має бути []
- strengths, risks — масиви рядків українською; мінімум один елемент кожен
- незакрита critical (unmet або суттєвий unknown) обовʼязково в risks
- Спирайся лише на надані дані; не вигадуй фактів
- У стенограмі мітки «· confirmed», «· inferred», «· unknown» біля Кандидат (AI) показують впевненість AI.
- confirmed — факт з анкети; inferred — висновок AI, не підтверджений досвід; unknown — AI не знав і передав людині.
- inferred-відповіді по суттєвих вимогах вакансії включай у risks як caveat, якщо людина не підтвердила пізніше.
- Не став status met для вимоги лише з inferred без підтвердження людиною (HUMAN_CANDIDATE або confirmed).
- Після unknown пріоритет має HUMAN_CANDIDATE.
- skills.strong / skills.growth кандидата — лише evidence і контекст; це НЕ пріоритет вимог вакансії.
- Не повертай поле matchScore — його обчислить бекенд.`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/agents/final-report-agent.test.ts`

Expected: новий тест PASS; старі тести `parseFinalReport` ще PASS на цьому кроці (змінюй лише промпт).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/final-report.uk.ts backend/src/agents/final-report-agent.test.ts
git commit -m "$(cat <<'EOF'
feat: require critical/desired assessments in final-report prompt

EOF
)"
```

---

### Task 2: `parseFinalReport` з assessments + `computeMatchScore`

**Files:**
- Modify: `backend/src/agents/final-report-agent.ts`
- Modify: `backend/src/agents/final-report-agent.test.ts`

**Interfaces:**
- Consumes: `VacancyRequirements` з `../utils/vacancy-requirements`; `computeMatchScore`, `RequirementAssessment`, `RequirementStatus` з `../services/match-score`
- Produces:
  - `parseFinalReport(rawText: string, requirements: VacancyRequirements): ExtractedFinalReport`
  - `ExtractedFinalReport` лишається з полем `matchScore: number` (обчислене)

- [ ] **Step 1: Write the failing tests**

Онови існуючі тести `parseFinalReport`, щоб передавати `requirements` і новий JSON. Додай:

```typescript
import { computeMatchScore } from "../services/match-score";

const sampleRequirements = {
  critical: ["Node.js"],
  desired: ["Docker"],
};

function sampleReportJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    reportMarkdown:
      "## Підсумок\n\nДобре.\n## Відповідність вимогам\n### Критичні\n- Node.js\n### Бажані\n- Docker",
    recommendation: "MAYBE",
    contextFit: 80,
    assessments: [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "met",
        evidence: "Підтверджено в стенограмі",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "unmet",
        evidence: "Немає досвіду",
      },
    ],
    strengths: ["Досвід Node.js"],
    risks: ["Немає Docker"],
    ...overrides,
  });
}

test("parseFinalReport computes matchScore via computeMatchScore", () => {
  const result = parseFinalReport(sampleReportJson(), sampleRequirements);
  const expected = computeMatchScore(
    [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "met",
        evidence: "Підтверджено в стенограмі",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "unmet",
        evidence: "Немає досвіду",
      },
    ],
    80,
  );
  assert.equal(result.matchScore, expected.matchScore);
  assert.equal(result.recommendation, "MAYBE");
});

test("parseFinalReport caps matchScore at 69 when critical is unmet", () => {
  const raw = sampleReportJson({
    recommendation: "REJECT",
    contextFit: 100,
    assessments: [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "unmet",
        evidence: "Немає",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "met",
        evidence: "Є",
      },
    ],
    risks: ["Немає Node.js"],
  });
  const result = parseFinalReport(raw, sampleRequirements);
  assert.ok(result.matchScore <= 69);
  const expected = computeMatchScore(
    [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "unmet",
        evidence: "Немає",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "met",
        evidence: "Є",
      },
    ],
    100,
  );
  assert.equal(result.matchScore, expected.matchScore);
  assert.equal(expected.cappedByCriticalUnmet, true);
});

test("parseFinalReport rejects incomplete assessments", () => {
  const raw = sampleReportJson({
    assessments: [
      {
        requirement: "Node.js",
        priority: "critical",
        status: "met",
        evidence: "ok",
      },
    ],
  });
  assert.throws(
    () => parseFinalReport(raw, sampleRequirements),
    FinalReportExtractionError,
  );
});

test("parseFinalReport rejects wrong priority", () => {
  const raw = sampleReportJson({
    assessments: [
      {
        requirement: "Node.js",
        priority: "desired",
        status: "met",
        evidence: "ok",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "met",
        evidence: "ok",
      },
    ],
  });
  assert.throws(
    () => parseFinalReport(raw, sampleRequirements),
    FinalReportExtractionError,
  );
});

test("parseFinalReport with empty requirements uses contextFit as matchScore", () => {
  const raw = JSON.stringify({
    reportMarkdown: "## Підсумок\n\nOK",
    recommendation: "MAYBE",
    contextFit: 73,
    assessments: [],
    strengths: ["a"],
    risks: ["b"],
  });
  const result = parseFinalReport(raw, { critical: [], desired: [] });
  assert.equal(result.matchScore, 73);
});

test("parseFinalReport rejects contextFit out of range", () => {
  assert.throws(
    () => parseFinalReport(sampleReportJson({ contextFit: 101 }), sampleRequirements),
    FinalReportExtractionError,
  );
});
```

Онови старі тести (`parseFinalReport parses valid JSON`, strips fences, invalid recommendation):

- Прибери тест `parseFinalReport throws when matchScore out of range`.
- У валідних тестах використовуй `sampleReportJson()` / новий формат і другий аргумент `requirements`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/agents/final-report-agent.test.ts`

Expected: FAIL — `parseFinalReport` ще очікує `matchScore`, не приймає `requirements`.

- [ ] **Step 3: Implement parsing**

У `backend/src/agents/final-report-agent.ts`:

1. Імпорти:

```typescript
import type { RequirementAssessment, RequirementStatus } from "../services/match-score";
import { computeMatchScore } from "../services/match-score";
import type { VacancyRequirements } from "../utils/vacancy-requirements";
```

2. Додай хелпери (локально, за зразком vacancy-match-agent):

```typescript
const VALID_STATUSES = new Set<RequirementStatus>(["met", "unknown", "unmet"]);

function expectedRequirements(
  requirements: VacancyRequirements,
): Map<string, "critical" | "desired"> {
  const map = new Map<string, "critical" | "desired">();
  for (const requirement of requirements.critical) {
    map.set(requirement, "critical");
  }
  for (const requirement of requirements.desired) {
    map.set(requirement, "desired");
  }
  return map;
}

function parseAssessmentItem(item: unknown): RequirementAssessment {
  if (typeof item !== "object" || item === null) {
    throw new FinalReportExtractionError("invalid assessment item");
  }
  const { requirement, priority, status, evidence } = item as Record<string, unknown>;
  if (typeof requirement !== "string" || !requirement) {
    throw new FinalReportExtractionError("missing or invalid field: requirement");
  }
  if (priority !== "critical" && priority !== "desired") {
    throw new FinalReportExtractionError("missing or invalid field: priority");
  }
  if (typeof status !== "string" || !VALID_STATUSES.has(status as RequirementStatus)) {
    throw new FinalReportExtractionError("missing or invalid field: status");
  }
  if (typeof evidence !== "string" || !evidence.trim()) {
    throw new FinalReportExtractionError("missing or invalid field: evidence");
  }
  return {
    requirement,
    priority,
    status: status as RequirementStatus,
    evidence: evidence.trim(),
  };
}

function validateAssessments(
  assessments: unknown,
  requirements: VacancyRequirements,
): RequirementAssessment[] {
  if (!Array.isArray(assessments)) {
    throw new FinalReportExtractionError("missing or invalid field: assessments");
  }
  const expected = expectedRequirements(requirements);
  const seen = new Set<string>();
  const validated: RequirementAssessment[] = [];
  for (const item of assessments) {
    const assessment = parseAssessmentItem(item);
    const expectedPriority = expected.get(assessment.requirement);
    if (!expectedPriority) {
      throw new FinalReportExtractionError(`unexpected requirement: ${assessment.requirement}`);
    }
    if (seen.has(assessment.requirement)) {
      throw new FinalReportExtractionError(`duplicate requirement: ${assessment.requirement}`);
    }
    if (assessment.priority !== expectedPriority) {
      throw new FinalReportExtractionError(
        `priority mismatch for requirement: ${assessment.requirement}`,
      );
    }
    seen.add(assessment.requirement);
    validated.push(assessment);
  }
  if (seen.size !== expected.size) {
    throw new FinalReportExtractionError("incomplete assessments");
  }
  return validated;
}
```

3. Заміни `parseFinalReport`:

```typescript
export function parseFinalReport(
  rawText: string,
  requirements: VacancyRequirements,
): ExtractedFinalReport {
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

  const { reportMarkdown, recommendation, contextFit, assessments, strengths, risks } =
    data as Record<string, unknown>;

  if (typeof reportMarkdown !== "string" || !reportMarkdown.trim()) {
    throw new FinalReportExtractionError("missing or invalid field: reportMarkdown");
  }

  if (typeof recommendation !== "string" || !VALID_RECOMMENDATIONS.has(recommendation)) {
    throw new FinalReportExtractionError("missing or invalid field: recommendation");
  }

  if (
    typeof contextFit !== "number" ||
    !Number.isFinite(contextFit) ||
    !Number.isInteger(contextFit) ||
    contextFit < 0 ||
    contextFit > 100
  ) {
    throw new FinalReportExtractionError("missing or invalid field: contextFit");
  }

  const validatedAssessments = validateAssessments(assessments, requirements);
  const breakdown = computeMatchScore(validatedAssessments, contextFit);

  return {
    reportMarkdown: reportMarkdown.trim(),
    recommendation: recommendation as ExtractedFinalReport["recommendation"],
    matchScore: breakdown.matchScore,
    strengths: toStringArray(strengths, "strengths"),
    risks: toStringArray(risks, "risks"),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --import tsx --test src/agents/final-report-agent.test.ts`

Expected: PASS усі тести файлу.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/final-report-agent.ts backend/src/agents/final-report-agent.test.ts
git commit -m "$(cat <<'EOF'
feat: compute final-report matchScore from prioritized assessments

EOF
)"
```

---

### Task 3: Явний блок вимог у `buildFinalReportMessages`

**Files:**
- Modify: `backend/src/agents/final-report-agent.ts` (`buildFinalReportMessages`)
- Modify: `backend/src/agents/final-report-agent.test.ts`

**Interfaces:**
- Produces: `buildFinalReportMessages(input: { transcript: string; companyProfile: unknown; candidateProfile: unknown; requirements: VacancyRequirements }): ChatMessage[]`

- [ ] **Step 1: Write the failing test**

```typescript
import { buildFinalReportMessages } from "./final-report-agent";

test("buildFinalReportMessages includes explicit critical/desired requirements block", () => {
  const messages = buildFinalReportMessages({
    transcript: "[HR] hi",
    companyProfile: { role: "Backend" },
    candidateProfile: { summary: "Dev" },
    requirements: { critical: ["TypeScript"], desired: ["K8s"] },
  });
  const user = messages.find((m) => m.role === "user");
  assert.ok(user);
  assert.match(user.content, /=== ВИМОГИ ВАКАНСІЇ/);
  assert.match(user.content, /critical/);
  assert.match(user.content, /TypeScript/);
  assert.match(user.content, /desired/);
  assert.match(user.content, /K8s/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/agents/final-report-agent.test.ts`

Expected: FAIL — параметр `requirements` ще не приймається / блоку немає.

- [ ] **Step 3: Implement**

Онови `buildFinalReportMessages`:

```typescript
export function buildFinalReportMessages(input: {
  transcript: string;
  companyProfile: unknown;
  candidateProfile: unknown;
  requirements: VacancyRequirements;
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
    "",
    "=== ВИМОГИ ВАКАНСІЇ (critical / desired) ===",
    JSON.stringify(input.requirements, null, 2),
  ].join("\n");

  return [
    { role: "system", content: FINAL_REPORT_SYSTEM_PROMPT_UK },
    { role: "user", content: userContent },
  ];
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && node --import tsx --test src/agents/final-report-agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/final-report-agent.ts backend/src/agents/final-report-agent.test.ts
git commit -m "$(cat <<'EOF'
feat: pass explicit vacancy requirements into final-report LLM messages

EOF
)"
```

---

### Task 4: Wire `POST /interviews/:id/end`

**Files:**
- Modify: `backend/src/routes/interviews.ts`
- Modify: `backend/src/routes/interviews.test.ts`

**Interfaces:**
- Consumes: `normalizeVacancyRequirements` з `../utils/vacancy-requirements`; оновлені `buildFinalReportMessages` / `parseFinalReport`

- [ ] **Step 1: Update the end-route test mock + assertions**

У тесті `POST /interviews/:id/end returns 201 and creates FinalReport when LIVE`:

1. Заміни `validReport` на новий контракт:

```typescript
const validReport = JSON.stringify({
  reportMarkdown: "## Підсумок\n\nOK",
  recommendation: "HIRE",
  contextFit: 78,
  assessments: [],
  strengths: ["Досвід"],
  risks: ["Невідомо"],
});
```

2. Додай тест з пріоритетами (скопіюй каркас `makeFakePrisma` / `findUnique` / `$transaction` з сусіднього end-тесту):

```typescript
test("POST /interviews/:id/end computes matchScore from assessments with critical unmet cap", async () => {
  const llmReport = JSON.stringify({
    reportMarkdown:
      "## Підсумок\n\nOK\n## Відповідність вимогам\n### Критичні\n- Rust unmet\n### Бажані\n- Docker met",
    recommendation: "REJECT",
    contextFit: 100,
    assessments: [
      {
        requirement: "Rust",
        priority: "critical",
        status: "unmet",
        evidence: "Немає",
      },
      {
        requirement: "Docker",
        priority: "desired",
        status: "met",
        evidence: "Є",
      },
    ],
    strengths: ["Docker"],
    risks: ["Немає Rust"],
  });

  // companyProfile.requirements = { critical: ["Rust"], desired: ["Docker"] }
  // assert: createdReport.matchScore === computeMatchScore(...).matchScore
  // assert: createdReport.matchScore <= 69
});
```

Імпортуй `computeMatchScore` у тест-файл для expected score.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/routes/interviews.test.ts`

Expected: FAIL — route ще не нормалізує requirements / старий контракт LLM.

- [ ] **Step 3: Wire the route**

У `backend/src/routes/interviews.ts`:

1. Імпорт:

```typescript
import { normalizeVacancyRequirements } from "../utils/vacancy-requirements";
```

2. Після отримання `companyProfile` / `candidateProfile`:

```typescript
const requirements =
  normalizeVacancyRequirements(companyProfile.requirements) ?? {
    critical: [],
    desired: [],
  };

const llmMessages = buildFinalReportMessages({
  transcript: formatLiveTranscript(
    messages.map((m) => ({
      authorType: m.authorType,
      content: m.content,
      candidateConfidence: m.candidateConfidence,
    })),
  ),
  companyProfile,
  candidateProfile,
  requirements,
});
```

3. Парсинг:

```typescript
extracted = parseFinalReport(rawReply, requirements);
```

`FinalReport.create` лишається з `matchScore: extracted.matchScore` (уже обчислене).

- [ ] **Step 4: Run tests**

Run: `cd backend && node --import tsx --test src/routes/interviews.test.ts src/agents/final-report-agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/interviews.test.ts
git commit -m "$(cat <<'EOF'
feat: wire prioritized vacancy requirements into interview end report

EOF
)"
```

---

### Task 5: README

**Files:**
- Modify: `README.md` (секція Final Report API / Day 20)

- [ ] **Step 1: Update docs**

У секції `### Final Report API (Day 20)` після опису LLM додай абзац:

```markdown
**Скоринг:** LLM повертає `assessments` по кожній вимозі вакансії (`critical` / `desired`) і `contextFit`. Підсумковий `matchScore` рахує бекенд тією ж формулою, що й матчинг вакансій (`0.75×critical + 0.25×desired`, mix з `contextFit`, cap **69** при unmet critical). У markdown розділ «Відповідність вимогам» розділяє критичні й бажані; `HIRE` заборонений при unmet critical.
```

У таблиці моделі `FinalReport` для `matchScore` уточни: «обчислено з assessments + contextFit».

- [ ] **Step 2: No automated test** — візуально перевір diff README.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: note prioritized scoring in final interview report

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| LLM assessments + contextFit, без matchScore | Task 1, 2 |
| `computeMatchScore` + cap 69 | Task 2 |
| Валідація повного списку / priority | Task 2 |
| Порожні requirements → score = contextFit | Task 2 |
| Явний блок вимог у messages | Task 3 |
| normalize у `POST .../end` | Task 4 |
| Legacy string[] via normalize | Task 4 (`normalizeVacancyRequirements`) |
| Промпт: Критичні/Бажані, блок HIRE, inferred, skills evidence | Task 1 |
| README | Task 5 |
| Не зберігаємо assessments у БД | — (немає задачі на схему) |
| Немає UI / міграцій | — out of scope |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-final-report-requirement-priority.md`.

**Два варіанти виконання:**

1. **Subagent-Driven (рекомендовано)** — свіжий субагент на кожну задачу, рев’ю між задачами
2. **Inline Execution** — виконую задачі в цій сесії з чекпоінтами

Який підхід?

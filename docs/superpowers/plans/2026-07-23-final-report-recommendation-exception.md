# Final Report Recommendation Exception — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дозволити фінальному звіту відхилятись від critical→recommendation правила через валідні `overrideKind` + `overrideReason`, і показати блок «Виняток» HR під рекомендацією.

**Architecture:** Розширити `parseFinalReport`: спочатку baseline через існуюче critical-правило; якщо є валідний exception і LLM recommendation ≠ baseline — зберегти LLM recommendation + exception; інакше baseline і `null` override. Prisma nullable поля → persist при end-interview → API GET report → `ReportView` блок.

**Tech Stack:** TypeScript, Prisma, Express, Vue 3, `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-23-final-report-recommendation-exception-design.md`

## Global Constraints

- Базове critical-правило лишається default без валідного винятку
- Виняток валідний лише при `overrideKind` ∈ enum **і** `overrideReason.trim().length >= 20`
- Невалідний/частковий виняток → ігнорувати (не throw), застосувати baseline
- Зберігати/показувати override лише якщо recommendation реально відрізняється від baseline
- Decision letter, список звітів, перерахунок старих звітів — поза scope
- Копірайт UI українською; коди kind — англійські snake_case як у spec

---

## File map

| File | Role |
|------|------|
| `backend/src/agents/final-report-agent.ts` | parse exception + нова нормалізація; розширити `ExtractedFinalReport` |
| `backend/src/agents/final-report-agent.test.ts` | TDD тести override |
| `backend/src/agents/prompts/final-report.uk.ts` | опційні поля й правила в промпті |
| `backend/prisma/schema.prisma` | enum + nullable поля на `FinalReport` |
| `backend/prisma/migrations/...` | SQL migration |
| `backend/src/routes/interviews.ts` | persist override при create |
| `backend/src/routes/reports.ts` | віддати override у GET `/:id` |
| `backend/src/routes/reports.test.ts` | assert полів у GET |
| `frontend/src/api/reports.ts` | типи |
| `frontend/src/views/ReportView.vue` | блок «Виняток» |
| `README.md` | коротка згадка exception |

---

### Task 1: Agent — parse exception + normalize (TDD)

**Files:**
- Modify: `backend/src/agents/final-report-agent.ts`
- Modify: `backend/src/agents/final-report-agent.test.ts`

**Interfaces:**
- Produces:
  - `RecommendationOverrideKind = "culture_fit" | "soft_skills" | "critical_gap_ok" | "red_flag" | "other"`
  - `ExtractedFinalReport` з `overrideKind: RecommendationOverrideKind | null` та `overrideReason: string | null`
  - внутрішня логіка: baseline critical → optional exception keep LLM rec
- Consumes: існуючі `validateAssessments`, `computeMatchScore`

- [ ] **Step 1: Write failing tests**

Додати helper у тест-файл (поруч із `sampleReportJson`):

```ts
const VALID_REASON = "Сильний red flag по комунікації під час live."; // >= 20
```

Додати тести:

```ts
test("parseFinalReport keeps MAYBE with exception when all critical met", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "MAYBE",
      overrideKind: "soft_skills",
      overrideReason: VALID_REASON,
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "MAYBE");
  assert.equal(result.overrideKind, "soft_skills");
  assert.equal(result.overrideReason, VALID_REASON);
});

test("parseFinalReport keeps REJECT with exception when all critical met", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "REJECT",
      overrideKind: "red_flag",
      overrideReason: VALID_REASON,
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "REJECT");
  assert.equal(result.overrideKind, "red_flag");
});

test("parseFinalReport keeps HIRE with exception when critical unmet", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "HIRE",
      overrideKind: "critical_gap_ok",
      overrideReason: VALID_REASON,
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
      risks: ["Немає Node.js — прийнятний gap"],
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.overrideKind, "critical_gap_ok");
  assert.equal(result.overrideReason, VALID_REASON);
});

test("parseFinalReport ignores short overrideReason and applies baseline", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "MAYBE",
      overrideKind: "culture_fit",
      overrideReason: "коротко",
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.overrideKind, null);
  assert.equal(result.overrideReason, null);
});

test("parseFinalReport ignores invalid overrideKind and applies baseline", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "MAYBE",
      overrideKind: "nope",
      overrideReason: VALID_REASON,
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "HIRE");
  assert.equal(result.overrideKind, null);
});

test("parseFinalReport strips unused exception when LLM matches baseline", () => {
  const result = parseFinalReport(
    sampleReportJson({
      recommendation: "REJECT",
      overrideKind: "other",
      overrideReason: VALID_REASON,
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
    }),
    sampleRequirements,
  );
  assert.equal(result.recommendation, "REJECT");
  assert.equal(result.overrideKind, null);
  assert.equal(result.overrideReason, null);
});

test("parseFinalReport returns null override when fields omitted", () => {
  const result = parseFinalReport(
    sampleReportJson({ recommendation: "HIRE" }),
    sampleRequirements,
  );
  assert.equal(result.overrideKind, null);
  assert.equal(result.overrideReason, null);
});
```

Існуючі тести baseline (force HIRE / downgrade) **мають лишатися зеленими** — вони не передають override.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npx tsx --test src/agents/final-report-agent.test.ts
```

Expected: FAIL (немає полів / стара логіка завжди форсує HIRE).

- [ ] **Step 3: Implement in `final-report-agent.ts`**

Розширити типи:

```ts
export type RecommendationOverrideKind =
  | "culture_fit"
  | "soft_skills"
  | "critical_gap_ok"
  | "red_flag"
  | "other";

export type ExtractedFinalReport = {
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
  overrideKind: RecommendationOverrideKind | null;
  overrideReason: string | null;
};
```

Додати константи й хелпери:

```ts
const VALID_OVERRIDE_KINDS = new Set<RecommendationOverrideKind>([
  "culture_fit",
  "soft_skills",
  "critical_gap_ok",
  "red_flag",
  "other",
]);

const MIN_OVERRIDE_REASON_LENGTH = 20;

function baselineRecommendation(
  assessments: RequirementAssessment[],
  recommendation: ExtractedFinalReport["recommendation"],
): ExtractedFinalReport["recommendation"] {
  const critical = assessments.filter((a) => a.priority === "critical");
  const allCriticalMet = critical.every((a) => a.status === "met");
  if (allCriticalMet) return "HIRE";
  if (recommendation === "HIRE") return "MAYBE";
  return recommendation;
}

function parseOverride(
  kindRaw: unknown,
  reasonRaw: unknown,
): { kind: RecommendationOverrideKind; reason: string } | null {
  if (typeof kindRaw !== "string" || typeof reasonRaw !== "string") return null;
  if (!VALID_OVERRIDE_KINDS.has(kindRaw as RecommendationOverrideKind)) return null;
  const reason = reasonRaw.trim();
  if (reason.length < MIN_OVERRIDE_REASON_LENGTH) return null;
  return { kind: kindRaw as RecommendationOverrideKind, reason };
}

function resolveRecommendation(
  assessments: RequirementAssessment[],
  llmRecommendation: ExtractedFinalReport["recommendation"],
  kindRaw: unknown,
  reasonRaw: unknown,
): {
  recommendation: ExtractedFinalReport["recommendation"];
  overrideKind: RecommendationOverrideKind | null;
  overrideReason: string | null;
} {
  const baseline = baselineRecommendation(assessments, llmRecommendation);
  const exception = parseOverride(kindRaw, reasonRaw);
  if (!exception || llmRecommendation === baseline) {
    return { recommendation: baseline, overrideKind: null, overrideReason: null };
  }
  return {
    recommendation: llmRecommendation,
    overrideKind: exception.kind,
    overrideReason: exception.reason,
  };
}
```

У `parseFinalReport`: витягнути `overrideKind`, `overrideReason` з JSON; замінити виклик `normalizeRecommendation` на `resolveRecommendation`; повернути нові поля. Видалити старий `normalizeRecommendation` (замінений на `baselineRecommendation` + `resolveRecommendation`).

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npx tsx --test src/agents/final-report-agent.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/final-report-agent.ts backend/src/agents/final-report-agent.test.ts
git commit -m "feat(report): allow recommendation exception with kind and reason"
```

---

### Task 2: Prompt rules

**Files:**
- Modify: `backend/src/agents/prompts/final-report.uk.ts`
- Modify: `backend/src/agents/final-report-agent.test.ts` (prompt asserts)

**Interfaces:**
- Consumes: Task 1 kinds / семантика
- Produces: оновлений `FINAL_REPORT_SYSTEM_PROMPT_UK`

- [ ] **Step 1: Update JSON schema line and recommendation rules**

Замінити рядок схеми на (один рядок JSON-прикладу):

```text
{"reportMarkdown":"...","recommendation":"HIRE|MAYBE|REJECT","contextFit":0-100,"assessments":[{"requirement":"...","priority":"critical|desired","status":"met|unknown|unmet","evidence":"..."}],"strengths":["..."],"risks":["..."],"overrideKind":"culture_fit|soft_skills|critical_gap_ok|red_flag|other","overrideReason":"..."}
```

Замінити bullet про `recommendation` на:

```text
- recommendation — лише HIRE, MAYBE або REJECT; за замовчуванням: якщо всі critical мають status met (або critical немає) — recommendation МАЄ бути HIRE; якщо будь-яка critical має status unmet або unknown — recommendation НЕ може бути HIRE
- можна відхилитись від цього правила ЛИШЕ з обома полями: overrideKind (culture_fit|soft_skills|critical_gap_ok|red_flag|other) і overrideReason (українською, мінімум 20 символів, конкретна причина)
- не додавай overrideKind/overrideReason, якщо recommendation уже відповідає правилу critical
- при HIRE з незакритою critical через виняток — незакрита critical обовʼязково в risks
```

- [ ] **Step 2: Extend prompt test**

У `FINAL_REPORT_SYSTEM_PROMPT_UK requires assessments...` додати:

```ts
assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /overrideKind/);
assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /overrideReason/);
assert.match(FINAL_REPORT_SYSTEM_PROMPT_UK, /critical_gap_ok/);
assert.match(
  FINAL_REPORT_SYSTEM_PROMPT_UK,
  /відхилитись від цього правила ЛИШЕ|можна відхилитись/i,
);
```

Зберегти існуючі asserts про default HIRE / блок HIRE.

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd backend && npx tsx --test src/agents/final-report-agent.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/prompts/final-report.uk.ts backend/src/agents/final-report-agent.test.ts
git commit -m "feat(report): document recommendation exception in final-report prompt"
```

---

### Task 3: Prisma schema + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260723120000_final_report_recommendation_override/migration.sql`

**Interfaces:**
- Produces: Prisma enum `RecommendationOverrideKind` + `FinalReport.overrideKind` / `overrideReason`
- Consumes: Task 1 string union (ті самі значення)

- [ ] **Step 1: Add enum and fields to schema**

Після `enum Recommendation { ... }` додати:

```prisma
enum RecommendationOverrideKind {
  culture_fit
  soft_skills
  critical_gap_ok
  red_flag
  other
}
```

У `model FinalReport` після `risks`:

```prisma
  overrideKind   RecommendationOverrideKind?
  overrideReason String?
```

- [ ] **Step 2: Write migration SQL**

```sql
-- CreateEnum
CREATE TYPE "RecommendationOverrideKind" AS ENUM (
  'culture_fit',
  'soft_skills',
  'critical_gap_ok',
  'red_flag',
  'other'
);

-- AlterTable
ALTER TABLE "FinalReport"
  ADD COLUMN "overrideKind" "RecommendationOverrideKind",
  ADD COLUMN "overrideReason" TEXT;
```

- [ ] **Step 3: Generate client**

```bash
cd backend && npx prisma generate
```

Expected: успіх без помилок.

- [ ] **Step 4: Apply migration locally (якщо БД доступна)**

```bash
cd backend && npx prisma migrate deploy
```

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260723120000_final_report_recommendation_override/migration.sql
git commit -m "feat(db): add FinalReport recommendation override fields"
```

---

### Task 4: Persist + GET report API

**Files:**
- Modify: `backend/src/routes/interviews.ts` (create `finalReport`)
- Modify: `backend/src/routes/reports.ts` (GET `/:id` response)
- Modify: `backend/src/routes/reports.test.ts` (fake prisma + assert)
- Modify: `backend/src/routes/interviews.test.ts` лише якщо create mock типово ламається без нових полів

**Interfaces:**
- Consumes: `extracted.overrideKind`, `extracted.overrideReason` з Task 1
- Produces: API `report.overrideKind`, `report.overrideReason` (`string | null`)

- [ ] **Step 1: Persist on create**

У `interviews.ts` `tx.finalReport.create` data:

```ts
recommendation: extracted.recommendation,
matchScore: extracted.matchScore,
strengths: extracted.strengths,
risks: extracted.risks,
overrideKind: extracted.overrideKind,
overrideReason: extracted.overrideReason,
```

- [ ] **Step 2: Return on GET `/api/reports/:id`**

У `reports.ts` JSON `report` додати:

```ts
overrideKind: report.overrideKind,
overrideReason: report.overrideReason,
```

- [ ] **Step 3: Update `reports.test.ts` fake + assertion**

У тип/seed sample report додати `overrideKind: null`, `overrideReason: null` (і прокинути через fake `findUnique` select/return).

У тесті успішного GET `/:id` додати:

```ts
assert.equal(body.report.overrideKind, null);
assert.equal(body.report.overrideReason, null);
```

Додати окремий тест (або розширити seed):

```ts
test("GET /reports/:id returns override fields when present", async () => {
  const withOverride = {
    ...sampleReport,
    overrideKind: "soft_skills",
    overrideReason: "Сильний red flag по комунікації під час live.",
  };
  // makeApp(makeFakePrisma([withOverride]), hrUser) → GET
  // assert.equal(body.report.overrideKind, "soft_skills");
  // assert.equal(body.report.overrideReason, withOverride.overrideReason);
});
```

Оновити `makeFakePrisma` так, щоб він повертав `overrideKind` / `overrideReason` з seed (за зразком `strengths`/`risks`).

- [ ] **Step 4: Run route tests**

```bash
cd backend && npx tsx --test src/routes/reports.test.ts
cd backend && npx tsx --test src/routes/interviews.test.ts
```

Expected: PASS (за потреби підправити mocks create data).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/interviews.ts backend/src/routes/reports.ts backend/src/routes/reports.test.ts backend/src/routes/interviews.test.ts
git commit -m "feat(api): persist and return final report recommendation override"
```

---

### Task 5: Frontend — types + Exception block

**Files:**
- Modify: `frontend/src/api/reports.ts`
- Modify: `frontend/src/views/ReportView.vue`

**Interfaces:**
- Consumes: API поля з Task 4
- Produces: UI блок «Виняток» під recommendation

- [ ] **Step 1: Extend `FinalReport` type**

```ts
export type RecommendationOverrideKind =
  | "culture_fit"
  | "soft_skills"
  | "critical_gap_ok"
  | "red_flag"
  | "other";

export type FinalReport = {
  id: string;
  interviewId: string;
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
  overrideKind: RecommendationOverrideKind | null;
  overrideReason: string | null;
  createdAt: string;
  latestDecision: LatestDecision | null;
};
```

- [ ] **Step 2: Labels + template in `ReportView.vue`**

У `<script setup>`:

```ts
const OVERRIDE_KIND_LABELS: Record<string, string> = {
  culture_fit: "Культурний fit",
  soft_skills: "Soft skills",
  critical_gap_ok: "Critical gap прийнятний",
  red_flag: "Червоний прапорець",
  other: "Інше",
};

function overrideKindLabel(value: string): string {
  return OVERRIDE_KIND_LABELS[value] ?? value;
}
```

У template **одразу після** `</div>` блоку `summary-row` і **перед** `<section class="decision-block">`:

```vue
      <section
        v-if="report.overrideKind && report.overrideReason"
        class="exception-block"
      >
        <h2 class="exception-title">Виняток</h2>
        <p class="exception-kind">{{ overrideKindLabel(report.overrideKind) }}</p>
        <p class="exception-reason">{{ report.overrideReason }}</p>
      </section>
```

Стилі (мінімально, у тому ж стилі що `info-card` / decision):

```css
.exception-block {
  margin: 1rem 0 1.5rem;
  padding: 1rem 1.25rem;
  border-radius: 8px;
  background: var(--surface-muted, #f1f5f9);
  border: 1px solid var(--border, #cbd5e1);
}
.exception-title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}
.exception-kind {
  margin: 0 0 0.35rem;
  font-weight: 600;
}
.exception-reason {
  margin: 0;
  line-height: 1.45;
}
```

- [ ] **Step 3: Manual check**

Відкрити існуючий звіт без override — блок відсутній, сторінка не падає.  
(Повний E2E з LLM override — опційно після deploy міграції.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/reports.ts frontend/src/views/ReportView.vue
git commit -m "feat(fe): show recommendation exception block on report page"
```

---

### Task 6: README

**Files:**
- Modify: `README.md` (секція фінального звіту / scoring ~рядок про `recommendation`)

**Interfaces:**
- Consumes: поведінка Tasks 1–5

- [ ] **Step 1: Update scoring paragraph**

Після речення про нормалізацію `recommendation` від critical додати:

```text
Відхилення від цього правила дозволене лише з валідними `overrideKind` + `overrideReason` (≥20 символів); тоді бекенд зберігає recommendation від LLM і показує блок «Виняток» у UI звіту. Без валідного винятку baseline critical лишається обовʼязковим.
```

У таблиці полів звіту (якщо є) додати рядки `overrideKind`, `overrideReason` (nullable).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document final-report recommendation exception"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Обидва напрямки exception | Task 1 tests |
| kind + reason, min 20, ignore invalid | Task 1 |
| Зберігати лише якщо ≠ baseline | Task 1 `resolveRecommendation` |
| Prisma fields | Task 3 |
| Persist + GET API | Task 4 |
| UI блок під рекомендацією | Task 5 |
| Decision letter / list out of scope | не в плані |
| Промпт | Task 2 |
| README | Task 6 |

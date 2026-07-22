# Final Report Recommendation from Critical — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Детерміновано виставляти `FinalReport.recommendation = HIRE`, коли всі critical assessments мають `met` (і блокувати HIRE інакше).

**Architecture:** У `parseFinalReport` після валідації assessments викликати `normalizeRecommendation(assessments, llmRecommendation)`. Промпт дублює правила. Desired не впливають.

**Tech Stack:** Node.js `node:test`, TypeScript backend agents.

## Global Constraints

- «Обовʼязкові виконані» = усі critical `met`; будь-який `unknown`/`unmet` блокує HIRE
- Порожні critical → HIRE
- Desired не впливають на override
- При блокуванні HIRE → примусово MAYBE (REJECT від LLM зберігається)
- Існуючі звіти не перераховуємо

---

## File map

| File | Role |
|------|------|
| `backend/src/agents/final-report-agent.ts` | `normalizeRecommendation` + виклик у `parseFinalReport` |
| `backend/src/agents/prompts/final-report.uk.ts` | Правила в system prompt |
| `backend/src/agents/final-report-agent.test.ts` | TDD tests |
| `README.md` | Коротка згадка детермінованого recommendation |

---

### Task 1: Backend normalizeRecommendation (TDD)

**Files:**
- Modify: `backend/src/agents/final-report-agent.ts`
- Modify: `backend/src/agents/final-report-agent.test.ts`

**Interfaces:**
- Produces: `normalizeRecommendation(assessments: RequirementAssessment[], recommendation: "HIRE"|"MAYBE"|"REJECT"): "HIRE"|"MAYBE"|"REJECT"`
- Consumes: validated assessments from `validateAssessments`

- [ ] **Step 1: Write failing tests**

Додати в `final-report-agent.test.ts`:

1. `parseFinalReport forces HIRE when all critical are met even if LLM returned MAYBE`
2. `parseFinalReport downgrades HIRE to MAYBE when any critical is unmet`
3. `parseFinalReport downgrades HIRE to MAYBE when any critical is unknown`
4. `parseFinalReport keeps REJECT when critical unmet and LLM returned REJECT`
5. `parseFinalReport forces HIRE when desired unmet but all critical met`
6. `parseFinalReport forces HIRE when critical list is empty`

Оновити існуючі тести, які очікують `MAYBE` при всіх critical `met` (sample default assessments) — вони мають очікувати `HIRE` після override.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npx tsx --test src/agents/final-report-agent.test.ts
```

- [ ] **Step 3: Implement `normalizeRecommendation` and call from `parseFinalReport`**

```ts
function normalizeRecommendation(
  assessments: RequirementAssessment[],
  recommendation: ExtractedFinalReport["recommendation"],
): ExtractedFinalReport["recommendation"] {
  const critical = assessments.filter((a) => a.priority === "critical");
  const allCriticalMet = critical.every((a) => a.status === "met");
  if (allCriticalMet) return "HIRE";
  if (recommendation === "HIRE") return "MAYBE";
  return recommendation;
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** (лише якщо користувач попросить)

---

### Task 2: Prompt + README

**Files:**
- Modify: `backend/src/agents/prompts/final-report.uk.ts`
- Modify: `backend/src/agents/final-report-agent.test.ts` (assert prompt rules if already checked)
- Modify: `README.md` (секція про фінальний звіт / scoring)

- [ ] **Step 1: Update prompt recommendation rules**

Замінити рядок про recommendation на:
- усі critical `met` (або critical немає) → recommendation **має** бути HIRE
- будь-яка critical `unmet` або `unknown` → recommendation **НЕ** може бути HIRE

- [ ] **Step 2: Assert prompt contains new rules** (розширити існуючий prompt test)

- [ ] **Step 3: README — одне речення про детермінований recommendation від critical**

- [ ] **Step 4: Run full agent test file PASS**

---

## Done when

- Усі пункти тест-плану зі spec зелені
- LLM не може зберегти MAYBE при всіх critical met
- LLM не може зберегти HIRE при unknown/unmet critical

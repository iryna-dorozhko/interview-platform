# Final Report: Recommendation from Critical Requirements

**Дата:** 2026-07-22  
**Статус:** Затверджено  
**Scope:** Жорстке узгодження `FinalReport.recommendation` з assessments критичних вимог

---

## Мета

Зараз `matchScore` рахує бекенд, а `recommendation` (`HIRE` | `MAYBE` | `REJECT`) лишається від LLM. Можлива пара «високий % + Під питанням», навіть коли всі critical закриті як `met`.

Після змін:

1. Якщо **усі critical** мають `status: met` (або critical-список порожній) → збережений `recommendation` завжди `HIRE`.
2. Якщо **хоч один critical** має `unknown` або `unmet` → `recommendation` **не може** бути `HIRE` (примусово `MAYBE`, якщо LLM дав `HIRE`).
3. Між `MAYBE` і `REJECT` при незакритих critical рішення лишається за LLM (бекенд не форсує `REJECT`).

Desired-вимоги **не** впливають на це правило.

---

## Узгоджені рішення

| Тема | Рішення |
|------|---------|
| «Обовʼязкові виконані» | Усі critical = `met` (будь-який `unknown`/`unmet` блокує HIRE) |
| Порожні critical | Вважаємо виконаними → форсувати `HIRE` |
| Desired | Не впливають на recommendation-override |
| Місце enforcement | Бекенд у `parseFinalReport` (як `matchScore`) + правила в промпті |
| LLM recommendation | Валідується як enum; потім нормалізується assessments-правилами |
| Існуючі звіти | Не перераховуємо (YAGNI); правило лише для нових генерацій |

---

## Логіка `normalizeRecommendation`

```text
criticalAssessments = assessments.filter(a => a.priority === "critical")
allCriticalMet = criticalAssessments.every(a => a.status === "met")
  // порожній criticalAssessments → true

if (allCriticalMet):
  return "HIRE"
else:
  if (llmRecommendation === "HIRE"):
    return "MAYBE"
  return llmRecommendation  // MAYBE | REJECT
```

---

## Промпт (`final-report.uk.ts`)

Оновити правило recommendation:

- якщо всі critical мають `met` (або critical немає) — `recommendation` **має** бути `HIRE`;
- якщо будь-яка critical має `unmet` або `unknown` — `recommendation` **НЕ** може бути `HIRE`.

Бекенд лишається source of truth, якщо модель порушить правило.

---

## Зміни в коді

| Файл | Зміна |
|------|--------|
| `backend/src/agents/final-report-agent.ts` | `normalizeRecommendation(assessments, llmRec)` у `parseFinalReport` |
| `backend/src/agents/prompts/final-report.uk.ts` | Жорсткі правила HIRE ↔ critical |
| `backend/src/agents/final-report-agent.test.ts` | Тести: met→HIRE override; unmet/unknown→не HIRE; empty critical→HIRE; desired unmet не блокує |
| `README.md` (коротко) | Згадати детермінований recommendation від critical |

API / схема БД / UI — без змін (`HIRE` уже мапиться на «Найняти»).

---

## Тест-план

- [ ] Усі critical `met`, LLM повернув `MAYBE` → збережено `HIRE`
- [ ] Critical `unmet`, LLM повернув `HIRE` → збережено `MAYBE`
- [ ] Critical `unknown`, LLM повернув `HIRE` → збережено `MAYBE`
- [ ] Critical `unmet`, LLM повернув `REJECT` → лишається `REJECT`
- [ ] Desired `unmet`, усі critical `met` → `HIRE`
- [ ] `critical: []` → `HIRE` незалежно від LLM (після валідного enum)
- [ ] Промпт містить оновлені правила

---

## Поза scope

- Перерахунок уже збережених `FinalReport`
- Автоматичний `REJECT` за формулою
- Звʼязок recommendation з порогом `matchScore` (%, не з assessments)

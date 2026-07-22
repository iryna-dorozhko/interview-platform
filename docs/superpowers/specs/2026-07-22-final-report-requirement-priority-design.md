# Final Report Requirement Priority Design

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming (варіант C)  
**Scope:** У фінальному звіті після live-співбесіди враховувати пріоритет вимог вакансії (`critical` / `desired`) і в тексті звіту, і в детермінованому `matchScore`

---

## Мета

Зараз `FinalReport.matchScore` і розділ «Відповідність вимогам» формує LLM без явного зважування `critical` vs `desired`. Пріоритети вже існують у `CompanyProfile.requirements` і в матчингу вакансій (`computeMatchScore`), але фінальний звіт їх не використовує формально.

Після змін:

1. LLM оцінює **кожну** вимогу вакансії зі статусом `met` | `unknown` | `unmet` і правильним `priority`.
2. Бекенд рахує `matchScore` через існуючий `computeMatchScore` (ті самі ваги й cap 69).
3. Markdown звіту явно розділяє критичні й бажані вимоги; recommendation / risks зважають на незакриті critical сильніше.

---

## Узгоджені рішення

| Тема | Рішення |
|------|---------|
| Підхід | C: формула + правила в промпті |
| Джерело вимог | `normalizeVacancyRequirements(companyProfile.requirements)` |
| Хто ставить `matchScore` | Бекенд (`computeMatchScore`), не LLM |
| Що повертає LLM | `assessments[]`, `contextFit`, `reportMarkdown`, `recommendation`, `strengths`, `risks` (без `matchScore`) |
| Зберігання assessments | Не зберігаємо окремо в БД (YAGNI); у `FinalReport` лише перерахований `matchScore` |
| Candidate `skills.strong` / `growth` | Evidence для оцінки; не плутати з пріоритетом вакансії |
| Legacy requirements | Як у матчингу: `string[]` → усі `desired` |
| Порожні вимоги | Якщо після normalize немає critical і desired — `matchScore` = округлений `contextFit` (поведінка `computeMatchScore`) |

---

## Потік даних

```text
POST /interviews/:id/end (LIVE)
        ↓
companyProfile + candidateProfile + transcript
        ↓
normalizeVacancyRequirements(companyProfile.requirements)
        ↓
buildFinalReportMessages({ transcript, companyProfile, candidateProfile, requirements })
        ↓
LLM → JSON (assessments, contextFit, markdown, recommendation, strengths, risks)
        ↓
parseFinalReport(raw, requirements)
  · валідація assessments (усі вимоги, priority збігається)
  · computeMatchScore(assessments, contextFit) → matchScore
        ↓
FinalReport.create({ ..., matchScore })
```

---

## Контракт LLM

### Вхід (user message)

Як зараз: стенограма + JSON company profile + JSON candidate profile.  
Додатково (або замість неявного читання з JSON): явний блок вимог із позначками `critical` / `desired`, щоб модель не плутала пріоритети.

### Вихід

```json
{
  "reportMarkdown": "...",
  "recommendation": "HIRE|MAYBE|REJECT",
  "contextFit": 0,
  "assessments": [
    {
      "requirement": "...",
      "priority": "critical|desired",
      "status": "met|unknown|unmet",
      "evidence": "..."
    }
  ],
  "strengths": ["..."],
  "risks": ["..."]
}
```

Правила валідації (аналог `vacancy-match-agent`):

- `assessments` містить **рівно** всі пункти `critical` + `desired` (без зайвих і без пропусків).
- `priority` кожного пункту збігається з вхідним списком.
- `contextFit` — ціле / скінченне число 0–100 (нормалізувати/`round` за потреби; відхиляти поза діапазоном).
- Порожній список вимог → `assessments` має бути `[]`.

### `matchScore` (бекенд)

Існуюча формула з `backend/src/services/match-score.ts`:

- `requirementsFit = 0.75 × criticalFit + 0.25 × desiredFit` (або лише наявна категорія).
- `rawScore = 0.8 × requirementsFit + 0.2 × contextFit` (або лише `contextFit`, якщо вимог немає).
- Якщо будь-яка **critical** має `unmet` → `matchScore = min(rawScore, 69)`.
- Статус `unknown` знижує бал, але **не** активує cap.

---

## Промпт (`final-report.uk.ts`)

Додати / оновити правила:

1. Розділ `## Відповідність вимогам` — підзаголовки **Критичні** та **Бажані** (або явна мітка біля кожного пункту).
2. Незакрита critical → обовʼязково в `risks` і сильніше впливає на `recommendation` (не `HIRE`, якщо є unmet critical без помʼякшення з боку стенограми/HR — мінімум: unmet critical блокує `HIRE`).
3. Не підвищувати оцінку відповідності лише через `inferred` без підтвердження людиною (існуюче правило; поширити на assessments: для суттєвих вимог без human confirm не ставити `met` лише з inferred).
4. `skills.strong` / `skills.growth` кандидата — доказ і контекст, не пріоритет вимог вакансії.
5. LLM **не** повертає `matchScore`; повертає `contextFit` і повний `assessments`.

Існуючі правила про мітки confidence (`confirmed` / `inferred` / `unknown`) і пріоритет `HUMAN_CANDIDATE` після unknown — зберегти.

---

## Зміни в коді

| Файл | Зміна |
|------|--------|
| `backend/src/agents/prompts/final-report.uk.ts` | Новий контракт + правила пріоритетів |
| `backend/src/agents/final-report-agent.ts` | Парсинг assessments/`contextFit`; `parseFinalReport(raw, requirements)`; виклик `computeMatchScore`; оновлення `buildFinalReportMessages` |
| `backend/src/agents/final-report-agent.test.ts` | Тести пріоритетів, cap 69, відхилення неповних assessments |
| `backend/src/routes/interviews.ts` | Передати нормалізовані requirements у parse/build |
| `backend/src/routes/interviews.test.ts` | Мок LLM-відповіді під новий JSON; assert обчисленого score за потреби |
| `README.md` | Коротко: фінальний звіт використовує ту саму формулу пріоритетів, що й матчинг |

Повторно використовувати типи/`RequirementAssessment` з `match-score.ts` і патерни валідації з `vacancy-match-agent.ts` (без обовʼязкового великого рефакторингу shared-helper у v1 — допустиме локальне дублювання parse assessment, якщо коротке).

---

## Поза scope

- Зміна схеми `FinalReport` / збереження breakdown у БД.
- Перерахунок історичних звітів.
- Зміна UI сторінки звіту (крім того, що markdown і score природно зміняться).
- Окремий пріоритет навичок кандидата (strong/growth лишаються evidence).

---

## Тест-план

- [ ] `parseFinalReport` з валідними assessments → `matchScore` збігається з `computeMatchScore`.
- [ ] Unmet critical → `matchScore ≤ 69` і `capped` логіка працює.
- [ ] Відсутній / зайвий / wrong-priority assessment → `FinalReportExtractionError`.
- [ ] Legacy `requirements: string[]` нормалізується як desired.
- [ ] Порожні requirements → score = contextFit.
- [ ] `buildFinalReportMessages` / промпт містить critical vs desired.
- [ ] `POST /interviews/:id/end` зберігає обчислений `matchScore`, не «сирий» з LLM.

---

## Критерії готовності

1. Фінальний `matchScore` детермінований від assessments + contextFit і узгоджений з матчингом вакансій.
2. Текст звіту явно розрізняє критичні й бажані вимоги.
3. Тести агента й ендпоінту end покривають новий контракт.

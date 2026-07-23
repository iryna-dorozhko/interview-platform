# Final Report: Recommendation Exception (Override)

**Дата:** 2026-07-23  
**Статус:** Затверджено (дизайн у чаті)  
**Scope:** Дозволити фінальному звіту відхилятись від жорсткого critical→recommendation правила, якщо LLM явно аргументує виняток структурованими полями; показати виняток HR під блоком «Рекомендація».

**Повʼязаний spec:** `2026-07-22-final-report-recommendation-from-critical-design.md` (базове правило лишається default).

---

## Мета

Зараз `normalizeRecommendation` завжди форсує:

- усі critical `met` (або critical немає) → `HIRE`
- будь-який critical `unmet`/`unknown` → recommendation не може бути `HIRE`

Це захищає від суперечливих звітів, але блокує легітимні кейси (culture / soft skills / прийнятний gap / red flags), де категорична рекомендація без пояснення винятку вводить в оману.

Після змін:

1. Базове critical-правило лишається **default**, коли винятку немає або він невалідний.
2. З валідним винятком LLM може відхилитись **в обидва боки** (MAYBE/REJECT при всіх met; HIRE при незакритому critical).
3. HR бачить окремий блок **«Виняток»** під рекомендацією з типом і причиною.

---

## Узгоджені рішення

| Тема | Рішення |
|------|---------|
| Напрямок винятків | Обидва (послабити HIRE і дозволити HIRE при gap) |
| Форма аргументації | `overrideKind` + `overrideReason` (не confidence/riskLevel окремо) |
| Enforcement валідності | Обидва поля валідні; інакше ігноруємо виняток, застосовуємо базове правило (звіт не падає) |
| Коли зберігати/показувати | Лише якщо recommendation **реально відрізняється** від baseline після critical-правил |
| UI | Блок «Виняток» одразу під карткою «Рекомендація»; якщо немає — не рендерити |
| Decision letter | Поза scope цієї ітерації |
| Список звітів / фільтри | Без змін |
| Старі звіти | `null` / відсутній блок; не перераховуємо |

---

## Модель даних

На `FinalReport` додати nullable поля:

- `overrideKind` — enum / обмежений рядок
- `overrideReason` — `String?` (текст українською)

### `overrideKind`

| Код | Підпис у UI |
|-----|-------------|
| `culture_fit` | Культурний fit |
| `soft_skills` | Soft skills |
| `critical_gap_ok` | Critical gap прийнятний |
| `red_flag` | Червоний прапорець |
| `other` | Інше |

### `overrideReason`

- обовʼязковий при наявному kind
- після `trim` мінімум **20** символів
- мова: українська (як strengths/risks)

Prisma: новий enum (напр. `RecommendationOverrideKind`) або `String` з валідацією в парсері — перевага enum для типізації API.

---

## Логіка нормалізації

```text
baseline = normalizeByCritical(assessments, llmRecommendation)
  // як у Day 22:
  // allCriticalMet → HIRE
  // else if llm === HIRE → MAYBE else llm

exception = parseException(overrideKind, overrideReason)
  // валідний лише якщо kind ∈ enum і reason.trim().length >= 20
  // часткові/криві поля → null (не throw)

if exception == null:
  return { recommendation: baseline, overrideKind: null, overrideReason: null }

if llmRecommendation === baseline:
  // виняток не потрібен — не зберігаємо
  return { recommendation: baseline, overrideKind: null, overrideReason: null }

// виняток дозволяє залишити LLM recommendation
return {
  recommendation: llmRecommendation,
  overrideKind: exception.kind,
  overrideReason: exception.reason.trim()
}
```

`matchScore` / assessments / strengths / risks — без змін у цій фічі.

---

## Промпт (`final-report.uk.ts`)

Оновити JSON-схему опційними полями:

```text
"overrideKind":"culture_fit|soft_skills|critical_gap_ok|red_flag|other",
"overrideReason":"..."
```

Правила для моделі:

- за замовчуванням дотримуйся critical↔recommendation як раніше;
- відхиляйся **лише** з обома полями винятку і конкретною причиною;
- не додавай виняток «про запас», якщо recommendation уже відповідає правилу;
- незакрита critical при HIRE через виняток — обовʼязково відобрази в `risks` (існуюче правило лишається).

Бекенд лишається source of truth.

---

## API / персистенція

| Місце | Зміна |
|-------|--------|
| `FinalReport` create у end-interview | зберігати `overrideKind`, `overrideReason` |
| `GET /api/reports/:id` | віддавати обидва поля (`null`, якщо немає) |
| Frontend `FinalReport` type | ті самі поля |
| Decision letter context | **без змін** |

---

## UI (`ReportView.vue`)

Під `summary-row` (після карток matchScore + recommendation), **перед** decision-блоком:

```text
[якщо overrideKind && overrideReason]
  секція «Виняток»
  - підпис типу (українською)
  - текст overrideReason
```

Стиль: існуючі `info-card` / спокійна секція в рамках calm slate-teal; без окремого «dashboard»-шуму. Список звітів без індикатора винятку (YAGNI).

---

## Зміни в коді (орієнтир)

| Файл | Зміна |
|------|--------|
| `backend/prisma/schema.prisma` | enum + поля на `FinalReport` |
| `backend/src/agents/final-report-agent.ts` | parse exception + оновлена нормалізація |
| `backend/src/agents/prompts/final-report.uk.ts` | опційні поля й правила |
| `backend/src/agents/final-report-agent.test.ts` | тести обох напрямків і fallback |
| `backend/src/routes/interviews.ts` | persist полів при create |
| `backend/src/routes/reports.ts` (+ тести за потреби) | select/return полів |
| `frontend/src/api/reports.ts` | типи |
| `frontend/src/views/ReportView.vue` | блок «Виняток» |
| `README.md` (коротко) | згадати exception override |

---

## Тест-план

- [ ] Усі critical met, LLM `MAYBE` **без** винятку → збережено `HIRE`, override `null`
- [ ] Усі critical met, LLM `MAYBE` **з** валідним винятком → `MAYBE` + збережені kind/reason
- [ ] Усі critical met, LLM `REJECT` з винятком → `REJECT` + override
- [ ] Critical unmet, LLM `HIRE` без винятку → `MAYBE`, override `null`
- [ ] Critical unmet, LLM `HIRE` з валідним винятком → `HIRE` + override
- [ ] Critical unmet, LLM `REJECT` (збіг з baseline) навіть із текстом винятку → override `null`
- [ ] Невалідний kind / короткий reason / лише одне поле → baseline, override `null`, без throw
- [ ] API звіту повертає поля; UI показує блок лише коли обидва не `null`
- [ ] Старий звіт без полів — сторінка не ламається
- [ ] Промпт містить оновлені правила

---

## Поза scope

- Передача винятку в decision-letter агент
- Індикатор/фільтр винятку в списку звітів
- Перерахунок уже збережених `FinalReport`
- Окремий `confidence` / `riskLevel` як ключ до override
- Зміна формули `matchScore`

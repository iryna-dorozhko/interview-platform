# Vacancy Work Conditions & Company AI Answers — Design

**Дата:** 2026-07-20  
**Статус:** Затверджено в brainstorming  
**Scope:** Збір умов роботи та зарплати в HR-анкеті вакансії; live AI компанії відповідає кандидату; частковий показ у match-картці

**Передумови:** Global Company Profile + vacancy snapshot (2026-07-16), Deep Candidate Prep з умовами роботи (2026-07-17), Arbiter Conductor (2026-07-16), Vacancy Match (2026-07-17)

---

## Мета

1. **HR-анкета вакансії** збирає умови роботи per-vacancy (зарплата, формат, графік, бенефіти, релокація, випробувальний, обладнання).
2. **Live AI компанії** автоматично відповідає на питання кандидата про ці умови, якщо дані є в профілі вакансії.
3. **Match-картка кандидата** показує зарплату та формат роботи перед «Прийняти / Відхилити».

---

## Узгоджені рішення (brainstorming)

| Питання | Рішення |
|---------|---------|
| Рівень даних | Per-vacancy (кожна вакансія має свої умови) |
| Набір тем | Повний: зарплата, формат, графік, бенефіти, релокація, випробувальний, обладнання |
| Зберігання зарплати | Гібрид: вільний текст у чаті → extraction у `{ min?, max?, currency?, grossNet?, displayText }` |
| Показ кандидату | Частково: лише зарплата + формат у match-картці; решта — через AI на співбесіді |
| Match scoring | Не змінюємо (% match лишається як є) |
| Підхід до даних | Нові поля `workConditions` + `compensation` на `CompanyProfile` (рекомендований підхід A) |

---

## Модель даних

### Prisma — нові поля на `CompanyProfile`

```prisma
workConditions  Json   @default("[]")  // string[] з префіксами
compensation    Json?                  // гібридний об'єкт зарплати
```

**Існуючі поля snapshot** (`culture`, `policies`, `workFormat`, … з `HrCompanyProfile`) **не змінюються** — це контекст компанії. Нові поля — vacancy-specific умови саме цієї посади.

### `workConditions` — префікси

| Префікс | Зміст |
|---------|-------|
| `Формат:` | офіс / hybrid / remote + деталі |
| `Графік:` | повний день, гнучкий, часові зони |
| `Бенефіти:` | відпустки, страховка, навчання |
| `Релокація:` | візова підтримка, релокаційний пакет |
| `Випробувальний:` | тривалість, умови |
| `Обладнання:` | ноутбук, монітори тощо |

Відсутня підтема після уточнення → `"<префікс>: не вказано"`.

### `compensation` — гібридний об'єкт

```typescript
type VacancyCompensation = {
  min?: number;
  max?: number;
  currency?: string;       // "USD", "EUR", "UAH"
  grossNet?: "gross" | "net";
  displayText: string;     // завжди присутній; для UI та match-картки
};
```

Extraction намагається заповнити структуровані поля; `displayText` — обов'язковий fallback для людини та API. Якщо зарплата не названа → `{ "displayText": "не вказано" }`.

---

## HR prep flow

### Company Agent (vacancy) — розширення промпту

Теми збільшуються з **3 до 4**:

1. Посада (без змін)
2. Вимоги (без змін)
3. Очікування (без змін)
4. **Умови роботи** — 7 підтем по черзі, одне питання за раз:

| # | Підтема | Що збираємо |
|---|---------|-------------|
| 1 | Зарплата | діапазон/мінімум, валюта, gross/net |
| 2 | Формат | офіс / hybrid / remote + деталі |
| 3 | Графік | повний день, гнучкий, часові зони |
| 4 | Бенефіти | відпустки, страховка, навчання |
| 5 | Релокація | візова підтримка, релокаційний пакет |
| 6 | Випробувальний | тривалість, умови |
| 7 | Обладнання | ноутбук, монітори тощо |

**READY gate:** усі 4 теми + усі 7 підтем (конкретна відповідь або `"не вказано"`); мінімум 3 змістовні обміни — без змін.

Global Company Profile Agent **не змінюється**.

### Extraction (`vacancy-profile-extraction.uk.ts`)

JSON після finish:

```json
{
  "role": "Middle Backend Developer",
  "requirements": ["Node.js 3+ роки", "PostgreSQL"],
  "expectations": ["Перший місяць — onboarding у команду"],
  "workConditions": [
    "Формат: remote, 2 дні в офісі на місяць",
    "Графік: повний день, UTC+2",
    "Бенефіти: 24 дні відпустки, медстрахування",
    "Релокація: не вказано",
    "Випробувальний: 3 місяці",
    "Обладнання: MacBook Pro, зовнішній монітор"
  ],
  "compensation": {
    "min": 3000,
    "max": 4500,
    "currency": "USD",
    "grossNet": "gross",
    "displayText": "$3000–4500 gross, USD"
  }
}
```

**Файли:** `company-agent.uk.ts`, `vacancy-profile-extraction.uk.ts`, `company-agent.ts` (`ExtractedVacancyProfile`, `parseVacancyProfileExtraction`), `prep.ts` (finish + patch + serialize).

### Editable profile UI (`VacancyPrepView.vue`)

Нова секція **«Умови роботи»** перед confirm:

- **Зарплата** — одне текстове поле (`compensation.displayText`)
- **Решта умов** — textarea з рядками `workConditions` (один пункт на рядок, з префіксами)

Read-only view після confirm — ті самі поля. Тип `CompanyProfile` у `frontend/src/api/prep.ts` розширюється.

---

## Live AI — Company відповідає кандидату

### Проблема

Зараз Company Live Agent працює лише на `NEXT_QUESTION` / `CLARIFY`. Коли кандидат (людина або Candidate Agent через `CANDIDATE_QUESTIONS`) ставить питання про компанію — **немає автоматичного шляху відповіді**; HR має відповідати вручну.

### Розширення контексту

`CompanyLiveProfileContext` і `ArbiterCompanyProfileContext`:

```typescript
{
  role: string;
  requirements: unknown;
  culture: unknown;
  expectations: unknown;
  workConditions: string[];
  compensation: VacancyCompensation | null;
}
```

`runCompanyLiveTurn` / `runArbiterTurn` читають нові поля з `CompanyProfile`.

### Нова команда Arbiter: `COMPANY_ANSWER`

| Ситуація | Дія |
|----------|-----|
| Відкрите питання **від Company до Candidate** | `ANSWER` → Candidate agent (без змін) |
| Відкрите питання **від Candidate до Company** | `COMPANY_ANSWER` → Company agent |
| Після `CANDIDATE_QUESTIONS`, Candidate поставив питання | наступна команда — `COMPANY_ANSWER` (можливо в тому ж conductor-loop) |

**Orchestrator:** `COMPANY_ANSWER` → `runCompanyLiveTurn` з `turnContext.action = "ANSWER_CANDIDATE"`.

Додати `COMPANY_ANSWER` до `ArbiterAction`, промпту Arbiter, парсера та routing table в `orchestrator.ts`.

### Company Live Agent — команда `ANSWER_CANDIDATE`

```
- ANSWER_CANDIDATE — відповідай на питання кандидата про компанію/вакансію/умови.
  1) Факт є в профілі (workConditions, compensation, role, …) → post:true, коротка відповідь.
  2) Факт = "не вказано" або відсутній → post:true, попроси HR відповісти самому.
  Заборонено вигадувати факти поза профілем.
```

Існуючі команди `NEXT_QUESTION` / `CLARIFY` — без змін; правило «можна коротко відповісти на питання кандидата, якщо факт у профілі» залишається.

### Conductor-loop (приклад)

```
1. CANDIDATE_QUESTIONS → Candidate: «Який формат роботи на цій посаді?»
2. COMPANY_ANSWER      → Company: «На цій посаді — remote з двома днями в офісі на місяць.»
3. WAIT або наступне CANDIDATE_QUESTIONS
```

`MAX_CONDUCTOR_STEPS = 6` вистачає для такого ланцюжка.

### Candidate Live Agent

Без змін у логіці — вже ставить питання про зарплату/умови через `CANDIDATE_QUESTIONS`. Company agent тепер може відповісти замість HR.

---

## Match-картка кандидата

### API

Розширений `CandidateMatchOffer`:

```typescript
{
  vacancyId: string;
  title: string;
  matchScore: number;
  salaryDisplay: string | null;     // compensation.displayText
  workFormatDisplay: string | null; // рядок workConditions з префіксом "Формат:" (без префікса в UI)
}
```

**Backend** (`vacancy-match.ts`, `candidate-matches.ts`):
- При побудові offers join `CompanyProfile` для CONFIRMED вакансій
- `salaryDisplay` ← `compensation.displayText`; `null` якщо відсутній або `"не вказано"`
- `workFormatDisplay` ← значення після префікса `Формат:`; `null` якщо `"не вказано"`

Match scoring **не змінюється**.

### Frontend (`CandidateMatchesView.vue`)

Під назвою вакансії — два рядки мета-інформації (якщо не `null`):

```
Senior Backend Developer          87%
💰 $3000–4500 gross, USD
🏢 Remote, 2 дні в офісі на місяць
[Відхилити]  [Прийняти]
```

Тип `CandidateMatchOffer` у `frontend/src/api/candidate-matches.ts` оновлюється.

---

## Scope

### In scope

- Prisma-міграція: `workConditions` + `compensation` на `CompanyProfile`
- Vacancy Company Agent: 4-та тема «Умови роботи» (7 підтем)
- Extraction + editable UI + confirm flow
- Live AI: `COMPANY_ANSWER` + розширений контекст Company/Arbiter
- Match-картка: зарплата + формат

### Out of scope

- Зміна % match scoring / hard filters по зарплаті або формату
- Повна сторінка деталей вакансії для кандидата
- Зміни Global Company Profile Agent
- HR override-кнопки в live-чаті
- Backfill існуючих вакансій (legacy profiles матимуть порожні `workConditions`; live AI делегує HR)

---

## Тестування

| Область | Що перевіряємо |
|---------|----------------|
| `company-agent.test.ts` | Промпт містить «Умови роботи» + 7 підтем |
| `vacancy-profile-extraction` | JSON з `workConditions` + `compensation`; парсер |
| `company-live-agent.test.ts` | Контекст включає `workConditions`, `compensation` |
| `arbiter-agent.test.ts` | `COMPANY_ANSWER` в промпті та парсері |
| `orchestrator.test.ts` | `COMPANY_ANSWER` → Company agent з `ANSWER_CANDIDATE` |
| `vacancy-match` / API | Payload містить `salaryDisplay`, `workFormatDisplay` |

### Manual E2E

1. HR заповнює анкету вакансії з умовами → confirm
2. Кандидат бачить зарплату + формат у match-картці
3. Live-співбесіда: Candidate Agent питає про бенефіти → Company AI відповідає з профілю
4. Питання про те, чого немає в профілі → Company AI просить HR відповісти

---

## Ключові файли

**Backend — agents:**
- `backend/src/agents/prompts/company-agent.uk.ts`
- `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts`
- `backend/src/agents/company-agent.ts`
- `backend/src/agents/prompts/company-live-agent.uk.ts`
- `backend/src/agents/company-live-agent.ts`
- `backend/src/agents/prompts/arbiter-agent.uk.ts`
- `backend/src/agents/arbiter-agent.ts`

**Backend — routes / services:**
- `backend/src/routes/prep.ts`
- `backend/src/routes/candidate-matches.ts`
- `backend/src/services/vacancy-match.ts`
- `backend/src/socket/orchestrator.ts`

**Frontend:**
- `frontend/src/views/VacancyPrepView.vue`
- `frontend/src/views/CandidateMatchesView.vue`
- `frontend/src/api/prep.ts`
- `frontend/src/api/candidate-matches.ts`

**Schema:**
- `backend/prisma/schema.prisma`

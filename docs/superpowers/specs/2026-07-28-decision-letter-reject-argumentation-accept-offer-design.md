# Decision letters: аргументація REJECT + офер у ACCEPT — Design Spec

**Дата:** 2026-07-28  
**Статус:** Затверджено в brainstorming  
**Контекст:** Після звіту HR генерує decision letter (`ACCEPT` / `REJECT` / `ADDITIONAL_MEETING`). Зараз промпт забороняє вигадувати умови оферу і не вимагає явної аргументації відмови; умови вакансії потрапляють лише як сирий `companyProfileJson`.  
**Передумови:** HR decision dialogs (2026-07-22), vacancy work conditions (2026-07-20), `decision-letter-agent`, `POST /api/reports/:id/decisions/draft`.  
**Мова:** Українська (листи, промпти).

---

## Мета

Зробити зміст листів передбачуваним без зміни UX модалки:

1. **REJECT** — лист містить аргументацію на основі фактів зі звіту (`risks` + релевантні фрагменти `reportMarkdown` / recommendation), без вигаданих причин.
2. **ACCEPT** — лист явно вказує офер з вакансії: повний `compensation` + усі `workConditions`. Якщо умов немає або вони «не вказано» — не вигадувати; написати, що деталі узгоджуються в цьому діалозі.
3. **ADDITIONAL_MEETING** — без змін поведінки.

**Поза scope:**

- Нові поля в UI (ручна аргументація / ручний офер перед draft)
- Блокування draft/send при відсутності умов вакансії
- Зміна API контракту draft/send (`{ type }` / `{ type, letterBody }`)
- Email / SMTP
- Зміна моделі `InterviewDecision` / Prisma
- Листи-відмови по заявці до співбесіди (`application-decline-letter`)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Джерело даних | **B** — автоматично зі звіту / вакансії; HR лише редагує готовий лист |
| Немає умов для ACCEPT | **C** — генерувати лист; явно сказати, що деталі узгоджуються в діалозі |
| Склад оферу | **B** — `compensation` + усі `workConditions` |
| Підхід реалізації | **2** — явний контекст оферу + промпт-правила + хелпер (не лише «надія на LLM») |

---

## Підходи (розглянуті)

### 1. Лише промпт — відхилено

Підсилити system prompt; покладатися на існуючий `companyProfileJson`.

**Мінуси:** немає гарантії, що офер/аргументація потраплять у лист; слабкі unit-тести.

### 2. Контекст + промпт + хелпер — обрано

Нормалізувати офер у типізовані поля контексту; оновити промпт; передати з `reports` draft.

### 3. Окремі промпти на кожен тип — відхилено

Зайве дублювання для MVP.

---

## Архітектура

```
ReportView → POST /decisions/draft { type }
                ↓
         loadReportForDecision (vacancy.companyProfile уже є)
                ↓
         extractVacancyOffer(companyProfile) → { offerAvailable, offerLines }
                ↓
         generateDecisionLetter(ctx) → LLM → { type, body }
                ↓
         HR редагує → POST /decisions { type, letterBody }
```

UI і send-шлях **без змін**. Зміни лише в agent + prompt + збірці контексту в draft.

---

## Модель даних / типи

Нові поля в `DecisionLetterContext` (не в Prisma):

```ts
offerAvailable: boolean;
offerLines: string[]; // готові рядки для блоку «ОФЕР»
```

Хелпер (наприклад у `decision-letter-agent.ts` або поруч):

```ts
extractVacancyOffer(companyProfile: unknown): {
  offerAvailable: boolean;
  offerLines: string[];
}
```

### Правила `extractVacancyOffer`

1. Прочитати `compensation` і `workConditions` з профілю вакансії (`CompanyProfile` snapshot на vacancy).
2. Якщо `compensation` є об’єктом з непустим `displayText` і `displayText` (trim, lower) ≠ `"не вказано"` → додати рядок на кшталт `Зарплата: {displayText}`.
3. Для кожного елемента `workConditions` (масив рядків): додати рядок, якщо після trim він непорожній і не закінчується на / не дорівнює патерну «не вказано» (наприклад значення після префікса `Формат: не вказано`).
4. `offerAvailable === true`, якщо `offerLines.length > 0`; інакше `false` і `offerLines = []`.
5. Не вигадувати полів; неформатний JSON → `offerAvailable: false`.

Для **REJECT** окреме поле аргументації не потрібне: у user-контексті вже є `risks`, `strengths`, `reportMarkdown`, `recommendation` — промпт вимагає їх використати.

---

## Промпт (`decision-letter.uk.ts`)

Додати явні правила:

- **REJECT:** обов’язково коротко аргументувати рішення, спираючись на `risks` і факти зі звіту; не вигадувати причин поза вхідними даними; тон ввічливий.
- **ACCEPT:** якщо блок оферу доступний (`offerAvailable`) — обов’язково включити умови з блоку «ОФЕР» у лист (не переказувати весь company profile); якщо офер недоступний — не вигадувати цифри/умови; явно написати, що деталі пропозиції узгоджуються в цьому діалозі.
- **ADDITIONAL_MEETING:** існуючі правила без змін.
- Зберегти заборону вигадувати факти; відповідь — plain text.

У `buildDecisionLetterMessages` додати секцію:

```
=== ОФЕР (УМОВИ ВАКАНСІЇ) ===
available: true|false
- Зарплата: …
- Формат: …
…
```

або при `available: false` — `(умови не вказані — узгодити в діалозі)`.

---

## API

`POST /api/reports/:id/decisions/draft` і `POST /api/reports/:id/decisions`:

- Request/response **без змін** для клієнта.
- Усередині draft: викликати `extractVacancyOffer(report.interview.vacancy.companyProfile)` і передати в `generateDecisionLetter`.

Помилки: як зараз (`400` candidate missing, `502` LLM fail). Відсутність оферу **не** є помилкою.

---

## Frontend

Без змін. `ReportView` як і раніше: кнопка → draft → textarea → send.

---

## Тестування

| Тест | Очікування |
|------|------------|
| `extractVacancyOffer` з compensation + workConditions | `offerAvailable: true`, рядки містять зарплату і умови |
| `extractVacancyOffer` з «не вказано» / порожнім | `offerAvailable: false`, порожній масив |
| `buildDecisionLetterMessages` для ACCEPT | у user content є блок оферу / `available` |
| `buildDecisionLetterMessages` для REJECT | є risks; system/user згадує аргументацію (перевірка промпту або секцій контексту) |
| Промпт-константа | match на ключові інструкції REJECT/ACCEPT + офер / діалог |

Інтеграційний e2e з реальним LLM — поза обов’язковим мінімумом цього spec.

---

## Acceptance criteria

1. Draft `REJECT` отримує контекст зі звіту; промпт вимагає аргументацію з risks/звіту.
2. Draft `ACCEPT` отримує нормалізований офер; при наявності даних лист-інструкція вимагає включити їх.
3. При відсутності умов ACCEPT-інструкція вимагає фразу про узгодження в діалозі (без вигадок).
4. API/UI контракт не зламаний; `ADDITIONAL_MEETING` не регресує.
5. Unit-тести хелпера й збірки messages зелені.

---

## Ризики

| Ризик | Міра |
|-------|------|
| LLM ігнорує інструкцію | Явний блок `=== ОФЕР ===` + жорсткі правила в system prompt; HR може доредагувати |
| Різні форми «не вказано» у рядках | Нормалізація в хелпері (trim + перевірка суфікса/значення) |
| Старі vacancy без `workConditions` | `offerAvailable: false` → гілка «узгодити в діалозі» |

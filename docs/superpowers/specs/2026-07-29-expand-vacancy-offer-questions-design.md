# Розширені питання по offer при заповненні вакансії (Company Agent)

**Дата:** 2026-07-29  
**Статус:** Approve в brainstorming (tone/structure зберігаємо, додаємо глибину offer)

## Контекст

Під час заповнення вакансії HR веде діалог з **Company Agent** (`COMPANY_AGENT_SYSTEM_PROMPT_UK`), який збирає профіль вакансії.

У фінальних комунікаціях “offer” формується з:
- `compensation` (об’єкт `displayText`) для рядка `Зарплата: ...`
- `workConditions` (масив з **рівно 6** рядків з префіксами: `Формат:`, `Графік:`, `Бенефіти:`, `Релокація:`, `Випробувальний:`, `Обладнання:`)

В `backend/src/agents/prompts/vacancy-profile-extraction.uk.ts` schema `workConditions` є жорстко визначеною (префікси + фіксований набір рядків), а `compensation` — лише `displayText` + опційні поля.

## Проблема

Поточні питання про “offer/компенсацію” на рівні Company Agent частково лишаються **узагальненими**, через що в `workConditions` та `compensation.displayText` потрапляє мало конкретики (для decision letter це означає менш “живий” і менш переконливий offer).

## Рішення

Оновити **лише** system prompt для Company Agent (`backend/src/agents/prompts/company-agent.uk.ts`), щоб він:

1. **Деталізував compensation (зарплата)**:
   - просив уточнювати **gross/net**
   - просив, якщо HR згадує бонуси/надбавки/equity, **включати їх у той самий “зарплатний” опис**, який піде в `compensation.displayText`
   - якщо HR не уточнює gross/net або “що входить у компенсацію”, агент задає 1 уточнююче питання перед переходом далі

2. **Деталізував усі 6 workConditions підтем** (через conditional follow-up, а не жорсткий чеклист у кожному повідомленні):
   - `Формат:` remote/office очікування (наприклад, remote-first чи відвідування, “скільки днів”)
   - `Графік:` core hours, timezone
   - `Бенефіти:` PTO/відпустки (хоча б порядок цифр), страхування (тип/охоплення на високому рівні), навчання/бюджет
   - `Релокація:` візова підтримка + що саме входить у пакет (житло/перельоти/допомога на старт)
   - `Випробувальний:` тривалість та як оцінюють/умови
   - `Обладнання:` ноутбук (OS/клас), монітори/периферія та бюджет/політика

3. **Не ламав контракт готовності (`READY:true/false`)**:
   - READY gate і його критерії залишаються такими ж, як і зараз
   - порядок тем залишається natural/гнучким
   - “1 питання за раз” залишається

## Scope

### In scope
- `backend/src/agents/prompts/company-agent.uk.ts`: розширення інструкцій для salary/offer і 6 підтем workConditions
- `backend/src/agents/company-agent.test.ts`: корекція очікувань, якщо тести прив’язані до конкретних фраз (при збереженні змісту)

### Out of scope (навмисно)
- Не змінюємо `VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK` (JSON schema)
- Не змінюємо `decision-letter-agent` або логіку побудови `offerLines`
- Не додаємо нові UI поля в `VacancyPrepView.vue`
- Live-агенти (арбітр, company-live, candidate-live) — не чіпаємо в рамках цього завдання

## Тестування

Мінімальний набір:
- `backend/src/agents/company-agent.test.ts` (pass)

Додатково (якщо виявляться залежності через regex/якорі):
- `backend/src/agents/*profile extraction*` тести (але без зміни schema)

## Ризики

1. **Тести можуть бути прив’язані до конкретних фраз у промпті** — тоді оновлюємо очікування тестів (не змінюючи контракту).
2. **Занадто довгі/жорсткі інструкції** можуть погіршити natural-стиль — тому follow-up має бути conditional: “якщо відповідь неповна — уточни”.


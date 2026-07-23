# Статус заявки після листів HR — Design Spec

**Дата:** 2026-07-23  
**Статус:** Затверджено в brainstorming  
**Контекст:** Заявки кандидатів на вакансії (`VacancyApplication`) мають змінювати статус, коли HR надсилає лист-відповідь — як до співбесіди (відмова з «Заявок»), так і після (decision letter зі звіту).  
**Передумови:** `/applications` (`HrApplicationsView`), decision letters на `ReportView`, «Діалоги», enum `VacancyApplicationStatus` з `DECLINED_BY_HR` (UX відмови ще не реалізований).  
**Мова:** Українська (UI, листи, повідомлення про помилки)

---

## Контекст і мета

Уже є:

- Заявка `PENDING` → HR створює співбесіду → `CONVERTED`
- Після звіту: Accept / Reject / Additional meeting → LLM-лист у «Діалоги» (`InterviewDecision` + `DECISION_LETTER`)
- Підбір вакансій блокує лише активну заявку зі статусом `PENDING`

**Що відсутнє:**

- Відмова HR по заявці до співбесіди (статус `DECLINED_BY_HR` у моделі є «про запас»)
- Оновлення статусу заявки, коли HR надсилає decision letter після співбесіди
- Окремі статуси для прийняття та додаткової зустрічі

**Мета:** Коли HR надсилає лист-відповідь кандидату, статус пов’язаної заявки відображає рішення (відмовлено / прийнято / потрібна ще зустріч). Після відмови кандидат одразу знову може підбирати вакансії.

**Поза scope:**

- Email / push
- Авто-створення нової співбесіди при «додаткова зустріч»
- Окремий екран історії всіх заявок у кабінеті кандидата
- Зміна статусу заявки без листа (кнопка «відхилити» без діалогу)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Scope | **C** — і до співбесіди, і після |
| Відмова до співбесіди | **B** — LLM-чернетка → редагування → лист у «Діалоги» → `DECLINED_BY_HR` |
| Статуси після співбесіди | **B** — окремий статус на кожне рішення |
| Підбір після відмови | **A** — одразу розблокувати (достатньо зняти `PENDING`) |
| Архітектура | **Підхід 1** — розширити enum заявки + reuse механізму листів; sync при send decision |

---

## Підходи (розглянуті)

### 1. Розширити статуси заявки + той самий механізм листа — обрано

Нові значення enum; decline API на applications; при `POST /reports/:id/decisions` оновлювати linked `VacancyApplication`.

**Плюси:** мінімум нових сутностей; UX листів уже знайомий HR.  
**Мінуси:** окремий prompt/контекст для відмови без final report.

### 2. Окрема `ApplicationDecision` — відхилено

**Плюси:** чистіша історія рішень по заявці.  
**Мінуси:** зайва модель/API за ту саму поведінку.

### 3. Уніфікований Decision для заявок і звітів — відхилено

**Плюси:** довгострокова єдність.  
**Мінуси:** великий рефакторинг поза поточним scope.

---

## Статуси `VacancyApplicationStatus`

| Статус | Коли |
|--------|------|
| `PENDING` | Кандидат подав заявку; HR ще не відповів листом і не створив співбесіду |
| `CONVERTED` | HR створив співбесіду з заявки |
| `DECLINED_BY_HR` | HR надіслав лист-відмову (до співбесіди **або** Reject після звіту) |
| `ACCEPTED` | Після співбесіди HR надіслав Accept-лист |
| `ADDITIONAL_MEETING` | Після співбесіди HR надіслав лист «потрібна ще зустріч» |
| `WITHDRAWN` | Без змін у цьому spec (кандидат відкликав) |

### Мапінг decision letter → статус заявки

| `InterviewDecisionType` | `VacancyApplicationStatus` |
|-------------------------|----------------------------|
| `REJECT` | `DECLINED_BY_HR` |
| `ACCEPT` | `ACCEPTED` |
| `ADDITIONAL_MEETING` | `ADDITIONAL_MEETING` |

Підбір вакансій і надалі блокує **лише** `PENDING` — після `DECLINED_BY_HR` / інших фінальних статусів кандидат знову бачить пропозиції.

**Та сама вакансія після HR-рішення:** при переході в `DECLINED_BY_HR`, `ACCEPTED` або `ADDITIONAL_MEETING` записати (upsert) `VacancyOfferDecision(REJECTED)` для пари кандидат+вакансія — щоб ця вакансія більше не з’являлась у sequential offers. Це reuse існуючого журналу відхилень підбору, без нових моделей.

---

## Потік A: відмова до співбесіди

На `/applications` для заявки зі статусом `PENDING`:

1. Кнопка «Відхилити»
2. Модалка як на звіті: LLM генерує чернетку (контекст: назва вакансії + `candidateSummary`, без `FinalReport`)
3. HR редагує текст
4. «Надіслати» → find-or-create `Dialog` (пара HR↔кандидат) → `DialogMessage` з `kind: DECISION_LETTER` (**без** `InterviewDecision`, бо немає звіту) → `VacancyApplication.status = DECLINED_BY_HR`
5. Кнопка «Створити співбесіду» більше недоступна

### API

| Метод | Шлях | Поведінка |
|-------|------|-----------|
| `POST` | `/api/hr/applications/:id/decline/draft` | LLM-чернетка листа-відмови; `{ body }` |
| `POST` | `/api/hr/applications/:id/decline` | Body: `{ letterBody }`; лист у діалог + статус `DECLINED_BY_HR` |

**Помилки:**

| Умова | Код |
|-------|-----|
| Заявка не знайдена / чужа | 404 |
| Статус не `PENDING` | 409 |
| Порожній `letterBody` | 400 |
| Збій LLM на draft | 502 |

Транзакція на send: оновлення статусу + створення повідомлення діалогу атомарно (або rollback).

---

## Потік B: після співбесіди (існуючий send decision)

У `POST /api/reports/:id/decisions` після створення `InterviewDecision` і листа:

1. Знайти `VacancyApplication` де `interviewId = report.interviewId`
2. Якщо знайдено — оновити `status` за мапінгом вище
3. Якщо заявки немає (співбесіда створена вручну) — поведінка без змін, лише лист
4. Повторне рішення HR → статус заявки **перезаписується** останнім типом (узгоджено з уже дозволеною зміною decision letters)

Не змінювати інваріанти create-interview: з `PENDING` лише в `CONVERTED`.

---

## Frontend

### HR `/applications`

- Підписи статусів українською: зокрема «Прийнято», «Потрібна додаткова зустріч», «Відхилено HR»
- Для `PENDING`: кнопка «Відхилити» + модалка draft/send (патерн як на `ReportView`)
- Після успішного decline — оновити деталь/список; сховати create-interview

### Кандидат

- Бачить лист у «Діалоги»
- `GET /candidate/applications/active` уже повертає лише `PENDING` — після decline активна заявка зникає, підбір знову доступний
- Окремий UI історії заявок — поза scope

### Звіт

- Без обов’язкових UI-змін: sync статусу на бекенді при існуючому «Надіслати»

---

## Дані / міграція

- Prisma: додати до enum `VacancyApplicationStatus` значення `ACCEPTED`, `ADDITIONAL_MEETING`
- Нових моделей не потрібно
- Існуючі рядки: без backfill (історичні `CONVERTED` лишаються, доки HR не надішле нове рішення)

---

## Тестування

**Backend**

- Decline draft / decline send → `DECLINED_BY_HR` + `DECISION_LETTER` у діалозі
- Decline на non-`PENDING` → 409
- `POST .../decisions` з linked application оновлює статус за типом
- Повторний decision перезаписує статус
- Decision без linked application — 201 як раніше, без помилки

**Frontend**

- Підписи нових статусів
- Модалка decline на заявках
- `npm run build` у `frontend/`

---

## Звʼязок з поточним кодом

- Заявки: `backend/src/routes/hr-applications.ts`, `frontend/src/views/HrApplicationsView.vue`
- Decision letters: `backend/src/routes/reports.ts`, `decision-letter-agent`
- Діалоги: `Dialog` / `DialogMessage`, `emitDialogMessage`
- Match lock: `candidate-matches` — `status: PENDING`
- Design заявок v1: `docs/superpowers/specs/2026-07-17-vacancy-match-application-design.md` (там `DECLINED_BY_HR` був поза scope)
- Design рішень: `docs/superpowers/specs/2026-07-22-hr-decision-dialogs-design.md`

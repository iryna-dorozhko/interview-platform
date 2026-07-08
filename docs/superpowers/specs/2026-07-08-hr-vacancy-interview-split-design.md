# HR: розділення Анкети та Співбесіди — Design Spec

**Дата:** 2026-07-08  
**Статус:** Затверджено в brainstorming  
**Контекст:** Рефакторинг HR-кабінету — замість однієї сутності `Interview`, що поєднує профіль вакансії і сесію з кандидатом, вводимо дві: **Анкета** (`Vacancy`) і **Співбесіда** (`Interview`).  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

Зараз `Interview` виконує дві ролі одночасно:
1. **Профіль вакансії** — prep-чат з Company Agent, `CompanyProfile`, підтвердження (Days 4–7).
2. **Сесія з кандидатом** — `joinCode`, candidate prep, live room, звіт (Days 8+).

HR потребує окремо керувати **анкетами на різні посади** (назва, дата, статус, редагування, видалення) і **співбесідами з конкретними кандидатами** після попереднього відбору. Співбесіда створюється лише на базі підтвердженої анкети.

Мета: розділити доменні сутності, додати глобальну бічну панель HR-кабінету, головний екран-огляд і окремі списки анкет та співбесід.

---

## Рішення з brainstorming

| # | Рішення |
|---|---|
| 1 | Нова модель `Vacancy` (Анкета); `Interview` лишається для сесій з кандидатами |
| 2 | Зв'язок **1 анкета → N співбесід** (`Interview.vacancyId`) |
| 3 | Створення анкети: спочатку форма з полем «Назва вакансії», потім prep-чат |
| 4 | Створення співбесіди: вибір **підтвердженої** анкети з dropdown |
| 5 | Назва співбесіди в списку: спочатку = назва анкети; після входу кандидата — email/ім'я кандидата (реалізація оновлення — Day 10+, поле закладено зараз) |
| 6 | Редагування анкети завжди доступне; редагування підтвердженої → статус `DRAFT`, `confirmedAt` скидається, потрібне повторне підтвердження |
| 7 | Видалення анкети **заблоковано**, якщо є прив'язані співбесіди |
| 8 | Глобальна бічна панель HR на всіх сторінках після логіну |
| 9 | Головний екран — overview-картки + дві кнопки створення; детальні списки — через бічну панель |
| 10 | Prep-флоу (Days 4–7) переїжджає з `interviewId` на `vacancyId` |

**Обраний підхід до даних:** нова таблиця `Vacancy` (Підхід A). Альтернативи (поле `kind` на `Interview` або лише UI-переіменування) відхилені через технічний борг і невідповідність моделі 1→N.

---

## Модель даних

### `Vacancy` (Анкета) — нова модель

```prisma
enum VacancyStatus {
  DRAFT
  CONFIRMED
}

model Vacancy {
  id        String        @id @default(cuid())
  hrUserId  String
  title     String
  status    VacancyStatus @default(DRAFT)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  hrUser           User              @relation("HrVacancies", fields: [hrUserId], references: [id])
  companyProfile   CompanyProfile?
  prepSessionHr    PrepSessionHr?
  interviews       Interview[]

  @@index([hrUserId, createdAt(sort: Desc)])
}
```

### `Interview` (Співбесіда) — зміни

```prisma
model Interview {
  id              String          @id @default(cuid())
  hrUserId        String
  vacancyId       String          // NEW: required FK
  candidateUserId String?
  displayName     String          // NEW: vacancy.title → candidate email/name
  joinCode        String          @unique @db.Char(6)
  status          InterviewStatus @default(AWAITING_CANDIDATE)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  hrUser           User                  @relation("HrInterviews", ...)
  vacancy          Vacancy               @relation(...)
  candidateUser    User?                 @relation("CandidateInterviews", ...)
  candidateProfile CandidateProfile?
  prepSessionCd    PrepSessionCandidate?
  liveSession      LiveSession?
  finalReport      FinalReport?

  // REMOVED: companyProfile, prepSessionHr
}
```

**Зміни в `InterviewStatus`:** статус `DRAFT` більше не використовується для `Interview` (prep тепер на `Vacancy`). Початковий статус нової співбесіди — `AWAITING_CANDIDATE`.

### Перенесення зв'язків

| Модель | Було | Стане |
|---|---|---|
| `CompanyProfile` | `interviewId` (unique) | `vacancyId` (unique) |
| `PrepSessionHr` | `interviewId` (unique) | `vacancyId` (unique) |
| `PrepSessionCandidate` | `interviewId` | без змін |
| `LiveSession`, `FinalReport` | `interviewId` | без змін |

### Міграція seed-даних

Поточний seed (`TEST01` + `CompanyProfile` на `Interview`):

1. Створити `Vacancy` з `title = "Test Position"`, `status = CONFIRMED`.
2. Перенести `CompanyProfile` і `PrepSessionHr` на `vacancyId`.
3. `Interview` з `joinCode = TEST01` отримує `vacancyId`, `displayName = vacancy.title`, `status = AWAITING_CANDIDATE`.

---

## Статуси та бізнес-правила

### Анкета (`VacancyStatus`)

| Статус | Мітка в UI | Опис |
|---|---|---|
| `DRAFT` | Чернетка | Prep-чат не завершено або профіль не підтверджено; також після повторного редагування підтвердженої анкети |
| `CONFIRMED` | Підтверджена | Профіль підтверджено; можна створювати співбесіди |

### Співбесіда (`InterviewStatus`)

| Статус | Мітка в UI | Опис |
|---|---|---|
| `AWAITING_CANDIDATE` | Очікує кандидата | Створена, код видано, кандидат ще не приєднався |
| `READY` | Готова | Обидва профілі підтверджені (Day 14+) |
| `LIVE` | В ефірі | Live room активна (Days 15–19) |
| `ENDED` | Завершена | Співбесіда завершена |

### Правила

- **Створити співбесіду** можна лише для анкети зі статусом `CONFIRMED`, що належить поточному HR.
- **Видалити анкету** можна лише якщо `interviews.length === 0`.
- **Редагувати підтверджену анкету** (`PATCH /vacancies/:id` зі зміною профілю або назви): `status → DRAFT`, `companyProfile.confirmedAt → null`; існуючі співбесіди не видаляються.
- **Підтвердження профілю** (`POST /prep/:vacancyId/confirm`): `Vacancy.status → CONFIRMED` (замість зміни `Interview.status`).

---

## Навігація та layout

### Глобальний каркас `HrLayout`

```
┌─────────────────────────────────────────────────────┐
│  Header: Interview Platform  │  email  │  Вийти    │
├──────┬──────────────────────────────────────────────┤
│  📋  │                                              │
│Анкети│         <router-view>                        │
│      │                                              │
│  🎤  │                                              │
│Співб.│                                              │
└──────┴──────────────────────────────────────────────┘
```

**Бічна панель (завжди видима після логіну HR):**

| Іконка | Мітка | Маршрут | Контент |
|---|---|---|---|
| 📋 | Профіль вакансії | `/vacancies` | Таблиця анкет: назва, дата, статус, дії |
| 🎤 | Список співбесід | `/interviews` | Таблиця співбесід: назва, код, дата, статус, звіт |

### Маршрути (Vue Router)

| Маршрут | Компонент | Опис |
|---|---|---|
| `/` | `HrHomeView` | Overview-картки + кнопки створення |
| `/vacancies` | `VacancyListView` | Список анкет |
| `/vacancies/:id` | `VacancyDetailView` | Перегляд профілю вакансії |
| `/vacancies/:id/prep` | `VacancyPrepView` | Чат з Company Agent (перенос `CompanyPrepView`) |
| `/interviews` | `InterviewListView` | Список співбесід |
| `/interviews/:id` | `InterviewDetailView` | Заглушка «Скоро з'явиться» |

**Deprecated:** `/prep/:interviewId` → редірект або видалення; замінюється `/vacancies/:id/prep`.

### Головний екран `/`

- Дві кнопки: **«Створити нову анкету»**, **«Створити нову співбесіду»**.
- Overview-картки: кількість анкет, співбесід, очікують кандидата.
- Блок «Останні дії» — 2–3 останні записи (анкета або співбесіда).

### Кнопки створення

**«Створити нову анкету»:**
1. Модалка з полем «Назва вакансії» (обов'язкове, min 2 символи).
2. `POST /api/vacancies { title }`.
3. Редірект на `/vacancies/:id/prep`.

**«Створити нову співбесіду»:**
1. Модалка з dropdown підтверджених анкет (`GET /vacancies/mine?status=CONFIRMED` або фільтр на клієнті).
2. `POST /api/interviews { vacancyId }`.
3. Банер з `joinCode`; новий рядок у списку співбесід.

### Списки

**`/vacancies` — колонки:** Назва | Дата створення | Статус | Дії (Редагувати / Видалити / Пройти анкету для `DRAFT`).

**`/interviews` — колонки:** Назва | Код | Дата | Статус | Звіт (заглушка `—`).

---

## API-контракт

### Анкети — `/api/vacancies`

#### `GET /api/vacancies/mine`

```
Headers: Authorization: Bearer <HR JWT>
```

Відповідь `200`:

```json
{
  "vacancies": [
    {
      "id": "vac_1",
      "title": "Frontend Developer",
      "status": "CONFIRMED",
      "createdAt": "2026-07-08T08:00:00.000Z"
    }
  ]
}
```

Сортування: `createdAt desc`.

#### `POST /api/vacancies`

```json
{ "title": "Frontend Developer" }
```

Відповідь `201`:

```json
{
  "vacancy": {
    "id": "vac_1",
    "title": "Frontend Developer",
    "status": "DRAFT",
    "createdAt": "2026-07-08T08:00:00.000Z"
  }
}
```

#### `GET /api/vacancies/:id`

Повертає vacancy + profile (якщо є) + prep session state.

#### `PATCH /api/vacancies/:id`

```json
{ "title": "Senior Frontend Developer" }
```

Якщо `status === CONFIRMED`: скидає `confirmedAt`, `status → DRAFT`.

#### `DELETE /api/vacancies/:id`

- `409` якщо є прив'язані співбесіди: `{ "error": "Cannot delete vacancy with linked interviews", "interviewCount": 3 }`.
- `200` якщо видалено успішно.

### Prep — `/api/prep/:vacancyId/*`

Усі ендпоінти з `interviewId` замінюються на `vacancyId`:

| Метод | Шлях | Зміни |
|---|---|---|
| `GET` | `/prep/:vacancyId` | Читає `PrepSessionHr` + `CompanyProfile` за `vacancyId` |
| `POST` | `/prep/:vacancyId/message` | Логіка чату без змін |
| `POST` | `/prep/:vacancyId/finish` | Профіль прив'язується до `Vacancy` |
| `POST` | `/prep/:vacancyId/confirm` | `Vacancy.status → CONFIRMED` |
| `DELETE` | `/prep/:vacancyId` | Скидає чат і профіль анкети |

Авторизація: `vacancy.hrUserId === req.user.id`.

### Співбесіди — `/api/interviews`

#### `GET /api/interviews/mine`

Відповідь `200`:

```json
{
  "interviews": [
    {
      "id": "int_1",
      "vacancyId": "vac_1",
      "vacancyTitle": "Frontend Developer",
      "displayName": "Frontend Developer",
      "joinCode": "K7M2P9",
      "status": "AWAITING_CANDIDATE",
      "createdAt": "2026-07-08T09:00:00.000Z",
      "reportSummary": null
    }
  ]
}
```

`reportSummary` — заглушка `null` до реалізації звітів.

#### `POST /api/interviews`

```json
{ "vacancyId": "vac_1" }
```

Відповідь `201`:

```json
{
  "interview": {
    "id": "int_1",
    "vacancyId": "vac_1",
    "displayName": "Frontend Developer",
    "joinCode": "K7M2P9",
    "status": "AWAITING_CANDIDATE",
    "createdAt": "2026-07-08T09:00:00.000Z"
  }
}
```

Перевірки:
- `vacancy.status === CONFIRMED` → інакше `400`.
- `vacancy.hrUserId === req.user.id` → інакше `403`.

---

## Обробка помилок

| Ситуація | HTTP | Повідомлення |
|---|---|---|
| Створити співбесіду для непідтвердженої анкети | `400` | «Анкета ще не підтверджена» |
| Створити співбесіду для чужої анкети | `403` | «Forbidden» |
| Видалити анкету з прив'язаними співбесідами | `409` | «Неможливо видалити: є прив'язані співбесіди (N)» |
| Редагування підтвердженої анкети | `200` | Статус → `DRAFT`; UI показує попередження про повторне підтвердження |
| Підтвердити вже підтверджену анкету | `409` | «Profile already confirmed» |
| Prep для чужої анкети | `403` | «Forbidden» |
| Анкета / співбесіда не знайдена | `404` | Стандартне повідомлення |
| Колізія join code | `500` | «Failed to generate unique join code» (як зараз) |

---

## Frontend — ключові компоненти

| Компонент | Призначення |
|---|---|
| `HrLayout.vue` | Header + sidebar + `<router-view>` |
| `HrSidebar.vue` | Іконки навігації |
| `HrHomeView.vue` | Overview-картки, кнопки створення |
| `VacancyListView.vue` | Таблиця анкет |
| `VacancyDetailView.vue` | Перегляд профілю |
| `VacancyPrepView.vue` | Перенос логіки з `CompanyPrepView.vue` |
| `InterviewListView.vue` | Таблиця співбесід |
| `InterviewDetailView.vue` | Заглушка |
| `CreateVacancyModal.vue` | Форма назви |
| `CreateInterviewModal.vue` | Dropdown підтверджених анкет |

**API-клієнти:**
- `frontend/src/api/vacancies.ts` — CRUD анкет.
- `frontend/src/api/prep.ts` — оновити URL з `interviewId` на `vacancyId`.
- `frontend/src/api/interviews.ts` — оновити типи та `POST` body.

---

## Тестування

### Backend (node:test)

- `vacancies.test.ts`: CRUD, delete blocked with interviews, edit confirmed → DRAFT.
- `prep.test.ts`: оновити на `vacancyId`; confirm встановлює `Vacancy.status = CONFIRMED`.
- `interviews.test.ts`: POST з `vacancyId`, перевірка `displayName`, 400 для DRAFT vacancy.
- Seed smoke: `TEST01` interview працює після міграції.

### Frontend

- `vue-tsc --noEmit` без помилок.
- Ручний сценарій:
  1. Логін HR → overview-картки видно.
  2. Створити анкету → prep-чат → finish → confirm.
  3. Створити співбесіду → код у банері → рядок у `/interviews`.
  4. Бічна панель перемикає `/vacancies` ↔ `/interviews`.
  5. Спроба видалити анкету зі співбесідою → помилка 409.
  6. Редагування підтвердженої анкети → статус «Чернетка», повторне підтвердження.

---

## Scope

### In scope

- Модель `Vacancy` + Prisma-міграція.
- Перенос prep-флоу на `vacancyId`.
- `HrLayout` з глобальною бічною панеллю.
- Overview-головна, списки анкет і співбесід.
- Модалки створення.
- CRUD анкет з правилами вище.
- Оновлення seed, README, існуючих тестів.

### Out of scope

- Live-кімната (`InterviewDetailView` — заглушка).
- `reportSummary` у списку (колонка є, дані `—`).
- Candidate join-by-code (Day 10+).
- Автооновлення `displayName` при вході кандидата (поле є, логіка — Day 10+).
- Пагінація, фільтри, архівування.
- Редагування співбесіди після створення.

---

## Залежності від попередніх днів

| День | Що змінюється |
|---|---|
| Days 4–7 | Prep-API і UI переїжджають на `vacancyId`; логіка Company Agent без змін |
| Day 8 | `POST /interviews` тепер вимагає `vacancyId`; кнопка на головному екрані |
| Day 9 | Дашборд замінюється на overview + окремі списки через sidebar |

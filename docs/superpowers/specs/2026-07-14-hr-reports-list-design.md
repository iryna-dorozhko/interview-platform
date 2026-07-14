# Вкладка «Звіти» в HR-кабінеті — Design Spec

**Дата:** 2026-07-14  
**Статус:** Затверджено в brainstorming  
**Контекст:** HR потрібен окремий каталог усіх фінальних звітів із короткою інформацією та фільтрами  
**Передумови:** Day 21 — `GET /api/reports/:id`, `ReportView` на `/report/:id`, модель `FinalReport`  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- `FinalReport` у PostgreSQL (`recommendation`, `matchScore`, `reportMarkdown`, `strengths`, `risks`, `createdAt`)
- Генерацію звіту через `POST /api/interviews/:id/end`
- Перегляд одного звіту на `/report/:id`
- Колонку «Звіт» у списку співбесід (`reportSummary` = `HIRE`/`MAYBE`/`REJECT`)
- HR-сайдбар: Головна / Анкети / Співбесіди

**Що відсутнє:**

- Список усіх звітів HR в одному місці
- Короткі поля в списку: пошта кандидата, оцінка, рекомендація, дата, вакансія
- Фільтри за вакансією, рекомендацією, поштою, діапазоном дат
- Пункт навігації «Звіти»

**Мета:** HR відкриває вкладку «Звіти», бачить усі свої фінальні звіти з summary-полями, фільтрує їх і переходить у повний звіт.

**Поза scope:**

- Доступ кандидата до звітів
- Експорт PDF / CSV
- Пагінація (можна додати пізніше)
- Зміни Prisma-схеми
- Прибирання колонки «Звіт» зі списку співбесід
- Регенерація звіту

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Мета вкладки | **B** — каталог завершених звітів + фільтри; клік → існуючий повний звіт |
| Набір фільтрів | **C** — рекомендація + пошта + діапазон дат + вакансія |
| Фільтр вакансії | **A** — dropdown вакансій HR (`GET /api/vacancies/mine`) |
| Колонки таблиці | **B** — пошта, вакансія, оцінка, рекомендація, дата |
| Layout | **A** — таблиця як «Співбесіди», фільтри зверху одним рядом |
| Архітектура | **1** — окремий `GET /api/reports` з server-side query-фільтрами + `ReportListView` |

---

## Підходи (розглянуті)

### 1. Окремий `GET /api/reports` + `ReportListView` (обрано)

List-endpoint лише для звітів поточного HR із query-параметрами; окремий view і пункт сайдбару.

**Плюси:** чітка сутність «звіти»; фільтри масштабуються; не змішує співбесіди й результати.  
**Мінуси:** +1 list-handler у reports router і новий view.

### 2. Розширити список співбесід + клієнтські фільтри (відхилено)

Брати `ENDED` з `GET /interviews/mine`, фільтрувати лише на фронті.

**Плюси:** менше backend-роботи.  
**Мінуси:** важкий payload; змішування сутностей; крихкі фільтри.

### 3. Легкий `GET /api/reports` без query, фільтри на клієнті (відхилено)

API віддає всі summary; UI фільтрує локально.

**Плюси:** простий API.  
**Мінуси:** гірше масштабується; логіка фільтрів лише на фронті.

---

## Backend

### Новий endpoint

```
GET /api/reports
Auth: requireAuth + requireHr
Лише звіти, де interview.hrUserId === req.user.id
```

Додати handler у існуючий `createReportsRouter` **перед** `GET /reports/:id` (щоб `reports` не парсилось як `:id`).

### Query (усі опційні)

| Параметр | Тип | Поведінка |
|----------|-----|-----------|
| `vacancyId` | string | точний match `interview.vacancyId` |
| `recommendation` | `HIRE` \| `MAYBE` \| `REJECT` | точний match |
| `email` | string | case-insensitive `contains` по `candidateUser.email` |
| `dateFrom` | `YYYY-MM-DD` | `createdAt >=` 00:00:00.000 UTC цього дня |
| `dateTo` | `YYYY-MM-DD` | `createdAt <=` 23:59:59.999 UTC цього дня |

Невалідний `recommendation` або непарсована дата → `400` з `{ error: "..." }`.

### Успіх (200)

```json
{
  "reports": [
    {
      "id": "clx...",
      "interviewId": "clx...",
      "candidateEmail": "anna@co.ua",
      "vacancyId": "clx...",
      "vacancyTitle": "Senior Node",
      "matchScore": 82,
      "recommendation": "HIRE",
      "createdAt": "2026-07-14T09:00:00.000Z"
    }
  ]
}
```

- Сортування: `createdAt` DESC
- Якщо `candidateUser` відсутній: `candidateEmail: null` (UI показує «—»)
- Без markdown / strengths / risks (легкий list payload)
- Dropdown вакансій: існуючий `GET /api/vacancies/mine` (нового endpoint не потрібно)
- `GET /api/reports/:id` — без змін

### Prisma include (орієнтовно)

`finalReport.findMany` з `where.interview.hrUserId`, include:

- `interview.candidateUser.email`
- `interview.vacancy.id` + `title`

---

## Frontend

### Навігація

- `HrSidebar`: після «Співбесіди» — `RouterLink` «Звіти» → `/reports`, active через `isActive('/reports')`
- Router у `HrLayout` children:

```ts
{ path: "reports", name: "reports", component: ReportListView }
```

Повний звіт лишається на `report/:id` (`name: "report"`).

### `ReportListView`

- Заголовок «Звіти»
- Рядок фільтрів зверху:
  - вакансія — `<select>`, опція «Усі» + список з `fetchMyVacancies()`
  - рекомендація — «Усі» / Найняти / Під питанням / Відхилити
  - пошта — text input
  - дата від / дата до — `input type="date"`
- Завантаження: паралельно `fetchReports(filters)` + `fetchMyVacancies()`
- Застосування фільтрів: refetch при зміні select/date одразу; для email — debounce ~300ms
- Кнопка «Скинути фільтри», якщо хоч один фільтр активний

### Таблиця

| Колонка | Джерело | Відображення |
|---------|---------|--------------|
| Пошта | `candidateEmail` | лінк на `{ name: "report", params: { id } }`; `null` → «—» |
| Вакансія | `vacancyTitle` | текст |
| Оцінка | `matchScore` | `82%` |
| Рекомендація | `recommendation` | badge (ті самі класи, що в `InterviewListView` / `ReportView`) |
| Дата | `createdAt` | `toLocaleDateString("uk-UA")` |

Мінімум клікабельності: пошта + badge рекомендації як `RouterLink` на звіт (як колонка «Звіт» у співбесідах).

### Стани UI

| Стан | Поведінка |
|------|-----------|
| loading | «Завантаження…» |
| error | банер з повідомленням |
| порожньо, без фільтрів | «Ще немає звітів. Вони з’являться після завершення співбесід.» |
| порожньо, з фільтрами | «Нічого не знайдено за цими фільтрами.» |

### API-клієнт

У `frontend/src/api/reports.ts`:

```ts
export type ReportSummary = {
  id: string;
  interviewId: string;
  candidateEmail: string | null;
  vacancyId: string;
  vacancyTitle: string;
  matchScore: number;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  createdAt: string;
};

export type ReportListFilters = {
  vacancyId?: string;
  recommendation?: "HIRE" | "MAYBE" | "REJECT";
  email?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function fetchReports(filters?: ReportListFilters): Promise<ReportSummary[]>
```

Стиль: Calm Slate + Teal токени, патерн таблиці як `InterviewListView`.

**Без змін:** `ReportView`, колонка «Звіт» у списку співбесід.

---

## Потік даних

```
HR → /reports
  → GET /api/reports (+ optional query)
  → GET /api/vacancies/mine (dropdown)
  → зміна фільтра → GET /api/reports?...
  → клік → /report/:id → GET /api/reports/:id
```

---

## Помилки

| Ситуація | Відповідь / UI |
|----------|----------------|
| Не авторизований | router guard → login (як інші HR-сторінки) |
| Невалідний query | `400` → показати текст помилки |
| Мережа / 500 | «Не вдалося завантажити список звітів» |
| Чужий звіт у list | не потрапляє (filter `hrUserId`) |
| `GET /reports/:id` чужий | існуючий `403` |

---

## Тести

### Backend (`reports.test.ts`)

- `GET /api/reports` повертає `[]`, коли звітів немає
- повертає лише звіти поточного HR
- фільтр `recommendation`
- фільтр `vacancyId`
- фільтр `email` (contains, case-insensitive)
- фільтри `dateFrom` / `dateTo`
- `400` на невалідний `recommendation`
- існуючі тести `GET /reports/:id` лишаються зеленими

### Frontend

- За наявності unit/component тестів — мінімальний smoke на `ReportListView` / `fetchReports`
- Інакше ручна перевірка: сайдбар → список → фільтри → відкриття `/report/:id`

---

## Файли (орієнтовно)

| Файл | Зміна |
|------|--------|
| `backend/src/routes/reports.ts` | додати `GET /reports` |
| `backend/src/routes/reports.test.ts` | тести list + фільтрів |
| `frontend/src/api/reports.ts` | `ReportSummary`, `fetchReports` |
| `frontend/src/views/ReportListView.vue` | новий view |
| `frontend/src/components/HrSidebar.vue` | пункт «Звіти» |
| `frontend/src/router/index.ts` | маршрут `reports` |

---

## Критерії готовності

1. У сайдбарі HR є «Звіти»; активний стан на `/reports`
2. Таблиця показує пошту, вакансію, оцінку, рекомендацію, дату для всіх звітів HR
3. Фільтри (вакансія, рекомендація, пошта, дати) змінюють список через API
4. Клік відкриває існуючу сторінку повного звіту
5. Backend-тести list/фільтрів проходять
6. Стиль узгоджений із Calm Slate + Teal і списком співбесід

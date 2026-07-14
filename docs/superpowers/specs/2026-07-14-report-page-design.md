# Сторінка звіту + хмарна модель (Day 21) — Design Spec

**Дата:** 2026-07-14  
**Статус:** Затверджено в brainstorming  
**Контекст:** README Day 21 — перегляд звіту в браузері + можливість хмарної LLM  
**Передумови:** Day 20 (генерація `FinalReport`, `POST /api/interviews/:id/end`)  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- Модель `FinalReport` у PostgreSQL з полями `reportMarkdown`, `recommendation`, `matchScore`, `strengths`, `risks`
- Генерацію звіту через `POST /api/interviews/:id/end` (LLM аналізує стенограму + профілі)
- UI: колонка «Звіт» у таблиці HR показує `reportSummary` (`HIRE`/`MAYBE`/`REJECT` або «—»)
- Банер «Звіт згенеровано» у live-кімнаті після завершення
- Плагінований LLM: `LLM_PROVIDER=omlx|gemini|openai` через factory (Gemini — напряму через SDK)

**Що відсутнє:**

- API для читання повного звіту
- Сторінка `/report/:id` з рендером markdown
- Посилання на звіт з усіх релевантних місць UI
- Актуальна документація Day 21 (README досі згадує застарілі `litellm`/`ollama`)

**Мета:** HR може прочитати повний AI-звіт у браузері; перемикання на хмарну модель Gemini через `.env` задокументовано і перевірено.

**Поза scope:**

- LiteLLM як окремий провайдер (відхилено — Gemini уже працює напряму)
- Доступ кандидата до звіту
- Друк / PDF / експорт
- Регенерація звіту
- Зміни Prisma-схеми

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| LLM-провайдер | **A** — `LLM_PROVIDER=omlx\|gemini`, без LiteLLM |
| Рівень UI звіту | **B** — структурований: шапка (score + recommendation), картки strengths/risks, markdown-тіло |
| Точки входу | **C** — список співбесід + live-кімната + деталі співбесіди |
| Архітектура API | **1** — окремий `GET /api/reports/:id` + `reportId` у interview-відповідях |

---

## Підходи (розглянуті)

### 1. Окремий reports API + ReportView (обрано)

Новий `GET /api/reports/:id`, окремий Vue-view, `reportId` додається до існуючих interview endpoints.

**Плюси:** чіткі межі, `:id` = `FinalReport.id`, легко тестувати.  
**Мінуси:** +1 route-файл на backend.

### 2. Вкладений endpoint `GET /api/interviews/:id/report` (відхилено)

Звіт за interview id, не за report id.

**Плюси:** не потрібен `reportId` у списку.  
**Мінуси:** суперечить маршруту `/report/:id` з ТЗ; для навігації зі списку все одно потрібен `reportId`.

### 3. Повний звіт у `GET /api/interviews/:id` (відхилено)

Один запит без окремого reports endpoint.

**Плюси:** менше endpoints.  
**Мінуси:** важкий payload; markdown не потрібен на сторінці деталей — лише посилання.

---

## Backend

### Новий endpoint

```
GET /api/reports/:id
Auth: requireAuth + requireHr, лише власник interview
```

**Успіх (200):**

```json
{
  "report": {
    "id": "clx...",
    "interviewId": "clx...",
    "reportMarkdown": "## Підсумок\n\n...",
    "recommendation": "HIRE",
    "matchScore": 78,
    "strengths": ["Досвід Node.js"],
    "risks": ["Мало leadership"],
    "createdAt": "2026-07-14T09:00:00.000Z"
  }
}
```

**Помилки:**

| HTTP | Умова |
|------|-------|
| 403 | Не HR або не власник interview |
| 404 | Звіт не знайдено |

**Реалізація:**

- Файл `backend/src/routes/reports.ts`
- Реєстрація в `backend/src/server.ts` під `requireAuth` + `requireHr`
- Запит: `prisma.finalReport.findUnique({ where: { id }, include: { interview: { select: { hrUserId: true } } } })`
- Перевірка `interview.hrUserId === req.user.id`

### Розширення існуючих interview endpoints

Додати `reportId: string | null` поруч із `reportSummary`:

| Endpoint | Зміна |
|----------|-------|
| `GET /api/interviews/mine` | `reportId: item.finalReport?.id ?? null` |
| `GET /api/interviews/:id` | `reportId: interview.finalReport?.id ?? null` |

`reportSummary` залишається без змін (`recommendation` або `null`).

### Тести

Файл `backend/src/routes/reports.test.ts`:

- 401 без токена
- 403 для чужого звіту
- 404 для неіснуючого id
- 200 з повним тілом для власника HR
- Оновити `interviews.test.ts`: перевірити `reportId` у mine і detail

---

## Frontend

### Маршрут

```
/report/:id  →  ReportView.vue
```

- `:id` = `FinalReport.id`
- Дочірній маршрут `HrLayout`, `meta: { requiresAuth: true, requiredRole: "HR" }`
- Кандидат перенаправляється на свій home (існуючий guard)

### API-клієнт

Новий файл `frontend/src/api/reports.ts`:

```typescript
export type FinalReport = {
  id: string;
  interviewId: string;
  reportMarkdown: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
  strengths: string[];
  risks: string[];
  createdAt: string;
};

export async function fetchReport(id: string): Promise<FinalReport>
```

Розширити `InterviewSummary` / `InterviewDetail` у `frontend/src/api/interviews.ts`: поле `reportId: string | null`.

### ReportView.vue — макет

**Стани:** `loading` → `ready` | `error`

```
┌─────────────────────────────────────────────┐
│ ← До списку співбесід                       │
├─────────────────────────────────────────────┤
│  Звіт про співбесіду                        │
│  ┌──────────┐  ┌─────────────────────────┐  │
│  │   78%    │  │  HIRE (badge)           │  │
│  │ match    │  │  Рекомендація           │  │
│  └──────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────┤
│  ┌─ Сильні сторони ─┐  ┌─ Ризики ─────────┐ │
│  │ • пункти з JSON  │  │ • пункти з JSON  │ │
│  └───────────────────┘  └──────────────────┘ │
├─────────────────────────────────────────────┤
│  reportMarkdown (HTML через marked+sanitize)│
└─────────────────────────────────────────────┘
```

**Кольори badge рекомендації:**

| Значення | Колір |
|----------|-------|
| `HIRE` | зелений (`#16a34a` / `#dcfce7`) |
| `MAYBE` | жовтий (`#ca8a04` / `#fef9c3`) |
| `REJECT` | червоний (`#dc2626` / `#fee2e2`) |

**Markdown-рендеринг:**

- Залежності: `marked`, `dompurify` (+ `@types/dompurify` dev)
- `marked.parse(reportMarkdown)` → `DOMPurify.sanitize(html)` → `v-html`
- Scoped CSS для `.report-body h2`, `p`, `ul`, `li`

### Навігація — три точки входу

| Місце | Зміна |
|-------|-------|
| `InterviewListView` | Колонка «Звіт»: якщо `reportId` — `RouterLink` `/report/:reportId` з кольоровим badge; інакше «—» |
| `InterviewRoomContent` | Після `endInterview`: банер + посилання «Переглянути звіт →» (використати `result.reportId`). При `interviewStatus === "ENDED"` і наявному `reportId` (prop від батька) — показати посилання |
| `InterviewDetailView` | Якщо `reportId` — блок «Фінальний звіт» з `RouterLink` |
| `HrInterviewRoomView` | Передати `reportId` з `fetchInterview` у `InterviewRoomContent` як prop |

### Файли (frontend)

| Файл | Дія |
|------|-----|
| `router/index.ts` | + route `report/:id` |
| `views/ReportView.vue` | нова сторінка |
| `api/reports.ts` | `fetchReport` |
| `api/interviews.ts` | + `reportId` у типах |
| `InterviewListView.vue` | посилання в колонці |
| `InterviewRoomContent.vue` | посилання після завершення / при ENDED |
| `HrInterviewRoomView.vue` | prop `reportId` |
| `InterviewDetailView.vue` | блок звіту |
| `package.json` | + `marked`, `dompurify` |

---

## LLM і документація

### Код LLM — без змін

Існуючий factory (`backend/src/llm/factory.ts`) вже підтримує `omlx` і `gemini`. Для Day 21:

1. Переконатися, що `.env.example` містить зрозумілий приклад перемикання на Gemini
2. Оновити README Day 21:
   - Прибрати згадки `litellm` / `ollama`
   - Описати `LLM_PROVIDER=omlx|gemini`
   - Додати інструкцію: встановити `GEMINI_API_KEY`, змінити `LLM_PROVIDER=gemini`, рестарт backend
   - Тест: `npm run llm:test --workspace backend`
3. Оновити Definition of Done Day 21 під фактичне рішення

### Перемикання провайдера

```env
# Локально (за замовчуванням)
LLM_PROVIDER=omlx
OMLX_BASE_URL=http://127.0.0.1:8000
OMLX_MODEL=Qwen2.5-7B-Instruct-4bit

# Хмара (Gemini)
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.0-flash
```

Після зміни `.env` — рестарт backend. Перемикання впливає на **генерацію** нових звітів, не на перегляд уже збережених.

---

## Definition of Done (Day 21)

- [ ] `GET /api/reports/:id` повертає повний звіт для HR-власника
- [ ] `reportId` присутній у `GET /api/interviews/mine` і `GET /api/interviews/:id`
- [ ] `/report/:id` рендерить структурований звіт (шапка, картки, markdown)
- [ ] Посилання на звіт зі списку, кімнати (після end + при ENDED) і деталей співбесіди
- [ ] `LLM_PROVIDER=gemini` працює при наявному `GEMINI_API_KEY` (`npm run llm:test`)
- [ ] README Day 21 оновлено (без LiteLLM, з інструкцією omlx/gemini)
- [ ] `npm run build` проходить
- [ ] Unit-тести reports route + оновлені interviews tests

---

## Порядок імплементації (орієнтир для plan)

1. Backend: `reports.ts` route + тести
2. Backend: `reportId` у interview responses + тести
3. Frontend: залежності `marked` + `dompurify`
4. Frontend: `api/reports.ts` + `ReportView.vue` + router
5. Frontend: посилання в List / Room / Detail
6. README + `.env.example`
7. Повна збірка і ручна перевірка

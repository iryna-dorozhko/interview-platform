# Candidate Prep Chat UI Design (Day 12)

**Дата:** 2026-07-09  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 12 плану розробки (README) — «Анкета кандидата в браузері»  
**Передумови:** День 10 (candidate auth), День 11 (Candidate Agent backend API)

---

## Контекст і мета

MVP уже має:

- Candidate auth: реєстрація/логін, кабінет `/candidate`, role-aware router guards (День 10)
- Candidate Agent backend: `GET/POST/DELETE /api/candidate-prep/:interviewId` (День 11)
- HR prep chat UI: `VacancyPrepView.vue` — повний chat UX з авто-привітанням, історією, delete (Дні 5–7)

**Мета Дня 12:** кандидат проходить анкету в браузері — чат з Candidate Agent, аналогічно HR-анкеті на Дні 5. Історія зберігається в БД і відновлюється після перезавантаження.

**Поза scope Дня 12:** `finish` / profile extraction, екран профілю, `confirm`, join-by-code (Дні 13–14), рефакторинг HR UI, зміни backend, candidate sidebar.

---

## Затверджені рішення (brainstorming)

| Питання | Рішення |
|---------|---------|
| Маршрут prep | `/candidate/prep/:interviewId` |
| Навігація | Мінімальний shell: home + prep, без sidebar |
| Організація коду | Окремий `CandidatePrepView.vue` + `candidate-prep.ts`, без рефакторингу HR |
| Demo interviewId | `VITE_DEMO_INTERVIEW_ID` з env; fallback — підказка в UI |

---

## Підходи (розглянуті)

### 1. Окремий prep-view + API-клієнт (обрано)

`CandidatePrepView.vue` + `frontend/src/api/candidate-prep.ts`.  
Мінімальний scope, без регресії HR. Дублювання ~150 рядків chat-логіки прийнятне для одного дня.

### 2. Shared components / composable (відхилено)

Витягнути `ChatThread`, `Composer`, `usePrepChat()` — DRY, але рефакторинг HR поза scope.

### 3. Чат на `/candidate` без окремого маршруту (відхилено)

Немає shareable URL, ускладнює День 14 (prep per interview).

---

## Маршрути та навігація

| Маршрут | Компонент | Meta |
|---------|-----------|------|
| `/candidate` | `CandidateHomeView` | `requiresAuth`, `requiredRole: CANDIDATE` |
| `/candidate/prep/:interviewId` | `CandidatePrepView` | `requiresAuth`, `requiredRole: CANDIDATE` |

### CandidateHomeView

Замінити placeholder на:

- Заголовок «Кабінет кандидата»
- Кнопка **«Моя анкета»**:
  - якщо `import.meta.env.VITE_DEMO_INTERVIEW_ID` задано → `router.push('/candidate/prep/' + id)`
  - інакше → disabled-кнопка або текст-підказка: «Додайте `VITE_DEMO_INTERVIEW_ID` у `.env` (id з виводу `npm --workspace backend run db:seed`, `joinCode=TEST01`) або відкрийте `/candidate/prep/:interviewId` вручну»
- Кнопка «Вийти» (існуюча)

### CandidatePrepView

Header:

- Заголовок: **«Мій профіль / Анкета»**
- Кнопка **«← До кабінету»** → `/candidate`

---

## API-клієнт

**Файл:** `frontend/src/api/candidate-prep.ts`

Функції (дзеркало `frontend/src/api/prep.ts`):

| Функція | HTTP |
|---------|------|
| `fetchCandidatePrepState(interviewId)` | `GET /api/candidate-prep/:interviewId` |
| `sendCandidatePrepMessage(interviewId, message?)` | `POST /api/candidate-prep/:interviewId/message` |
| `deleteCandidatePrepChat(interviewId)` | `DELETE /api/candidate-prep/:interviewId` |

Типи:

```ts
type CandidatePrepAuthorType = "HUMAN_CANDIDATE" | "AGENT_CANDIDATE";

type CandidatePrepMessage = {
  id: string;
  authorType: CandidatePrepAuthorType;
  content: string;
  createdAt: string;
};

type CandidatePrepState = {
  messages: CandidatePrepMessage[];
  isClosed: boolean;
  profile: null | { experience; skills; goals; summary; confirmedAt }; // на Дні 12 завжди null
};

type SendMessageResponse = {
  message: string;
  readyForConfirmation: boolean;
};
```

Backend без змін. Auth через існуючий `fetchWithAuth`.

---

## UI чату (CandidatePrepView)

Патерн з `VacancyPrepView.vue`, **лише chat-режим**.

### Елементи

| Елемент | День 12 |
|---------|---------|
| Список повідомлень (scroll, aria-live) | ✅ |
| Textarea + «Надіслати», Enter без Shift | ✅ |
| «Думаю…» під час LLM | ✅ |
| Авто-привітання на порожній історії | ✅ |
| «Видалити чат» + `window.confirm` | ✅ |
| «Завершити чат» | ❌ (День 13) |
| Екран профілю / «Підтвердити профіль» | ❌ (День 13) |

### Labels і стилі

- Повідомлення кандидата: label «Ви», bubble `#dbeafe`
- Повідомлення агента: label «Агент», bubble `#e5e7eb`
- Scoped CSS — копія chat-секції з `VacancyPrepView.vue` (max-width ~40rem)

### Стани view

| Стан | Поведінка |
|------|-----------|
| `loadState: loading` | «Завантаження…» |
| `loadState: error` | Червоний banner з текстом помилки |
| `ready`, `!isClosed` | Чат + composer |
| `ready`, `isClosed` | Read-only історія, composer прихований (на Дні 12 малоймовірно без finish endpoint) |
| `sending` | Блокувати input/submit, показати «Думаю…» |

### Data flow

```
onMounted:
  GET /candidate-prep/:interviewId
  if messages.length === 0 && !isClosed → POST message "" → append AGENT_CANDIDATE

sendMessage:
  optimistic append HUMAN_CANDIDATE
  POST /message → append AGENT_CANDIDATE
  lastReadyForConfirmation = response.readyForConfirmation  // без UI на Дні 12

deleteChat:
  confirm → DELETE → clear state → triggerGreeting()
```

`readyForConfirmation` зберігається в `ref` для підключення кнопки «Завершити чат» на Дні 13.

---

## Обробка помилок

| HTTP | UI |
|------|-----|
| 401 | Router guard редіректить на `/candidate/login` |
| 403 | Banner: «Доступ заборонено» |
| 404 | Banner: «Співбесіду не знайдено» |
| 409 | Banner: «Сесію закрито» (closed session) |
| 502 | Banner: «Агент не відповів» |
| 503 | Banner: «Агент тимчасово недоступний» |

Парсинг помилок — той самий патерн `parseError()` що в `prep.ts`.

---

## Файлова структура

### Create

- `frontend/src/api/candidate-prep.ts`
- `frontend/src/views/CandidatePrepView.vue`

### Modify

- `frontend/src/router/index.ts` — route `candidate-prep`
- `frontend/src/views/CandidateHomeView.vue` — кнопка «Моя анкета»
- `frontend/src/vite-env.d.ts` — `readonly VITE_DEMO_INTERVIEW_ID?: string`
- `README.md` — Day 12 Quick Start, маршрут, env, сценарій перевірки

### Без змін

- Backend routes/agents
- `VacancyPrepView.vue`
- Prisma schema

---

## Demo-сценарій (Quick Start)

```bash
npm run dev
# Після db:seed скопіювати interviewId (joinCode=TEST01) у frontend/.env:
# VITE_DEMO_INTERVIEW_ID=<id-from-seed>
```

1. Відкрити `/candidate/register` → зареєструватися
2. На `/candidate` натиснути **«Моя анкета»**
3. Агент привітається; надіслати 2–3 відповіді про досвід
4. Перезавантажити сторінку — історія на місці
5. «Видалити чат» → нова розмова з привітанням
6. Увійти як HR → `/candidate/prep/:id` → редірект на `/`

---

## Definition of Done

- [ ] Демонстрація: кандидат проходить анкету в браузері (мінімум 3 обміни)
- [ ] Сценарій: UI працює аналогічно HR-анкеті; історія зберігається після reload
- [ ] Role isolation: HR не потрапляє на candidate prep, кандидат — на HR routes
- [ ] `npm run build` проходить
- [ ] README: маршрут `/candidate/prep/:interviewId`, `VITE_DEMO_INTERVIEW_ID`, Quick Start

---

## Ризики та мітигації

| Ризик | Мітигація |
|-------|-----------|
| Динамічний `interviewId` після seed | Env `VITE_DEMO_INTERVIEW_ID`; README документує крок |
| Дублювання chat-логіки з HR | Прийнятно для Дня 12; shared refactor — опційно пізніше |
| Кандидат пише в чужу співбесіду | Тимчасове обмеження Дня 11; ownership check — День 14 |
| `isClosed` без finish UI | Read-only режим; finish додається на Дні 13 |

---

## Наступний крок

Після review цього spec → implementation plan (writing-plans) для Дня 13 finish/confirm UI та backend, окремо для Дня 12 UI-only tasks.

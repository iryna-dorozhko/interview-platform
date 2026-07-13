# Інтерфейс співбесіди (Day 19) + фінальний звіт (Day 20) — Design Spec

**Дата:** 2026-07-13  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 19 README — «зручна кімната для обох сторін»; об’єднано з Day 20 (генерація звіту при завершенні)  
**Передумови:** Дні 15–18 (live-кімната, socket, orchestrator, три агенти)  
**Мова:** Українська (UI, повідомлення про помилки, промпт звіту)

---

## Контекст і мета

MVP уже має:

- Live-кімнату HR ↔ кандидат через Socket.IO (`backend/src/socket/room.ts`)
- Маршрути: HR `/interviews/:id/room`, кандидат `/candidate/interview/room`
- `LiveChatPanel` з мітками учасників; агенти — один клас `.agent` (фіолетовий)
- Кандидат: кнопка «Увійти в кімнату» при `READY`/`LIVE` на `CandidateInterviewView`
- HR: клік по назві в таблиці веде в кімнату (будь-який статус ≥ `AWAITING_CANDIDATE`); явної кнопки «Увійти в співбесіду» немає
- `InterviewDetailView` — застарілий placeholder «Спільна співбесіда буде доступна пізніше»
- Модель `FinalReport` у Prisma (поля готові); endpoint завершення і агент звіту — відсутні
- Колонка «Звіт» у таблиці HR показує `reportSummary` (`HIRE`/`MAYBE`/`REJECT` або «—»)

**Мета:** зручний UI кімнати для обох сторін — явні кнопки входу, розрізнення учасників кольором, завершення співбесіди HR з генерацією AI-звіту.

**Поза scope:**

- Сторінка перегляду звіту `/report/:id` (Day 21)
- LiteLLM / перемикач провайдера (Day 21)
- Зміни Prisma-схеми
- Блокування composer під час роботи агентів або генерації звіту (лише disabled кнопка «Завершити»)
- Рефакторинг `InterviewDetailView` (не використовується в основному флоу)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Доступ до кімнати | **C** — кнопка «Увійти в співбесіду» лише при `READY`/`LIVE`; HR і раніше може зайти (клік по назві, «Далі» в модалці) |
| Завершення співбесіди | **C** — повний end-to-end: статус `ENDED` + AI-звіт у `FinalReport` (Day 19+20 разом) |
| Кольори повідомлень | **C** — свої праворуч з акцентом ролі; чужі люди — нейтральні; кожен агент — унікальний колір бульбашки + pill-мітка |
| Архітектура | **2** — модульний стек (окремий report-agent, стилі, розширення router) |

---

## Підходи (розглянуті)

### 1. Монолітний patch (відхилено)

Кольори в `LiveChatPanel`, кнопки в існуючих view, LLM-виклик прямо в `interviews.ts`.

**Плюси:** мало файлів.  
**Мінуси:** `interviews.ts` роздувається; звіт важко тестувати окремо.

### 2. Модульний стек (обрано)

- `frontend/src/utils/live-message-styles.ts` — кольори/мітки за `authorType`
- `backend/src/agents/final-report-agent.ts` — LLM + парсинг JSON
- `POST /api/interviews/:id/end` — окремий handler з inject `io` для broadcast

**Плюси:** чисті межі; узгоджено з Day 17–18; окремі тести.  
**Мінуси:** трохи більше файлів.

### 3. Завершення через Socket (відхилено)

Клієнт шле `room:end`, LLM у socket-handler.

**Плюси:** миттєвий broadcast.  
**Мінуси:** LLM 10–30 с у socket — антипатерн; HTTP краще для довгих операцій.

---

## 1. Кнопки «Увійти в співбесіду»

### HR — `InterviewListView.vue`

| Елемент | Поведінка |
|---------|-----------|
| Клік по **назві** | Як зараз → `/interviews/:id/room` (усі статуси ≥ `AWAITING_CANDIDATE`) |
| Кнопка **«Увійти в співбесіду»** у колонці «Дії» | Лише при `status === "READY"` або `"LIVE"` → `router.push({ name: "interview-room", params: { id } })` |
| Інші статуси | Лише «Видалити» (як зараз) |

### Кандидат — `CandidateInterviewView.vue`

| Елемент | Поведінка |
|---------|-----------|
| Кнопка при `READY`/`LIVE` | Перейменувати текст: **«Увійти в співбесіду»** (замість «Увійти в кімнату») |
| Маршрут | Без змін: `candidate-interview-room` |

### Правила доступу (варіант C)

- Явна кнопка входу — **лише** `READY` / `LIVE` для обох сторін
- HR до `READY`: кімната доступна через назву в таблиці або «Далі» після створення (`AWAITING_CANDIDATE` → банер з кодом)
- Кандидат до `READY`: без кнопки входу (як зараз)

---

## 2. Кольори повідомлень

### Утиліта `frontend/src/utils/live-message-styles.ts`

Експорт:

```typescript
export type LiveAuthorType = "HUMAN_HR" | "HUMAN_CANDIDATE" | "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";

export function labelFor(authorType: LiveAuthorType): string;
export function messageClasses(authorType: LiveAuthorType, currentRole: "HR" | "CANDIDATE"): {
  wrapper: string[];
  label: string[];
  bubble: Record<string, string>; // inline styles або CSS custom properties
};
```

### Палітра

| `authorType` | Мітка (pill) | Бульбашка | Позиція |
|--------------|--------------|-----------|---------|
| `HUMAN_HR` | HR | `#dbeafe` / `#1e3a5f` | праворуч для HR; ліворуч + `#e5e7eb` для кандидата |
| `HUMAN_CANDIDATE` | Кандидат | `#d1fae5` / `#065f46` | праворуч для кандидата; ліворуч + `#e5e7eb` для HR |
| `AGENT_ARBITER` | Arbiter | `#ede9fe` / `#5b21b6` | ліворуч |
| `AGENT_COMPANY` | Компанія | `#ffedd5` / `#9a3412` | ліворуч |
| `AGENT_CANDIDATE` | Кандидат (AI) | `#fce7f3` / `#9d174d` | ліворуч |

### `LiveChatPanel.vue`

- Імпортувати `labelFor` і `messageClasses` з утиліти
- Прибрати локальний `labelFor` і єдиний клас `.agent`
- Клас `.own` лишається для `margin-left: auto; text-align: right`
- Pill-мітка: `border-radius: 9999px`, `font-size: 0.75rem`, фон відповідає типу автора
- Індикатор «{Agent} думає…» — без змін (використовує `thinkingLabel`)

---

## 3. Кнопка «Завершити співбесіду» (HR only)

### UI

**Розміщення:** шапка `InterviewRoomContent.vue` (рядок над phase-banner), або toolbar у `HrInterviewRoomView`.

| Умова | Відображення |
|-------|--------------|
| `currentRole === "HR"` && `interviewStatus === "LIVE"` | Кнопка **«Завершити співбесіду»** (secondary/danger стиль) |
| Інші ролі / статуси | Кнопка прихована |
| Під час запиту | Disabled + текст «Завершення…» |

**Підтвердження:**

```text
Завершити співбесіду? Буде згенеровано фінальний звіт.
```

**Після успіху:**

- Composer disabled (через `room:status` → `ENDED` або локальний стан)
- Банер «Співбесіда завершена»
- Inline-повідомлення: «Звіт згенеровано. Рекомендація: {HIRE|MAYBE|REJECT}»
- Повна сторінка звіту — Day 21

**Після помилки:** показати `errorMessage`, статус кімнати не змінюється.

### Frontend API

**Файл:** `frontend/src/api/interviews.ts`

```typescript
export type EndInterviewResult = {
  reportId: string;
  recommendation: "HIRE" | "MAYBE" | "REJECT";
  matchScore: number;
};

export async function endInterview(id: string): Promise<EndInterviewResult>;
```

`POST /api/interviews/:id/end` з JWT HR.

---

## 4. Backend — `POST /api/interviews/:id/end`

### Router

Розширити `createInterviewsRouter`:

```typescript
export function createInterviewsRouter(
  getPrisma: () => PrismaClient,
  getIo: () => Server,
  getProvider: () => LlmProvider,
): Router
```

У `server.ts` передати `() => io` і `() => createLlmProvider()`.

### Алгоритм

1. **Auth:** `requireHr` (вже на router)
2. **Load interview** з `liveSession.messages`, `vacancy.companyProfile`, `candidateProfile`
3. **Перевірки:**
   - 404 — не знайдено
   - 403 — не власник HR
   - 409 — `status !== "LIVE"` або вже є `finalReport` / `status === "ENDED"`
4. **LLM:** `buildFinalReportMessages(...)` → `provider.complete()` → `parseFinalReport(raw)`
5. **Транзакція:**
   - `interview.update({ status: "ENDED" })`
   - `finalReport.create({ interviewId, reportMarkdown, recommendation, matchScore, strengths, risks })`
6. **Broadcast:** `getIo().to(roomName(id)).emit("room:status", { status: "ENDED" })`
7. **Response 201:**

```json
{
  "report": {
    "id": "...",
    "recommendation": "HIRE",
    "matchScore": 78
  }
}
```

### Коди помилок

| Код | Умова |
|-----|-------|
| 403 | Не HR-власник |
| 404 | Interview не знайдено |
| 409 | Статус не `LIVE` або звіт уже існує |
| 502 | LLM повернув невалідний JSON |
| 503 | LLM недоступний |

При 502/503 статус **не** змінюється.

---

## 5. Final Report Agent

### Файли

| Файл | Відповідальність |
|------|------------------|
| `backend/src/agents/prompts/final-report.uk.ts` | System prompt українською |
| `backend/src/agents/final-report-agent.ts` | `buildFinalReportMessages`, `parseFinalReport`, `FinalReportExtractionError` |

### Вхідні дані для промпту

- Стенограма live-чату (`LiveMessage[]`, формат: `[HR] текст`, `[Кандидат] текст`, `[Arbiter] текст`, …)
- JSON профіль компанії (`CompanyProfile`: role, requirements, culture, expectations)
- JSON профіль кандидата (`CandidateProfile`: skills, experience, preferences, …)

### Очікуваний JSON від LLM

```json
{
  "reportMarkdown": "## Підсумок\n\n...",
  "recommendation": "HIRE",
  "matchScore": 78,
  "strengths": ["сильна сторона 1"],
  "risks": ["ризик 1"]
}
```

**Правила парсингу:**

- `recommendation` — строго `HIRE` | `MAYBE` | `REJECT`
- `matchScore` — ціле 0–100
- `strengths`, `risks` — масиви рядків (мінімум 1 елемент кожен; якщо немає даних — `["не вказано"]`)
- `reportMarkdown` — markdown українською з розділами: Підсумок, Відповідність вимогам, Сильні сторони, Ризики, Рекомендація
- Відповідь LLM — лише JSON, без markdown-обгортки (як у profile extraction)

### Патерн реалізації

За зразком `prep/:vacancyId/finish` (`company-agent.ts` + `parseProfileExtraction`):

- Окремий клас помилки `FinalReportExtractionError`
- Логування `[interviews:end:provider]` при LLM-помилках
- `getProvider()` через factory (Ollama за замовчуванням)

---

## 6. Socket і frontend room state

### Існуюче

`room:status` вже обробляється в `useInterviewRoom.ts` (`onStatus`).

### Розширення типу

`RoomStatusEvent.status` у `backend/src/socket/types.ts` вже включає `"ENDED"`.

### Після `ENDED`

- `isReadOnly` = true (вже є)
- Phase banner: «Співбесіда завершена» (вже є)
- Orchestrator не реагує на нові повідомлення (перевірка статусу в `orchestrator.ts` — переконатися, що `ENDED` блокує)

---

## 7. Ключові файли (зміни)

| Файл | Зміна |
|------|-------|
| `frontend/src/utils/live-message-styles.ts` | **новий** — кольори/мітки |
| `frontend/src/components/LiveChatPanel.vue` | стилі з утиліти |
| `frontend/src/components/InterviewRoomContent.vue` | кнопка «Завершити», виклик API |
| `frontend/src/views/InterviewListView.vue` | кнопка «Увійти в співбесіду» |
| `frontend/src/views/CandidateInterviewView.vue` | перейменування кнопки |
| `frontend/src/api/interviews.ts` | `endInterview()` |
| `frontend/src/composables/useInterviewRoom.ts` | опційно: `endError` / callback (мінімально — через prop у content) |
| `backend/src/agents/final-report-agent.ts` | **новий** |
| `backend/src/agents/prompts/final-report.uk.ts` | **новий** |
| `backend/src/routes/interviews.ts` | `POST /:id/end` |
| `backend/src/server.ts` | inject `io` + `getProvider` в interviews router |
| `backend/src/socket/orchestrator.ts` | guard на `ENDED` (якщо ще немає) |

---

## 8. Тести

### Backend

| Файл | Сценарії |
|------|----------|
| `final-report-agent.test.ts` | Валідний JSON; invalid recommendation; matchScore поза діапазоном; markdown wrapper |
| `interviews.test.ts` | `POST /end`: 201 success; 403; 404; 409 not LIVE; 409 already ENDED; 502 bad JSON; 503 LLM down |

### Frontend

Manual DoD (unit-тести стилів — опційно):

- HR бачить кнопку входу лише при READY/LIVE
- Кандидат — те саме з новим текстом
- Повідомлення різних типів візуально відрізняються
- «Завершити» видна лише HR у LIVE
- Після end — read-only для обох

---

## 9. Definition of Done (README Day 19 + Day 20)

- [ ] Демонстрація: live-співбесіда з кольоровими мітками для HR, кандидата і кожного агента
- [ ] Сценарій: вхід через кнопку «Увійти в співбесідu» лише при `READY`/`LIVE`; HR може зайти раніше іншим шляхом
- [ ] Сценарій: «Завершити» видна лише HR при `LIVE`; після натискання — `ENDED`, read-only, `FinalReport` у БД
- [ ] Сценарій: звіт містить match-score, ризики, рекомендацію; повторне завершення → 409
- [ ] Збірка: `npm run build` проходить
- [ ] README: UI кімнати, хто може завершити, endpoint `POST /interviews/:id/end`, структура звіту

---

## 10. README (оновлення після імплементації)

Додати секцію **Day 19 — Інтерфейс співбесіди** з:

- Таблицею кольорів учасників
- Quick Start: HR → READY → «Увійти в співбесідu»; кандидат — те саме
- Опис `POST /api/interviews/:id/end` і полів `FinalReport`
- Примітка: перегляд звіту в UI — Day 21

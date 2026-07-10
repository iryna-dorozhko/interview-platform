# Вкладки «Співбесіда» + live-кімната end-to-end — Design Spec

**Дата:** 2026-07-10  
**Статус:** Затверджено в brainstorming  
**Контекст:** Об’єднаний UX вкладок «Співбесіда» (HR і кандидат) з повним флоу до live-кімнати з агентами  
**Передумови:** Дні 8–14 (create/join, profile confirm, `READY`), Day 15–18 specs (socket, orchestrator, agents)  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- **HR:** `InterviewListView` (таблиця), `CreateInterviewModal` (вибір vacancy → create), кнопка create на головній
- **Кандидат:** `CandidateInterviewView`, `JoinInterviewModal`, gating join за confirmed анкетою
- **Backend:** `POST/GET /api/interviews`, `POST /api/candidate/interview/join`, `interview-readiness.ts`
- **Specs (не повністю в UI):** Day 15 live chat, Day 16 orchestrator, Day 17 Arbiter, Day 18 Company/Candidate agents
- Placeholder «Спільна співбесіда буде доступна пізніше» замість реальної кімнати

**Мета:** end-to-end флоу від вкладок «Співbесіда» до спільної live-кімнати з HR, кандидатом, Arbiter, Company Agent і Candidate Agent — з узгодженими правилами доступу, статусів і видалення.

**Поза scope:**

- Зміни Prisma-схеми (enum `InterviewStatus` достатній)
- Генерація фінального звіту (Day 20) — лише кнопка «Завершити» і колонка «Звіт» готуються до Day 20
- Shared refactor HR/candidate shell-компонентів
- Окремий lobby-маршрут

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Scope | **A** — повний end-to-end: вкладки + join/create + live-кімната з усіма учасниками |
| Доступ HR до кімнати | **A** — одразу після створення («Далі» в модалці) |
| Доступ кандидата до кімнати | Лише після join + confirmed анкети, при статусі `READY` або `LIVE` |
| Перехід у `LIVE` | **A** — лише коли `status === READY` **і** обидва учасники в socket-кімнаті |
| Видалення співбесід | **D** — завжди (включно з `ENDED`), з `window.confirm` кожного разу |
| Агенти до появи кандидата | **A** — orchestrator мовчить, доки статус не `LIVE` |
| Модалка «Створити зустріч» | **A** — два кроки в одній модалці: vacancy → код → «Далі» |

---

## Підходи (розглянуті)

### 1. Розширити Day 15–18 + єдина UX-спека вкладок (обрано)

Один маршрут кімнати, розширити `room-access.ts`, presence у socket-шарі, UI вкладок поверх існуючого backend.

**Плюси:** мінімальний diff, узгоджено з наявними specs, без нових сутностей.  
**Мінуси:** presence-tracking у пам’яті процесу (прийнятно для MVP).

### 2. Окремий lobby + room (відхилено)

HR у `/lobby`, кандидат у `/room`, автоперехід при готовності.

**Плюси:** чітке розділення фаз.  
**Мінуси:** зайві маршрути, складніша навігація.

### 3. HTTP polling presence (відхилено)

`LIVE` через REST замість socket presence.

**Плюси:** простіший socket.  
**Мінуси:** затримка, дублювання стану, суперечить realtime-архітектурі.

---

## Життєвий цикл і флоу

```text
HR: vacancy confirmed → «Створити зустріч» → вибір анкети → код → «Далі» → кімната
  (Interview.status = AWAITING_CANDIDATE)

HR чекає в кімнаті (може писати людські повідомлення; агенти мовчать)

Кандидат: self-service анкета confirmed → join за кодом
  → maybeTransitionToReady() → READY (якщо HR-side теж ready)

Кандидат: «Увійти в кімнату» (READY)

Обидва в socket-кімнаті при READY → LIVE

Людське повідомлення → debounce → Arbiter → Company → Candidate (Day 16–18)

HR «Завершити співбесіду» → ENDED + звіт (Day 20, поза scope цієї спеки)
```

### Таблиця доступу за статусом

| Статус | HR у кімнаті | Кандидат у кімнаті | Агенти |
|--------|--------------|---------------------|--------|
| `AWAITING_CANDIDATE` | ✅ | ❌ | ❌ |
| `READY` | ✅ | ✅ | ❌ |
| `LIVE` | ✅ | ✅ | ✅ |
| `ENDED` | ✅ (read-only) | ✅ (read-only) | ❌ |

### Правила `READY`

Без змін від Day 14 (`interview-readiness.ts`):

- HR: `Vacancy.status === CONFIRMED` і `CompanyProfile.confirmedAt !== null`
- Кандидат: приєднався (`candidateUserId`) і self-service анкета confirmed (`isCandidateQuestionnaireConfirmed`)
- `maybeTransitionToReady()` викликається з join і confirm

### Правила `LIVE`

**Відмінність від Day 15 spec:** перехід `READY → LIVE` **не** на першому join, а коли:

1. `interview.status === "READY"`, **і**
2. у socket-кімнаті `interview:${id}` присутні **обидва** ролі: HR (власник) і кандидат (`candidateUserId`)

Функція `maybeTransitionToLive(io, interviewId)` викликається після кожного `room:join` і `room:leave` (disconnect).

При переході: `prisma.interview.update({ status: "LIVE" })`, `io.to(room).emit("room:status", { status: "LIVE" })`.

Якщо HR зайшов раніше (`AWAITING_CANDIDATE`) — статус **не** змінюється до `READY`.

---

## HR — вкладка «Співбесіди»

**Файл:** `frontend/src/views/InterviewListView.vue`

### Таблиця

| Колонка | Джерело | Примітка |
|---------|---------|----------|
| Назва | `displayName` | Клік → `/interviews/:id/room` |
| Звіт | `reportSummary` | «—» якщо немає `FinalReport` |
| Дата | `createdAt` | `uk-UA` locale |
| Статус | `status` | Локалізований лейбл |
| Дії | — | Кнопка видалення |

Лейбли статусів:

| `status` | Українською |
|----------|-------------|
| `DRAFT` | Чернетка |
| `AWAITING_CANDIDATE` | Очікує кандидата |
| `READY` | Обидва готові |
| `LIVE` | В ефірі |
| `ENDED` | Завершена |

### Кнопка «Створити зустріч»

- Розміщення: над таблицею на `/interviews`
- З головної HR (`HrHomeView`) кнопку create **прибрати**; лишити лише лічильник співбесід на картці-огляді

### `CreateInterviewModal` — два кроки

**Крок 1 — створення:**

- Заголовок: «Створити зустріч»
- Select confirmed vacancies (як зараз)
- Кнопки: «Скасувати» / «Створити»
- API: `POST /api/interviews` з `{ vacancyId }`

**Крок 2 — код:**

- Заголовок: «Код для кандидата»
- Великий monospace `joinCode`
- Підказка: «Надішліть цей код кандидату»
- Кнопки: «Закрити» / **«Далі»**
- «Далі» → `router.push({ name: "interview-room", params: { id: interview.id } })`

Після «Закрити» або «Далі» — оновити список співбесід (`emit("created")` → reload).

### Видалення

- Кнопка 🗑 у колонці «Дії»
- `window.confirm("Видалити співбесіду? Цю дію не можна скасувати.")`
- API: `DELETE /api/interviews/:id`
- Після успіху — прибрати рядок з таблиці

---

## Кандидат — вкладка «Співbесіда»

**Файл:** `frontend/src/views/CandidateInterviewView.vue`

### Стани UI

| Стан | Відображення |
|------|--------------|
| Немає співбесіди | Текст-підказка + «Приєднатися до зустрічі» |
| Є співбесіда | Назва, статус, контекстний текст |
| `READY` або `LIVE` | Кнопка **«Увійти в кімнату»** |
| `ENDED` | Read-only огляд, без composer |

### Gating join

- Кнопка «Приєднатися до зустрічі» **disabled**, якщо self-service анкета не confirmed
- Підказка: «Спочатку створіть і підтвердіть анкету в розділі «Моя анкета»»
- Backend дублює перевірку: `canCandidateJoinInterview` → 409 `"Candidate questionnaire not confirmed"`

### `JoinInterviewModal`

- Submit-кнопка: **«Приєднатися до співбесіди»** (замість «Приєднатися»)
- Решта без змін (поле коду, помилки join)

---

## Live-кімната (спільна)

### Маршрути

| Роль | Route name | Path |
|------|------------|------|
| HR | `interview-room` | `/interviews/:id/room` |
| Кандидат | `candidate-interview-room` | `/candidate/interview/room` |

Nested під `HrLayout` / `CandidateLayout` відповідно.

`CandidateInterviewRoomView` отримує `interviewId` через `GET /api/candidate/interview` (MVP: одна активна співбесіда на акаунт).

### Компоненти

| Файл | Відповідальність |
|------|------------------|
| `frontend/src/composables/useInterviewRoom.ts` | Socket connect, join, messages, agent-thinking |
| `frontend/src/components/LiveChatPanel.vue` | UI чату за зразком prep-чату |
| `frontend/src/views/InterviewRoomView.vue` | HR room page |
| `frontend/src/views/CandidateInterviewRoomView.vue` | Candidate room page |

### Доступ (`backend/src/socket/room-access.ts`)

```typescript
export function canAccessInterviewRoom(
  interview: Pick<Interview, "hrUserId" | "candidateUserId" | "status">,
  user: AuthUser,
): { ok: true; readOnly: boolean } | { ok: false; error: string };
```

| Роль | Дозволені статуси | readOnly |
|------|------------------|----------|
| HR (власник) | `AWAITING_CANDIDATE`, `READY`, `LIVE`, `ENDED` | `ENDED` |
| Кандидат (прив’язаний) | `READY`, `LIVE`, `ENDED` | `ENDED` |
| Інші | — | 403 |

Помилки українською:

- «Співбесіда ще не готова» — кандидат при `AWAITING_CANDIDATE`
- «Немає доступу» — не власник / не прив’язаний кандидат

### UI фази в кімнаті

| Умова | Banner |
|-------|--------|
| `AWAITING_CANDIDATE`, лише HR | «Очікуємо кандидата. Код: **{joinCode}**» |
| `READY`, не обидва в кімнаті | «Обидва готові. Очікуємо другого учасника в кімнаті» |
| `LIVE` | Banner прихований |
| `ENDED` | «Співбесіда завершена»; composer disabled |

### Підписи повідомлень

| `authorType` | Label |
|--------------|-------|
| `HUMAN_HR` | HR |
| `HUMAN_CANDIDATE` | Кандидат |
| `AGENT_ARBITER` | Arbiter |
| `AGENT_COMPANY` | Компанія |
| `AGENT_CANDIDATE` | Кандидат (AI) |

Агентські повідомлення — клас `.agent` (нейтральний фон).

### HR-only: «Завершити співбесіду»

- **Поза scope цієї спеки** (Day 19–20 UI + `POST /api/interviews/:id/end`)
- У кімнаті кнопку не рендерити до реалізації Day 19

---

## Socket.IO — зміни від Day 15

### Presence tracking

У `backend/src/socket/room-presence.ts` (новий):

```typescript
type RoomPresence = { hrCount: number; candidateCount: number };

export function trackJoin(roomId: string, role: "HR" | "CANDIDATE"): RoomPresence;
export function trackLeave(roomId: string, role: "HR" | "CANDIDATE"): RoomPresence;
export function getPresence(roomId: string): RoomPresence;
```

- `room:join` — increment за роллю
- `disconnect` — decrement (явний `room:leave` не обов’язковий для MVP)
- Після join/leave → `maybeTransitionToLive()`

### Orchestrator gate

У `orchestrator.onHumanMessage()` — на початку:

```typescript
const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
if (!interview || interview.status !== "LIVE") return;
```

Людські повідомлення **зберігаються** навіть до `LIVE`; orchestrator не запускається.

### Pipeline агентів (Day 16–18)

Без змін від окремих specs: `Human → debounce 2.5s → Arbiter → Company → Candidate`.

---

## Backend API

### Новий: `DELETE /api/interviews/:id`

- Auth: HR, `interview.hrUserId === req.user.id`
- Без обмежень за статусом
- Каскадне видалення (транзакція):

```text
1. LiveMessage (where session.interviewId)
2. LiveSession
3. PrepMessageCandidate (where session.interviewId)
4. PrepSessionCandidate
5. CandidateProfile
6. FinalReport
7. Interview
```

- Response: `204 No Content`
- Помилки: `404` not found, `403` forbidden

### Оновлення: `GET /api/interviews/mine`

- `reportSummary`: перший рядок або `recommendation` з `FinalReport`, якщо є; інакше `null`

---

## Файли (summary)

| Файл | Зміна |
|------|-------|
| `frontend/src/views/InterviewListView.vue` | Таблиця, delete, create button |
| `frontend/src/views/HrHomeView.vue` | Прибрати create button + banner |
| `frontend/src/components/CreateInterviewModal.vue` | Два кроки + «Далі» |
| `frontend/src/components/JoinInterviewModal.vue` | Текст кнопки submit |
| `frontend/src/views/CandidateInterviewView.vue` | «Увійти в кімнату» |
| `frontend/src/views/InterviewRoomView.vue` | **Новий** |
| `frontend/src/views/CandidateInterviewRoomView.vue` | **Новий** |
| `frontend/src/composables/useInterviewRoom.ts` | **Новий** |
| `frontend/src/components/LiveChatPanel.vue` | **Новий** |
| `frontend/src/router/index.ts` | Room routes |
| `frontend/src/api/interviews.ts` | `deleteInterview()` |
| `backend/src/routes/interviews.ts` | `DELETE`, reportSummary |
| `backend/src/routes/interviews.test.ts` | Delete tests |
| `backend/src/socket/room-access.ts` | Розширений доступ HR раніше |
| `backend/src/socket/room-presence.ts` | **Новий** |
| `backend/src/socket/room.ts` | Presence + maybeTransitionToLive |
| `backend/src/socket/orchestrator.ts` | Gate `LIVE` |

---

## Тестування

### Backend unit

- `room-access`: матриця роль × статус
- `room-presence`: join/leave counts
- `maybeTransitionToLive`: READY + обидва → LIVE; лише HR → no-op; AWAITING → no-op
- `orchestrator`: no agent run при `READY`; run при `LIVE`
- `DELETE /interviews/:id`: cascade, 403/404

### Manual smoke

1. HR: `/interviews` → «Створити зустріч» → vacancy → код → «Далі» → banner «Очікуємо кандидата»
2. HR пише повідомлення → агенти **не** відповідають
3. Кандидат без confirmed анкети → join disabled
4. Кандидат confirmed → join → статус READY
5. Кандидат «Увійти в кімнату» → обидва в кімнаті → LIVE
6. HR пише → через debounce відповідають агенти
7. HR видаляє співбесіду (будь-який статус) → confirm → зникла з таблиці

---

## Залежності від інших specs

| Spec | Що використовуємо |
|------|-------------------|
| `2026-07-10-live-human-chat-design.md` | Socket протокол, `LiveChatPanel` патерн |
| `2026-07-10-agent-orchestrator-day16-design.md` | Debounce, `room:agent-thinking` |
| Day 17–18 (README) | Arbiter LLM, Company/Candidate agents |
| `2026-07-09-candidate-join-by-code-design.md` | `interview-readiness.ts`, join rules |

**Amendments до Day 15:** доступ HR при `AWAITING_CANDIDATE`; `LIVE` лише при presence обох при `READY`.

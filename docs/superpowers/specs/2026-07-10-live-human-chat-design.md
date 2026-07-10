# Живий чат HR ↔ кандидат — Day 15 Design Spec

**Дата:** 2026-07-10  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 15 плану розробки (README) — «Живий чат між людьми»  
**Передумови:** Дні 8–14 (співбесіда, prep, profile confirm, join-by-code → `READY`)  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- Prisma-моделі `LiveSession` + `LiveMessage` з `LiveAuthorType` (`HUMAN_HR`, `HUMAN_CANDIDATE`, типи для агентів)
- Статуси співбесіди: `AWAITING_CANDIDATE` → `READY` → `LIVE` → `ENDED`
- Prep-чат (HTTP) як UI-референс: список повідомлень, composer, scroll, `authorType`
- JWT-автентифікація для HR і кандидата (`auth_token` у `localStorage`)
- Placeholder «Жива кімната співбесіди з'явиться пізніше» на `InterviewDetailView` і `CandidateInterviewView`

**Мета Дня 15:** HR і кандидат пишуть один одному в реальному часі через Socket.IO; повідомлення зберігаються в БД з підписом автора.

**Поза scope:**

- Agent orchestrator (День 16+)
- HTTP-ендпоінти для кімнати (історія лише через socket)
- Typing indicators, read receipts
- Зміни Prisma-схеми (моделі вже готові)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| UI | **C** — кнопка «Увійти в кімнату» на деталях → окремі сторінки кімнати |
| Socket auth | **A** — JWT у `handshake.auth.token`, верифікація через `verifyToken()` |
| Історія | **A** — повна історія через `room:join` → `room:messages` |
| Архітектура | **1** — модульний Socket.IO на спільному HTTP-сервері (`backend/src/socket/`) |

---

## Підходи (розглянуті)

### 1. Модульний Socket.IO на спільному HTTP-сервері (обрано)

`server.ts` → `http.createServer(app)` + Socket.IO. Логіка кімнати в `backend/src/socket/room.ts`. Фронт: composable `useInterviewRoom` + `LiveChatPanel`.

**Плюси:** відповідає MVP-структурі, готовність до orchestrator на Дні 16–18.  
**Мінуси:** більше файлів, ніж мінімум.

### 2. Inline handlers у `server.ts` (відхилено)

Усі socket-події в одному файлі. Швидкий старт, але `server.ts` роздується при додаванні агентів.

### 3. RoomService-клас + тонкий socket-шар (відхилено)

Over-engineering для Дня 15 (лише 2 людини, без агентів).

---

## Маршрути та UI

### HR

| Маршрут | Призначення |
|---------|-------------|
| `/interviews/:id` | Огляд співбесіди (код, статус). Кнопка «Увійти в кімнату» при `READY` або `LIVE` |
| `/interviews/:id/room` | Жива кімната з чатом |

### Кандидат

| Маршрут | Призначення |
|---------|-------------|
| `/candidate/interview` | Огляд. Кнопка «Увійти в кімнату» при `READY` або `LIVE` |
| `/candidate/interview/room` | Жива кімната з чатом |

### UI чату

За зразком `VacancyPrepView` / `CandidatePrepView`:

- список повідомлень з підписом «HR» / «Кандидат»
- textarea + «Надіслати»
- auto-scroll вниз
- стани: підключення, помилка, read-only (`ENDED`)

Власні повідомлення — вирівнювання праворуч (як у prep-чаті).

---

## Інфраструктура

### Залежності

| Workspace | Пакет |
|-----------|-------|
| `backend` | `socket.io` |
| `frontend` | `socket.io-client` |

### Сервер

`server.ts` рефакторинг:

```typescript
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173" },
});
registerRoomHandlers(io, () => prisma);
httpServer.listen(port, ...);
```

### Vite proxy

Додати в `vite.config.ts`:

```typescript
"/socket.io": {
  target: "http://localhost:3000",
  changeOrigin: true,
  ws: true,
},
```

---

## Socket.IO протокол

### Автентифікація

При `connection` сервер читає `socket.handshake.auth.token`, верифікує через `verifyToken()`, зберігає `{ id, email, role }` на `socket.data.user`. Без валідного токена — `socket.disconnect()`.

### Кімнати

Socket.IO room = `interview:${interviewId}`. Після успішного `room:join` — `socket.join(roomName)`.

### Client → Server

| Подія | Payload | Дія |
|-------|---------|-----|
| `room:join` | `{ interviewId: string }` | Перевірка доступу → `LiveSession` upsert → `READY`→`LIVE` → історія |
| `room:message` | `{ interviewId: string, content: string }` | Зберегти `LiveMessage` → broadcast |

### Server → Client

| Подія | Payload | Коли |
|-------|---------|------|
| `room:messages` | `{ messages: LiveMessageDto[] }` | Після `room:join` (повна історія) і після `room:message` (batch з 1 новим) |
| `room:status` | `{ status: "LIVE" \| "ENDED" }` | При зміні статусу interview |
| `room:error` | `{ error: string }` | Помилка валідації / доступу |

### `LiveMessageDto`

```typescript
type LiveMessageDto = {
  id: string;
  authorType: "HUMAN_HR" | "HUMAN_CANDIDATE";
  content: string;
  createdAt: string; // ISO 8601
};
```

---

## Бекенд-логіка

### `room:join`

1. **Доступ HR:** `interview.hrUserId === user.id`, статус `READY` або `LIVE`
2. **Доступ кандидата:** `interview.candidateUserId === user.id`, статус `READY` або `LIVE`
3. Інакше → `room:error` (українською: «Немає доступу» / «Співбесіда ще не готова»)
4. `LiveSession` — upsert за `interviewId` (створити при першому join)
5. Якщо статус `READY` → оновити на `LIVE`, emit `room:status` усім у кімнаті
6. Завантажити всі `LiveMessage` (`ORDER BY createdAt ASC`) → `room:messages` тільки цьому сокету

### `room:message`

1. Перевірити доступ (як у join), статус не `ENDED`
2. `content` — trim, довжина 1–4000 символів; порожнє → `room:error`
3. `authorType`: `HUMAN_HR` для HR, `HUMAN_CANDIDATE` для кандидата
4. `prisma.liveMessage.create()` → `io.to(room).emit("room:messages", { messages: [newMessage] })`

### Доступ (винесено для тестів)

```typescript
// backend/src/socket/room-access.ts
export function canAccessInterviewRoom(
  interview: Pick<Interview, "hrUserId" | "candidateUserId" | "status">,
  user: AuthUser,
): { ok: true } | { ok: false; error: string };
```

### Структура файлів (бекенд)

```
backend/src/
  socket/
    auth.ts           # verifySocketToken, attachUserToSocket
    room-access.ts    # canAccessInterviewRoom (unit-testable)
    room.ts           # registerRoomHandlers(io)
    types.ts          # DTO, event payloads
  server.ts           # http + io bootstrap
```

---

## Фронтенд

### Нові файли

| Файл | Відповідальність |
|------|------------------|
| `frontend/src/api/socket.ts` | Singleton `io()` з `auth: { token: getStoredToken() }` |
| `frontend/src/composables/useInterviewRoom.ts` | join, send, listeners, connection state |
| `frontend/src/components/LiveChatPanel.vue` | UI чату |
| `frontend/src/views/HrInterviewRoomView.vue` | Сторінка кімнати HR |
| `frontend/src/views/CandidateInterviewRoomView.vue` | Сторінка кімнати кандидата |

### Composable `useInterviewRoom(interviewId)`

1. Mount → connect socket (singleton)
2. `emit("room:join", { interviewId })`
3. `room:messages` → merge у `messages[]` (dedupe за `id`)
4. `sendMessage(text)` → `emit("room:message", { interviewId, content })`
5. Unmount → `off` listeners
6. Стани: `connecting` | `connected` | `error`

### Підписи повідомлень

| `authorType` | Label |
|--------------|-------|
| `HUMAN_HR` | «HR» |
| `HUMAN_CANDIDATE` | «Кандидат» |

### Зміни в існуючих view

- `InterviewDetailView` — кнопка «Увійти в кімнату» → `RouterLink` на `/interviews/:id/room`
- `CandidateInterviewView` — кнопка → `/candidate/interview/room`
- `router/index.ts` — два нові child routes

---

## Обробка помилок

| Ситуація | Поведінка |
|----------|-----------|
| Немає JWT | Редірект на login (існуючий router guard) |
| Статус не `READY`/`LIVE` | Кнопка disabled + підказка на сторінці деталей |
| `room:error` від сервера | Банер українською, composer disabled |
| Socket disconnect | «Перепідключення…», auto-reconnect Socket.IO |
| `ENDED` | Read-only чат, composer disabled |
| Порожнє повідомлення | Кнопка «Надіслати» disabled |

---

## Definition of Done (README Day 15)

- [ ] Демонстрація: дві вкладки браузера — пишеш в одній, бачиш в іншій миттєво
- [ ] Сценарій: повідомлення зберігаються в `LiveSession` з `authorType: HUMAN_HR` / `HUMAN_CANDIDATE`; після перезавантаження історія відновлюється
- [ ] Збірка: `npm run build` проходить
- [ ] README: socket-події `room:join`, `room:message`, `room:messages`

---

## Тестування

### Ручний сценарій

1. Seed: `hr@test.com` / `candidate@test.com`, обидва профілі confirmed → `READY`
2. Вкладка 1 (HR): `/interviews/:id/room`
3. Вкладка 2 (кандидат): `/candidate/interview/room`
4. Обмін повідомленнями — миттєво в обох вкладках
5. Reload обох вкладок — історія на місці
6. Статус interview → `LIVE` після першого join

### Автотести (мінімум)

- `backend/src/socket/room-access.test.ts` — `canAccessInterviewRoom()` для HR, кандидата, заборонених статусів, чужих користувачів

### Build

```bash
npm run build
```

---

## Примітка щодо README DoD

README згадує `authorType: HUMAN` і `ROOM`-сесію — це застарілі назви з раннього MVP design. Фактична схема використовує `LiveSession` / `LiveMessage` з `HUMAN_HR` і `HUMAN_CANDIDATE`. Імплементація слідує поточній Prisma-схемі.

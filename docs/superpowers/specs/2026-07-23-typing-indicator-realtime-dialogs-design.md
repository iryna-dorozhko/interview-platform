# Typing indicator + realtime діалоги — Design Spec

**Дата:** 2026-07-23  
**Статус:** Затверджено в brainstorming  
**Контекст:** Live-кімната вже на Socket.IO (`room:join`, `room:message`, `room:agent-thinking`). Діалоги HR↔кандидат зараз лише REST (`GET`/`POST /api/dialogs/...`); немає typing і realtime нових повідомлень.  
**Передумови:** `docs/superpowers/specs/2026-07-10-live-human-chat-design.md`, `docs/superpowers/specs/2026-07-22-hr-decision-dialogs-design.md`.  
**Мова:** Українська (UI-тексти); технічні ідентифікатори англійською.

---

## Контекст і мета

Коли людина набирає повідомлення, співрозмовник має бачити індикатор друкування. Це потрібно і в спільному чаті співбесіди, і в діалогах. Для діалогів також потрібна realtime-доставка нових повідомлень (без ручного оновлення сторінки).

**Мета:**

1. У live-кімнаті: «Кандидат друкує» / «Рекрутер друкує» під час введення людиною.
2. У діалогах: той самий typing + миттєва поява нових повідомлень у відкритому треді через Socket.IO.
3. Історія діалогу лишається через HTTP GET; відправка повідомлень лишається через HTTP POST, з broadcast у сокет після збереження.

**Поза scope:**

- Typing у списку діалогів (лише відкритий тред / live-чат)
- Read receipts / «прочитано»
- Typing для AI-агентів (уже є «думає…»)
- Повна заміна REST send на socket-only для діалогів
- Зміна unread-badge поза існуючим механізмом (окрім природних наслідків realtime у треді)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Де typing | І в live-кімнаті, і в діалогах |
| Realtime у діалозі | **B** — typing + realtime повідомлення |
| Текст для HR | **B** — «Рекрутер друкує» |
| Текст для кандидата | «Кандидат друкує» |
| Архітектура | **1** — розширити наявний Socket.IO; POST + broadcast |

---

## Підходи (розглянуті)

### 1. Розширити наявний Socket.IO — обрано

Live: `room:typing`. Діалоги: `dialog:join` / `dialog:typing` / broadcast `dialog:message` після HTTP POST. Той самий auth/stack, що вже в кімнаті.

**Плюси:** узгоджено з live-кімнатою; мінімум нової інфри; send path лишається перевіреним REST.  
**Мінуси:** діалоги трохи гібридні (HTTP + socket).

### 2. Усе через сокет (як live-кімната)

**Плюси:** єдина модель realtime.  
**Мінуси:** більший рефактор діалогів, дублювання валідації.

### 3. Typing через socket + polling повідомлень

**Плюси:** менше змін у send-path.  
**Мінуси:** гірший UX; суперечить вибору B.

---

## Архітектура

### Live-кімната

| Подія | Напрямок | Payload | Поведінка |
|-------|----------|---------|-----------|
| `room:typing` | client → server | `{ interviewId, isTyping: boolean }` | Лише учасник кімнати; роль з socket auth |
| `room:typing` | server → room | `{ role: "HR" \| "CANDIDATE", isTyping: boolean }` | Broadcast у `interview:<id>` **без** socket відправника (`socket.to(...)`) |

- Клієнт: debounce emit `true` (~500 мс), idle clear `false` (~2.5 с), clear після успішного send і при порожньому полі.
- UI не показує власний typing.
- Індикатор стилем як `agentThinking` («думає…»); обидва можуть бути видимі одночасно.

### Діалоги

Новий socket-модуль (наприклад `backend/src/socket/dialogs.ts`), реєстрація поруч із `registerRoomHandlers` у `server.ts`.

| Подія | Напрямок | Payload | Поведінка |
|-------|----------|---------|-----------|
| `dialog:join` | client → server | `{ dialogId }` | Перевірка учасника; `socket.join("dialog:<id>")` |
| `dialog:typing` | client → server | `{ dialogId, isTyping }` | Relay як у кімнаті |
| `dialog:typing` | server → room | `{ role: "HR" \| "CANDIDATE", isTyping }` | Без відправника |
| `dialog:message` | server → room | DTO повідомлення (як у HTTP) | Після створення `DialogMessage` на сервері |
| `dialog:error` | server → client | `{ error: string }` | Немає доступу / невірний запит (як `room:error`) |

- Ім’я кімнати: `dialog:<dialogId>`.
- `createDialogsRouter(getPrisma, getIo)` — патерн як у interviews з `() => io`.
- Broadcast `dialog:message` з: `POST /dialogs/:id/messages` і створення decision letter у reports (будь-який шлях, що додає рядок у відкритий тред).
- Відкритий тред: `dialog:join` на mount / зміну id; leave на unmount (або новий join заміщує контекст у `socket.data`).
- Клієнт дедупить вхідні повідомлення по `id` (щоб не дублювати відповідь POST і broadcast).
- Клієнтський emit `isTyping: true` не частіше ніж раз на ~500 мс; idle clear через ~2.5 с.

### Деградація

Якщо сокет недоступний у діалозі: HTTP send/load працюють як зараз; typing і realtime просто відсутні.

---

## UI

**Тексти:**

- Кандидат друкує → `Кандидат друкує`
- HR друкує → `Рекрутер друкує`

**Live (`LiveChatPanel`):** рядок у кінці списку повідомлень (курсив, приглушений), під або поруч із «думає…».

**Діалог (`DialogThreadView`):** той самий патерн під повідомленнями.

**Тригери (обидва чати):**

1. Введення в textarea → `isTyping: true` (throttle/debounce ~500 мс).
2. Idle 2.5 с без введення → `false`.
3. Успішний send → одразу `false`.
4. Порожнє поле після clear → `false`.
5. Свій індикатор собі не показувати.

---

## Frontend composables

- **Live:** розширити `useInterviewRoom` — emit/listen `room:typing`, стан `peerTypingRole`.
- **Діалог:** composable на кшталт `useDialogThread` (або локальна логіка у view) — join, typing, merge `dialog:message`, reuse `connectSocket()`.
- Спільний helper для debounce/idle typing (опційно, якщо уникає дублювання без over-abstraction).

---

## Тестування

**Backend:**

- Room: join → peer отримує `room:typing`; non-participant / invalid payload — без leak.
- Dialog: join лише для учасника; typing relay; чужий `dialogId` — ні.
- POST message → клієнт у `dialog:<id>` отримує `dialog:message` з коректним DTO.

**Frontend:**

- Mapping role → label.
- Clear typing on send / idle (unit на helper або composable, за стилем репо).

---

## Критерії готовності

- [ ] HR бачить «Кандидат друкує» у live і в діалозі під час введення кандидата; зникає після idle/send.
- [ ] Кандидат бачить «Рекрутер друкує» аналогічно.
- [ ] Нове повідомлення в діалозі з’являється у відкритому треді без reload.
- [ ] Власний typing не показується собі.
- [ ] Тести покривають relay typing і broadcast message.
- [ ] Без сокета діалог все ще дозволяє send/load через HTTP.

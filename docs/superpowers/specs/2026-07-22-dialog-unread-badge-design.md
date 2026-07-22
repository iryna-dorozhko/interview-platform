# Unread badge для діалогів HR ↔ кандидат — Design Spec

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming  
**Контекст:** Вкладки «Діалоги» вже є в HR і кандидатському кабінетах (`Dialog`, `DialogMessage`, REST без Socket.IO). Потрібно показувати кількість непрочитаних повідомлень.  
**Передумови:** `GET/POST /api/dialogs`, `DialogListView`, `DialogThreadView`, `HrSidebar`, `CandidateSidebar`.  
**Мова:** Українська (UI); технічні ідентифікатори англійською.

---

## Контекст і мета

MVP уже має людські діалоги HR↔кандидат і вкладку «Діалоги» в обох кабінетах. У попередньому spec unread badge свідомо був поза scope.

**Мета:** Користувач (HR або кандидат) бачить число непрочитаних повідомлень на вкладці «Діалоги» і біля кожного діалогу в списку; відкриття thread позначає повідомлення прочитаними.

**Поза scope:**

- Socket.IO / realtime push
- Email / push-сповіщення
- Per-message read receipts
- Окрема inbox-модель на кшталт `HrNotification`

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Що рахує цифра | Кількість **непрочитаних повідомлень** (не діалогів) |
| Коли mark-as-read | При **відкритті thread** |
| Де показувати бейдж | Сайдбар **і** список діалогів (per-dialog) |
| Оновлення поза сторінкою | Легкий polling (~45 с) |
| Архітектура unread | Курсори `lastReadAt` на учасника діалогу |

---

## Підходи (розглянуті)

### 1. Cursor `lastReadAt` на учасника — обрано

Поля `hrLastReadAt` / `candidateLastReadAt` на `Dialog`. Unread = чужі повідомлення з `createdAt > lastReadAt`.

**Плюси:** мало даних, швидко, достатньо для 1:1 REST MVP.  
**Мінуси:** немає «частково прочитаного» всередині thread (для 1:1 ок).

### 2. `readAt` на кожному повідомленні — відхилено

**Плюси:** точніше. **Мінуси:** зайві апдейти для 1:1.

### 3. Лише localStorage — відхилено

**Плюси:** без міграції. **Мінуси:** не синхронізується між пристроями/сесіями.

---

## Модель даних

### Зміни `Dialog`

| Поле | Тип | Примітки |
|------|-----|----------|
| `hrLastReadAt` | `DateTime?` | Курсор HR; `null` = жоден thread ще не відкривав |
| `candidateLastReadAt` | `DateTime?` | Курсор кандидата |

Міграція Prisma додає обидва nullable поля. Існуючі діалоги стартують з `null` → усі чужі повідомлення вважаються непрочитаними, доки користувач не відкриє thread.

### Правила unread

Для поточного користувача `unreadCount` = кількість `DialogMessage`, де:

1. `senderUserId !== currentUserId`
2. `createdAt > lastReadAt` відповідного учасника (`hrLastReadAt` або `candidateLastReadAt`)
3. якщо `lastReadAt` = `null` — умова (2) виконується для всіх чужих повідомлень

Власні повідомлення ніколи не входять у unread. `DECISION_LETTER` рахується як чуже для отримувача (кандидат), якщо відправник — HR.

**Mark as read:** `POST /api/dialogs/:id/read` виставляє відповідний `*LastReadAt = now()`. Ідемпотентний. Не учасник → 404.

---

## API

### Розширення

**`GET /api/dialogs`** — кожен елемент додатково містить:

```json
{ "unreadCount": 3 }
```

### Нові

**`GET /api/dialogs/unread-count`**

```json
{ "unreadCount": 7 }
```

Сума непрочитаних по всіх діалогах поточного користувача. Легкий ендпоінт для сайдбару / polling.

**`POST /api/dialogs/:id/read`**

```json
{ "ok": true }
```

Оновлює курсор учасника. Окремий POST (а не побічний ефект `GET /dialogs/:id`), щоб GET залишався без side effects.

Маршрут `GET /dialogs/unread-count` реєструється **перед** `GET /dialogs/:id`, щоб `unread-count` не потрапив у `:id`.

---

## Frontend

### Shared state

Composable `useDialogUnread` (або еквівалент у layout):

- при mount layout HR / кандидата — fetch `GET /dialogs/unread-count`
- polling кожні **45 с**
- метод `refresh()` / виклик після `markDialogRead`
- помилки polling — тихо ігнорувати (не ламати навігацію)

### UI

- **`HrSidebar` / `CandidateSidebar`:** біля «Діалоги» pill-бейдж з числом, якщо `unreadCount > 0`; якщо > 99 — `99+`. Стиль як існуючий badge заявок на `HrHomeView`.
- **`DialogListView`:** бейдж біля кожного рядка з `dialog.unreadCount > 0`; мінімальне виділення (напр. жирніший peer email).
- **`DialogThreadView`:** після успішного `fetchDialog` → `markDialogRead(id)` → оновлення shared unread total.

### API client

`frontend/src/api/dialogs.ts`:

- `DialogListItem.unreadCount: number`
- `fetchDialogUnreadCount(): Promise<number>`
- `markDialogRead(id: string): Promise<void>`

---

## Крайні випадки

| Сценарій | Поведінка |
|----------|-----------|
| Порожній діалог / лише свої повідомлення | `unreadCount = 0` |
| Новий `DECISION_LETTER` від HR | Збільшує unread кандидата |
| Повторний `POST .../read` | Ідемпотентний |
| Не учасник | 404 |
| Помилка polling | Тихо ігнорувати |
| Число > 99 у сайдбарі | Показати `99+` |

---

## Тестування

**Backend (`dialogs.test.ts`):**

- unread рахує лише чужі повідомлення
- `null` lastRead → усі чужі
- після mark-read unread = 0 (для повідомлень до моменту read)
- `GET /dialogs/unread-count` сумує по діалогах
- participant / 404 checks для mark-read
- HR і candidate окремо (різні курсори)

**Frontend:**

- мапінг `unreadCount` у API-клієнті (за наявним стилем тестів)
- за можливості — unit на форматування бейджа / composable без зайвих UI-моків

---

## Поза scope (нагадування)

- Socket.IO
- Email / push
- Per-message receipts
- Авто-read при відкритті лише списку діалогів

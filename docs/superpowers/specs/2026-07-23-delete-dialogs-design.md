# Видалення діалогів (per-user hide) — Design Spec

**Дата:** 2026-07-23  
**Статус:** Затверджено в brainstorming  
**Контекст:** Людські діалоги HR↔кандидат уже є (`Dialog`, `DialogMessage`, list/thread, unread). Потрібна можливість прибрати діалог зі **свого** списку через UI.  
**Передумови:** `docs/superpowers/specs/2026-07-22-hr-decision-dialogs-design.md`, `docs/superpowers/specs/2026-07-22-dialog-unread-badge-design.md`.  
**Мова:** Українська (UI, confirm, помилки); технічні ідентифікатори англійською.

---

## Контекст і мета

Зараз учасник може лише читати/писати. Hard-delete діалогу з БД небажаний: історія спільна, decision letters прив’язані до `InterviewDecision`, інша сторона має продовжувати бачити листування.

**Мета:** HR і кандидат можуть «видалити» діалог **лише у себе** зі списку; повідомлення зберігаються; діалог знову з’являється в списку, коли **інша** сторона надсилає нове повідомлення.

**Поза scope:**

- Hard-delete `Dialog` / `DialogMessage` з БД
- Ручне «відновити» без нового повідомлення
- Mute / pin / окрема таблиця вподобань учасника
- Окремий модальний компонент замість `window.confirm`
- Socket.IO / realtime
- Кнопка видалення в списку діалогів

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Хто «видаляє» | **C** — кожен лише у себе; інша сторона далі бачить діалог |
| Після hide | **C** — зникає зі списку; знову з’являється, коли співрозмовник пише |
| Де кнопка | **B** — лише в шапці відкритого треду |
| Підтвердження | **C** — `confirm` з поясненням про повернення після чужого повідомлення |
| Архітектура | **A** — `hrHiddenAt` / `candidateHiddenAt` на `Dialog` |

---

## Підходи (розглянуті)

### A. Поля `hrHiddenAt` / `candidateHiddenAt` на `Dialog` — обрано

Nullable timestamps на учасника. `DELETE` ставить свій; list/unread фільтрують; чуже повідомлення скидає hide отримувача.

**Плюси:** мінімальна схема, узгоджено з `hrLastReadAt` / `candidateLastReadAt`, просто тестувати.  
**Мінуси:** логіка hide розмазана по list/send (прийнятно для MVP).

### B. Окрема таблиця `DialogParticipantState`

**Плюси:** місце для майбутніх mute/pin.  
**Мінуси:** YAGNI зараз.

### C. Hard-delete «для мене»

Не підходить під спільну історію та auto-reappear.

---

## Модель даних

```prisma
model Dialog {
  // ... existing fields ...
  hrHiddenAt        DateTime?
  candidateHiddenAt DateTime?
}
```

- `null` = діалог видимий у списку цієї сторони.
- Ненульове значення = сховано для цієї сторони з моменту hide.
- Міграція: існуючі рядки → обидва поля `null`.
- Повідомлення, `InterviewDecision`, unread-курсори (`*LastReadAt`) **не** змінюються при hide.

---

## API

### `DELETE /api/dialogs/:id`

- Auth: як інші dialog routes (`requireAuth`).
- Учасник (`hrUserId` або `candidateUserId`): виставити відповідне `*HiddenAt = now()` → **204**.
- Не учасник / немає діалогу → **404** (без витоку існування).
- Ідемпотентність: повторний DELETE на вже схованому → знову **204** (оновити timestamp або no-op — достатньо успіху без зміни семантики list).
- Тіло відповіді не потрібне.
- Не видаляє messages / decisions.

### `GET /api/dialogs`

Виключити діалоги, де для поточного користувача відповідне `*HiddenAt != null`.

### `GET /api/dialogs/unread-count`

Той самий фільтр: сховані для користувача **не** входять у суму непрочитаних.

Per-dialog unread у list теж лише для видимих рядків (list уже відфільтрований).

### `GET /api/dialogs/:id`

Без змін за visibility: сховані діалоги **доступні** за прямим URL (історія на місці). Hide впливає лише на list і unread aggregate.

### `POST /api/dialogs/:id/messages`

Після успішного створення повідомлення:

- якщо автор — HR → `candidateHiddenAt = null`
- якщо автор — кандидат → `hrHiddenAt = null`

Власний `*HiddenAt` автора **не** скидається цим правилом.

Рішення/листи зі звіту (`POST /reports/:id/decisions`), що створюють `DialogMessage` від HR, мають ту саму семантику для кандидата: скинути `candidateHiddenAt`, щоб кандидат знову побачив діалог у списку (лист — нове повідомлення від іншої сторони з точки зору кандидата).

### Створення діалогу `POST /api/dialogs`

Без змін. Новий діалог має обидва `*HiddenAt = null`.

---

## UI

**Файл:** `frontend/src/views/DialogThreadView.vue` (спільний для HR і кандидата).

У `<header class="header">`: кнопка **«Видалити»** (стиль як у vacancy/interview delete — небезпечна/вторинна).

Після кліку:

```text
Видалити цей діалог зі свого списку? Він знову з’явиться, якщо співрозмовник напише нове повідомлення.
```

через `window.confirm`.

Успіх:

1. `deleteDialog(id)` у `frontend/src/api/dialogs.ts` → `DELETE /api/dialogs/:id`
2. Навігація на `basePath` (`/dialogs` або `/candidate/dialogs`)
3. Оновити unread (`useDialogUnread` — існуючий refresh/poll)

Помилка delete: коротке повідомлення в треді, **без** редіректу.

Список (`DialogListView`): UI-змін немає — API просто не повертає сховані.

---

## Крайові випадки

| Сценарій | Поведінка |
|----------|-----------|
| Обидві сторони сховали | Обидва не бачать у list; перше нове повідомлення від A показує діалог B (і навпаки при відповіді) |
| Hide → відкрити за bookmark URL | Thread відкривається; list як і раніше без цього рядка |
| Hide → своє повідомлення (якщо лишилися на URL) | Власний hide не скидається; інша сторона може знову побачити діалог |
| Decision letter після hide кандидата | Кандидат знову бачить діалог у list (скидання `candidateHiddenAt`) |
| Unread на схованому без чужих нових повідомлень | Не рахується; після чужого повідомлення — unhide + unread як зазвичай |

---

## Тестування

Розширити `backend/src/routes/dialogs.test.ts`:

1. HR hide → немає в HR list/unread; кандидат бачить  
2. Candidate hide → симетрично  
3. Після HR hide кандидат шле message → `hrHiddenAt` null, діалог знову в HR list  
4. Власне message після hide **не** очищає hide автора  
5. Не-учасник DELETE → 404  
6. Після hide `GET :id` і messages/decision letters на місці  

Фронт: ручна перевірка confirm → редірект → відсутність у list; окремий e2e поза цим spec.

---

## Файли (орієнтовно)

| Шар | Файли |
|-----|--------|
| Schema | `backend/prisma/schema.prisma` + міграція |
| API | `backend/src/routes/dialogs.ts`, `dialogs.test.ts`; за потреби `reports.ts` (decision letter → clear candidate hide) |
| Client | `frontend/src/api/dialogs.ts` |
| UI | `frontend/src/views/DialogThreadView.vue` |

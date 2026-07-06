# Design: Company Prep Chat UI — «Видалити чат» і «Завершити чат»

**Дата:** 2026-07-06
**Статус:** Approved

## Контекст

День 4 реалізував серверну частину Company Agent (`POST /api/prep/:interviewId/message`), але UI для цього чату ще не існує — це запланований День 5. Цей дизайн об'єднує побудову чат-сторінки з двома новими діями: **«Видалити чат»** і **«Завершити чат»**, де завершення генерує структурований профіль вакансії з діалогу.

Фактично це реалізує День 5 повністю і частину Дня 6 (генерація `CompanyProfile`), залишаючи явне підтвердження (`confirmedAt`, День 7) на потім.

## Архітектура

```
HomeView ──(GET /api/interviews/mine)──> перша співбесіда HR
   │
   └─> router.push /prep/:interviewId
                │
                ▼
      CompanyPrepView.vue
                │
     GET /api/prep/:interviewId  (стан: messages, isClosed, profile)
                │
        ┌───────┴────────┐
        │                │
   isClosed && profile   інакше
        │                │
        ▼                ▼
  Профіль (read-only,   Чат (історія + інпут +
  layout A, "← Назад     кнопки "Видалити чат" /
  до чату")              "Завершити чат")
```

## API — нові endpoints

### `GET /api/prep/:interviewId`

Повертає поточний стан анкети для рендеру сторінки.

- 200: `{ messages: PrepMessageHr[], isClosed: boolean, profile: CompanyProfile | null }`. Якщо сесії ще не існує — `{ messages: [], isClosed: false, profile: null }` (без створення запису; сесія створюється лениво при першому `POST /message`, як і зараз).
- 404 — `interviewId` не знайдено.
- 403 — співбесіда належить іншому HR.

### `POST /api/prep/:interviewId/finish`

Генерує структурований профіль вакансії з усієї історії `PrepMessageHr` і закриває сесію.

- Забирає всю історію сесії (`PrepMessageHr`, за зростанням `createdAt`).
- Будує повідомлення для LLM через новий `buildProfileExtractionMessages(history)` (`backend/src/agents/company-agent.ts`) — системний промпт просить строгий JSON:
  ```json
  { "role": "string", "requirements": ["..."], "culture": ["..."], "expectations": ["..."] }
  ```
- Парсить відповідь LLM через новий `parseProfileExtraction(rawReply)`:
  - Толерантний до markdown-код-блоків навколо JSON (` ```json ... ``` `), за аналогією з толерантністю `READY:`-маркера в Дні 4.
  - Якщо парсинг провалився або структура невалідна (немає одного з чотирьох полів) — кидає помилку; сесія **не** закривається, HR може спробувати ще раз.
- Upsert `CompanyProfile` (`role` — рядок, `requirements`/`culture`/`expectations` — `Json`-масиви коротких рядків). `confirmedAt` **не встановлюється** — це окремий крок Дня 7.
- Встановлює `isClosed: true` на `PrepSessionHr`.
- Відповіді:
  - 200: `{ profile: CompanyProfile }`
  - 404 / 403 — як і в `POST /message`.
  - 409 — сесія вже закрита (`isClosed: true`). Щоб почати знову — спочатку `DELETE`.
  - 502 — LLM повернув невалідний/непарсабельний JSON (`{ error: "LLM unavailable", detail }`), сесія лишається відкритою.
  - 503 — LLM недоступний (provider init/timeout), за існуючим паттерном з `POST /message`.
  - 500 — збій запису в БД (upsert профілю або оновлення сесії) — окремий `try/catch`, за паттерном розділення LLM/DB помилок з Дня 4.

Немає серверної перевірки «даних достатньо» — рішення дає фронтенд (діалог підтвердження), бекенд завжди намагається згенерувати профіль з того, що є в історії. Якщо якась тема не обговорювалась — LLM пише `"не вказано"` в відповідному полі замість вигадування.

### `DELETE /api/prep/:interviewId`

Повний рестарт анкети: видаляє `PrepMessageHr` (усі), `PrepSessionHr` і `CompanyProfile` (якщо є) для цієї співбесіди.

- 200 завжди при успіху, незалежно від того, чи існувала сесія (ідемпотентно — фронтенду не треба перевіряти стан перед викликом).
- 404 / 403 — якщо `interviewId` не існує / належить іншому HR.
- 500 — збій видалення в БД.
- Доступно завжди, навіть коли `isClosed: true`.

### `GET /api/interviews/mine`

Легкий список співбесід поточного HR — тимчасовий місток до повного дашборду (День 9).

- 200: `{ interviews: [{ id, joinCode, status }, ...] }`, відсортовано за `createdAt desc`.
- Порожній масив, якщо співбесід нема.
- Новий файл `backend/src/routes/interviews.ts`, підключений за `requireAuth` + `requireHr`.

## Фронтенд

### Нова сторінка `frontend/src/views/CompanyPrepView.vue` (маршрут `/prep/:interviewId`)

Стан завантаження:
1. `GET /api/prep/:interviewId`.
2. Якщо `isClosed && profile` → рендер **Profile View**.
3. Інакше → рендер **Chat View**; якщо `messages.length === 0` → одразу викликати `POST /message` з `{}` (агент вітається першим).

**Chat View:**
- Хедер: заголовок + дві кнопки — «Видалити чат» (нейтральна, ліворуч) і «Завершити чат» (зелена, праворуч) — обидві завжди в хедері (layout A з брейнштормінгу).
- Список повідомлень + інпут + «Надіслати» — той самий UX-паттерн, що вже є в `ChatPanel.vue` (День 2), підключений до `/api/prep/:interviewId/message` замість `/api/llm/complete`.
- Локально зберігаємо останнє значення `readyForConfirmation` з відповіді агента.

**Дії:**
- **«Видалити чат»** → `window.confirm("Видалити всю історію чату? Цю дію не можна скасувати.")` → якщо ОК → `DELETE /api/prep/:interviewId` → очистити локальний стан → одразу заново тригернути привітання (`POST /message` з `{}`).
- **«Завершити чат»**:
  - якщо останнє `readyForConfirmation === false` → `window.confirm("Даних може бути недостатньо. Все одно завершити й сформувати профіль?")`; якщо відмова — нічого не робити.
  - інакше (або після підтвердження) → `POST /finish` → при успіху рендер **Profile View**.
  - при `502`/`503` — показати помилку в UI (banner), сесія лишається в чаті.

**Profile View:**
- Layout A — повністю заміняє чат-панель карткою профілю: `role`, `requirements`, `culture`, `expectations` (списки).
- Кнопка «← Назад до чату» — перемикає локально на **read-only** перегляд історії повідомлень (без інпуту, без кнопок дій; сесія залишається закритою). Це лише перегляд, не реактивація чату.
- Кнопка «Видалити чат» доступна і тут (для повного рестарту).

### Оновлення `HomeView.vue`

- Додається кнопка/посилання «Анкета компанії»: викликає `GET /api/interviews/mine`, бере перший елемент масиву, `router.push({ name: "company-prep", params: { interviewId } })`.
- Якщо масив порожній — коротке повідомлення «Спочатку створіть співбесіду» (заглушка, бо створення співбесід — День 8).

### Маршрут

`frontend/src/router/index.ts`: `{ path: "/prep/:interviewId", name: "company-prep", component: CompanyPrepView, meta: { requiresAuth: true } }`.

## Дані

Без змін схеми Prisma — `CompanyProfile` вже існує (`role: String`, `requirements/culture/expectations: Json`, `confirmedAt: DateTime?`). `requirements`/`culture`/`expectations` зберігаються як JSON-масиви коротких рядків (`string[]`), що узгоджується з планом Дня 6.

## Обробка помилок (зведення)

| Дія | Помилка | Код |
|---|---|---|
| Будь-який endpoint | interview не знайдено | 404 |
| Будь-який endpoint | інша HR-компанія (не власник) | 403 |
| `POST /finish` | сесія вже закрита | 409 |
| `POST /finish` | LLM повернув невалідний JSON | 502 |
| `POST /finish` / `POST /message` | LLM недоступний | 503 |
| `POST /finish` / `DELETE` | збій запису/видалення в БД | 500 |

## Тестування

**Бекенд (автоматизовані, за існуючим паттерном з фейковим Prisma/LLM):**
- `backend/src/agents/company-agent.test.ts` — додати тести на `buildProfileExtractionMessages` і `parseProfileExtraction` (валідний JSON, JSON у код-блоці, невалідний JSON, відсутнє поле).
- `backend/src/routes/prep.test.ts` — додати сценарії для `GET`, `POST /finish` (успіх, 409 на закритій сесії, 502 на поганому JSON), `DELETE` (успіх, ідемпотентність).
- Новий `backend/src/routes/interviews.test.ts` — `GET /api/interviews/mine` (порожній список, список власних, ізоляція між HR).

**Фронтенд:** у проєкті немає автоматизованих тестів для Vue (лише `vue-tsc`). Перевірка — ручний сценарій, задокументований у README (Quick Start), аналогічно попереднім дням.

## Definition of Done

- Демонстрація: HR відкриває «Анкета компанії» в браузері, веде діалог, бачить кнопки «Видалити чат» і «Завершити чат»; завершення показує зібраний профіль.
- Сценарій: видалення повністю очищає історію і дозволяє почати знову; завершення з неповними даними питає підтвердження; профіль зберігається в `CompanyProfile`.
- Збірка: `npm run build` проходить.
- README: оновлений Quick Start з новими кроками (UI-сценарій + опис нових endpoints).

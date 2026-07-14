# interview-platform

План розробки — по днях
Проєкт: новий AI-інструмент для найму (з нуля)
Темп: ~4 години на день, 22 робочі дні
Порядок: спочатку HR → потім кандидат → спільна співбесіда → звіт
Вхід кандидата: окремий логін і реєстрація (як у HR)

**Definition of Done (для кожного дня):** день вважається завершеним, коли виконані всі чотири пункти:
1. **Демонстрація працює** — можна показати результат вживу (UI, API або скрипт).
2. **Сценарій перевірений** — пройдено ручний чекліст саме для цього дня.
3. **Код проходить збірку** — `npm run build` у корені monorepo без помилок.
4. **README оновлено** — задокументовано нові кроки, API, змінні середовища або сценарій перевірки.

---

Дні 1–2 — Підготовка (один раз на весь проєкт)

## День 1 — Запуск проєкту

**Задача:** створити новий репозиторій і «скелет» системи.

**Що робиш:**
- Створюєш папки для сайту (frontend) і сервера (backend)
- Налаштовуєш базу даних: користувачі, співбесіди, повідомлення, профілі, звіти
- Додаєш тестового HR у базу (через seed)

**Definition of Done:**
- [x] Демонстрація: `npm run dev` піднімає frontend і backend; `prisma migrate` + `seed` проходять без помилок
- [x] Сценарій: відкрити обидва сервіси в браузері; перевірити підключення до PostgreSQL; HR `hr@test.com` є в базі після seed
- [x] Збірка: `npm run build` проходить
- [x] README: встановлення залежностей, `.env.example`, команди запуску dev і міграцій

## Day 1 Bootstrap Structure

Проєкт використовує `npm workspaces` з двома пакетами:

- `frontend` — клієнтський застосунок;
- `backend` — серверний застосунок.

### Запуск

```bash
npm install
npm run dev
npm run build
```

Кореневі команди оркеструють виконання скриптів в обох воркспейсах.

### Runtime Verification (Day 1)

Після підготовки бази (`Database Quick Start` нижче):

```bash
npm run dev
```

Сервіси:
- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:3000/api/health](http://localhost:3000/api/health)

Очікуваний результат у браузері (frontend):
- Backend API: **OK**
- PostgreSQL: **OK**
- Seed HR (`hr@test.com`): **OK**

Альтернативна перевірка:

```bash
curl http://localhost:3000/api/health
```

Очікувана відповідь:

```json
{"ok":true,"database":{"ok":true},"seed":{"ok":true,"email":"hr@test.com"}}
```

### Database Quick Start (Day 1)

Виконай кроки послідовно:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
docker compose up -d postgres
npm install
npm --workspace backend run db:generate
npm --workspace backend run db:migrate -- --name init_interview_mvp
npm --workspace backend run db:seed
```

Після `db:seed` очікуваний тестовий користувач:
- `hr@test.com` / `123456`

> `db:migrate` і `db:seed` потребують доступного PostgreSQL (локально або в Docker).
> Якщо Docker daemon вимкнений, контейнер Postgres не піднято, або користувач/БД недоступні, Prisma поверне `P1010` чи connection errors.

---

## День 2 — Підключення AI

**Задача:** навчити сервер розмовляти з локальною моделлю (omlx) або Gemini.

**Що робиш:**
- Запускаєш omlx: `omlx serve --port 8000` (модель `Qwen2.5-7B-Instruct-4bit` у `~/.omlx/models`)
- Backend викликає `POST /api/llm/complete` через плагінований `LlmProvider`
- На фронтенді — чат з AI на головній сторінці
- Перевірка: UI, curl або `npm run llm:test --workspace backend`

**Definition of Done:**
- [x] Демонстрація: тестовий endpoint або скрипт повертає текст від LLM
- [x] Сценарій: curl/Postman на LLM endpoint — осмислена відповідь українською або англійською
- [x] Збірка: `npm run build` проходить
- [x] README: env-змінні, запуск omlx, приклад curl

### LLM Quick Start (Day 2)

**1. Запустити omlx (окремий термінал):**

```bash
omlx serve --port 8000
```

**2. Налаштувати env** (`backend/.env`):

```
LLM_PROVIDER=omlx
OMLX_BASE_URL=http://127.0.0.1:8000
OMLX_MODEL=Qwen2.5-7B-Instruct-4bit
OMLX_API_KEY=your-omlx-api-key
```

> Якщо в omlx увімкнено auth (`API key authentication: enabled` у логах), ключ береться з `~/.omlx/settings.json` → `auth.api_key`.

Для Gemini:

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.0-flash
```

**3. Перевірка endpoint:**

```bash
curl -X POST http://localhost:3000/api/llm/complete \
  -H "Content-Type: application/json" \
  -d '{"message":"Привіт! Скажи одне речення українською."}'
```

Очікувана відповідь:

```json
{"text":"...","provider":"omlx"}
```

**4. Перевірка CLI:**

```bash
npm run llm:test --workspace backend
npm run llm:test --workspace backend -- --message "Hello"
```

**5. Перевірка UI (чат):**

```bash
npm run dev
```

Відкрий [http://localhost:5173](http://localhost:5173) — блок «Чат з AI» під статусом системи.

---

Частина 1 — HR-кабінет (дні 3–9)
HR може все робити сам, без кандидата.

## День 3 — Вхід для HR

**Задача:** HR може зайти на сайт під своїм акаунтом.

**Що робиш:**
- Сторінка логіну
- Перевірка email + пароль, видача сесії (JWT)
- Захист HR-сторінок: без логіну не пустити

**Definition of Done:**
- [x] Демонстрація: HR логіниться через UI і потрапляє в кабінет
- [x] Сценарій: `hr@test.com` / `123456` → JWT; без токена HR-маршрути повертають 401 або редірект на логін
- [x] Збірка: `npm run build` проходить
- [x] README: тестові акаунти HR, як увійти, формат `Authorization: Bearer`

### Auth Quick Start (Day 3)

**1. Env** (`backend/.env`):

```
JWT_SECRET=dev-secret-min-8-chars
```

> Мінімум 8 символів; без `JWT_SECRET` backend не стартує.

**2. Логін через UI:**

```bash
npm run dev
```

Відкрий [http://localhost:5173](http://localhost:5173) → редірект на `/login`.

Тестовий акаунт: `hr@test.com` / `123456`

Після входу — головна сторінка з чатом AI; сесія зберігається в `localStorage` (`auth_token`).

**3. Логін через curl:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@test.com","password":"123456"}'
```

Очікувана відповідь:

```json
{"token":"...","user":{"id":"...","email":"hr@test.com","role":"HR"}}
```

**4. Захищений запит (LLM з Bearer token):**

```bash
TOKEN="<token-from-login>"
curl -X POST http://localhost:3000/api/llm/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Привіт"}'
```

Без токена → `401 Unauthorized`.

---

## День 4 — Company Agent (серверна частина)

**Задача:** AI-агент компанії вміє вести анкету в чаті.

**Що робиш:**
- Промпт українською: питання про вакансію, вимоги, культуру
- API: надіслати повідомлення HR → отримати відповідь агента
- Збереження історії чату в базі

**Definition of Done:**
- [x] Демонстрація: через Postman/curl HR веде діалог з Company Agent (мінімум 3 обміни)
- [x] Сценарій: повідомлення зберігаються в `PrepSessionHr` + `PrepMessageHr`; відповіді агента релевантні темі вакансії
- [x] Збірка: `npm run build` проходить
- [x] README: endpoint `POST /prep/:interviewId/message`, приклад запиту/відповіді

### Company Agent Quick Start (Day 4)

**1. Отримати id тестової співбесіди** (створюється разом з HR під час `db:seed`):

```bash
npm --workspace backend run db:seed
```

У виводі буде рядок на кшталт:

```
Seeded test interview: id=cmr949qn80001vdr97g7k1475 joinCode=TEST01
```

Скопіюй значення `id` — це `<interviewId>` для наступних кроків.

**2. Логін HR:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@test.com","password":"123456"}'
```

**3. Перше повідомлення (агент сам вітається і ставить перше питання):**

```bash
TOKEN="<token-from-login>"
INTERVIEW_ID="<interviewId-from-seed>"

curl -X POST "http://localhost:3000/api/prep/$INTERVIEW_ID/message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

Очікувана відповідь:

```json
{ "message": "Привіт! Розкажіть, будь ласка, про вакансію — яка це посада?", "readyForConfirmation": false }
```

**4. Продовжити діалог (мінімум 3 обміни):**

```bash
curl -X POST "http://localhost:3000/api/prep/$INTERVIEW_ID/message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Middle Backend Developer, потрібен досвід з Node.js та PostgreSQL"}'
```

Повторити з наступними відповідями про вимоги, культуру й очікування. Коли даних достатньо, відповідь міститиме `"readyForConfirmation": true`.

**5. Перевірка в базі:** повідомлення зберігаються в таблицях `PrepSessionHr` і `PrepMessageHr`, прив'язаних до `interviewId`.

---

## День 5 — Анкета HR в браузері

**Задача:** HR бачить чат з агентом на сайті.

**Що робиш:**
- Сторінка «Анкета компанії»
- Список повідомлень, поле вводу, кнопка «Надіслати»
- Підключення до API з дня 4

**Definition of Done:**
- [x] Демонстрація: HR проходить анкету в браузері, як звичайний месенджер
- [x] Сценарій: надіслати повідомлення → воно з’являється в UI → приходить відповідь агента; оновлення сторінки показує історію
- [x] Збірка: `npm run build` проходить
- [x] README: як відкрити анкету HR у UI, маршрут сторінки

### Company Prep Chat UI Quick Start (Day 5)

**1. Увійти і відкрити анкету:**

```bash
npm run dev
```

Відкрий [http://localhost:5173](http://localhost:5173) → логін `hr@test.com` / `123456` → на головній сторінці натисни кнопку **«Анкета компанії»**. Тебе перенесе на `/prep/:interviewId` (найновіша співбесіда поточного HR), і агент одразу привітається першим повідомленням.

**2. Кнопки в чаті:**

- **«Видалити чат»** — видаляє всю історію діалогу і профіль (якщо вже сформований), і починає розмову заново. Доступна завжди, навіть після завершення.
- **«Завершити чат»** — аналізує весь діалог і формує структурований профіль вакансії (посада, вимоги, культура, очікування); закриває чат для подальших повідомлень. Якщо агент ще не позначив розмову як достатню, попросить підтвердження перед завершенням.

**3. Endpoints (для перевірки curl/Postman):**

```bash
TOKEN="<token-from-login>"
INTERVIEW_ID="<interviewId-from-seed>"
```

Стан анкети:

```bash
curl "http://localhost:3000/api/prep/$INTERVIEW_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Завершити чат і отримати профіль:

```bash
curl -X POST "http://localhost:3000/api/prep/$INTERVIEW_ID/finish" \
  -H "Authorization: Bearer $TOKEN"
```

Очікувана відповідь:

```json
{ "profile": { "role": "...", "requirements": ["..."], "culture": ["..."], "expectations": ["..."] } }
```

Видалити чат (повний рестарт):

```bash
curl -X DELETE "http://localhost:3000/api/prep/$INTERVIEW_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Список своїх співбесід (для навігації):

```bash
curl "http://localhost:3000/api/interviews/mine" \
  -H "Authorization: Bearer $TOKEN"
```

---

## День 6 — Профіль компанії з анкети

**Задача:** після чату система збирає структурований профіль.

**Що робиш:**
- Після діалогу AI формує JSON: посада, вимоги, культура, очікування
- Показуєш HR зібраний профіль на екрані (текстом, без редагування полів)

**Definition of Done:**
- [x] Демонстрація: після завершення діалогу HR бачить зібраний профіль на екрані
- [x] Сценарій: JSON містить поля `role`, `requirements`, `culture`, `expectations`; дані відповідають змісту чату
- [x] Збірка: `npm run build` проходить
- [x] README: структура `CompanyProfile` JSON, коли профіль генерується

### Company Profile Quick Start (Day 6)

**Коли генерується:** HR натискає «Завершити чат» → фронтенд викликає `POST /api/prep/:interviewId/finish` (приклад запиту — див. Day 5 Quick Start вище). Бекенд бере всю історію `PrepMessageHr` цієї сесії, просить LLM (`buildProfileExtractionMessages` + `PROFILE_EXTRACTION_SYSTEM_PROMPT_UK`) стисло структурувати її в JSON, парсить і валідує відповідь (`parseProfileExtraction`) і зберігає результат у таблицю `CompanyProfile` (`upsert` за `interviewId`), одночасно закриваючи `PrepSessionHr` (`isClosed: true`).

**Структура `CompanyProfile` JSON:**

```json
{
  "role": "Middle Backend Developer",
  "requirements": ["Node.js", "PostgreSQL", "2+ роки досвіду"],
  "culture": ["remote-first", "код-рев'ю обов'язкове"],
  "expectations": ["2-3 фічі за квартал", "участь у дизайн-рев'ю"],
  "confirmedAt": null
}
```

- `role` — рядок (посада, рівень).
- `requirements` / `culture` / `expectations` — масиви коротких рядків (`string[]`), збережені в БД як `Json`. Якщо тема не обговорювалась у чаті, LLM пише `"не вказано"` замість вигадування фактів.
- `confirmedAt` — `null` одразу після `finish`; встановлюється окремим кроком підтвердження (Day 7).
- Якщо LLM повернула невалідний JSON — `finish` відповідає `502`, а prep-сесія лишається відкритою для повторної спроби (профіль не зберігається).

**Показ HR:** `CompanyPrepView.vue` після успішного `finish` одразу рендерить профіль текстом (список `role`/`requirements`/`culture`/`expectations`) без будь-яких полів для редагування — лише кнопки «← Назад до чату» (перегляд історії) і «Видалити чат» (повний рестарт анкети).

---

## День 7 — Підтвердження профілю HR

**Задача:** HR каже «так, це правильно» і профіль фіксується.

**Що робиш:**
- Кнопка «Підтвердити профіль»
- Збереження профілю з датою підтвердження
- Без підтвердження — далі не пустити

**Definition of Done:**
- [x] Демонстрація: HR натискає «Підтвердити» → профіль збережено з `confirmedAt`
- [x] Сценарій: без підтвердження створення співбесіди / наступні кроки заблоковані; після підтвердження prep-сесія закрита (`isClosed`)
- [x] Збірка: `npm run build` проходить
- [x] README: endpoint `POST /prep/:interviewId/confirm`, поведінка після підтвердження

### HR Profile Confirmation Quick Start (Day 7)

Після генерації профілю через `POST /api/prep/:interviewId/finish` HR може зафіксувати результат:

```bash
TOKEN="<token-from-login>"
INTERVIEW_ID="<interviewId-from-seed>"

curl -X POST "http://localhost:3000/api/prep/$INTERVIEW_ID/confirm" \
  -H "Authorization: Bearer $TOKEN"
```

Очікувана відповідь:

```json
{
  "profile": {
    "role": "Middle Backend Developer",
    "requirements": ["Node.js"],
    "culture": ["не вказано"],
    "expectations": ["не вказано"],
    "confirmedAt": "2026-07-07T09:00:00.000Z"
  },
  "interviewStatus": "AWAITING_CANDIDATE"
}
```

Типові помилки:
- `404 Profile not found` — профіль ще не згенеровано (`finish` не викликано).
- `409 Profile already confirmed` — профіль уже підтверджено раніше.

Після підтвердження `DELETE /api/prep/:interviewId` більше не скидає prep-чат і повертає `409`:

```json
{ "error": "Profile is confirmed and cannot be reset" }
```

---

## День 8 — Створення співбесіди

**Задача:** HR створює співбесіду і отримує код для кандидата.

**Що робиш:**
- Кнопка «Створити співбесіду»
- Генерація 6-символьного коду (наприклад K7M2P9)
- Прив’язка підтвердженого профілю компанії до співбесіди
- Статус: «Очікує кандидата»

**Definition of Done:**
- [x] Демонстрація: HR натискає кнопку → бачить 6-символьний код на екрані
- [x] Сценарій: код унікальний; співбесіда створюється в статусі `DRAFT`; профіль компанії підтверджується окремо через уже наявний флоу Днів 4–7, що переводить статус у `AWAITING_CANDIDATE`
- [x] Збірка: `npm run build` проходить
- [x] README: endpoint `POST /interviews`, формат коду, статуси співбесіди

### Create Interview Quick Start (Day 8)

HR може створити нову співбесіду (незалежно від seed-співбесіди з Дня 1) одним запитом:

```bash
TOKEN="<token-from-login>"

curl -X POST http://localhost:3000/api/interviews \
  -H "Authorization: Bearer $TOKEN"
```

Очікувана відповідь:

```json
{
  "interview": {
    "id": "cmr9...",
    "joinCode": "K7M2P9",
    "status": "DRAFT",
    "createdAt": "2026-07-07T10:00:00.000Z"
  }
}
```

**Формат коду:** 6 символів з алфавіту `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (без `0`, `O`, `1`, `I` — щоб код було легше диктувати кандидату голосом). Унікальність гарантується `@unique` у схемі; при колізії бекенд автоматично генерує новий код (до 5 спроб) і лише після цього повертає `500`.

**Далі:** з отриманим `id` HR переходить у звичний prep-флоу (`GET/POST /api/prep/:interviewId/...`, Дні 4–7) — заповнює анкету, отримує й підтверджує профіль компанії. Підтвердження автоматично переводить `Interview.status` із `DRAFT` у `AWAITING_CANDIDATE` (реалізовано в Дні 7, працює однаково для будь-якої співбесіди, включно з новоствореними).

**UI:** на головній сторінці кнопка **«Створити співбесіду»** одразу показує код у зеленому банері з кнопкою «Перейти до анкети →», яка веде у щойно створену співбесіду.

**Помилки:**
- `500 { "error": "Failed to generate unique join code" }` — вичерпано 5 спроб згенерувати унікальний код (вкрай малоймовірно при 32^6 можливих кодах).

---

## День 9 — HR-кабінет: анкети та співбесіди

**Задача:** Розділити доменні сутності «анкета вакансії» та «співбесіда з кандидатом», додати глобальну бічну панель, overview-головну та окремі списки.

**Що робиш:**
- Нова модель `Vacancy` (анкета) — prep-чат, профіль компанії, підтвердження (Дні 4–7)
- `Interview` (співбесіда) — лише сесія з кандидатом: `joinCode`, статуси, зв'язок `vacancyId`
- Глобальний `HrLayout` з бічною панеллю на всіх сторінках HR
- Головна `/` — overview-картки + кнопки створення; списки — `/vacancies` та `/interviews`

**Definition of Done:**
- [x] Демонстрація: логін → overview → створити анкету → prep → confirm → створити співбесіду → код у банері
- [x] Сценарій: бічна панель перемикає списки; prep на `vacancyId`; співбесіду можна створити лише для підтвердженої анкети
- [x] Збірка: `npm run build` проходить
- [x] README: розділення Vacancy/Interview, API, навігація, повний сценарій перевірки

### Розділення домену: Анкета vs Співбесіда

Раніше `Interview` поєднував профіль вакансії і сесію з кандидатом. Тепер це дві окремі сутності:

| Сутність | Модель | Призначення | Статуси |
|---|---|---|---|
| **Анкета** | `Vacancy` | Назва посади, prep-чат з Company Agent, `CompanyProfile` | `DRAFT` → `CONFIRMED` |
| **Співбесіда** | `Interview` | Сесія з конкретним кандидатом: `joinCode`, live room, звіт | `AWAITING_CANDIDATE`, `READY`, `LIVE`, `ENDED` |

**Зв'язок:** одна анкета → багато співбесід (`Interview.vacancyId`). Співбесіду можна створити лише для анкети зі статусом `CONFIRMED`.

**Prep-флоу (Дні 4–7)** переїхав з `interviewId` на `vacancyId`. Статус `DRAFT` більше не використовується для `Interview` — нова співбесіда одразу має статус `AWAITING_CANDIDATE`.

**Deprecated:** маршрут `/prep/:interviewId` замінено на `/vacancies/:id/prep`. Старий URL редіректить на `/vacancies`.

### HR-навігація

Після логіну HR бачить `HrLayout`: header (email, «Вийти») + бічна панель + контент.

**Бічна панель:**

| Іконка | Мітка | Маршрут | Контент |
|---|---|---|---|
| 📋 | Анкети | `/vacancies` | Таблиця анкет: назва, дата, статус, дії |
| 🎤 | Співбесіди | `/interviews` | Таблиця співбесід: назва, код, дата, статус, звіт |

**Маршрути:**

| Маршрут | Опис |
|---|---|
| `/` | Overview-картки (кількість анкет, співбесід, очікують кандидата), кнопки створення, «Останні дії» |
| `/vacancies` | Список анкет |
| `/vacancies/:id` | Перегляд профілю вакансії |
| `/vacancies/:id/prep` | Чат з Company Agent |
| `/interviews` | Список співбесід |
| `/interviews/:id` | Заглушка «Скоро з'явиться» (live room — Дні 15–19) |

**Кнопки на головній:**
- **«Створити нову анкету»** — модалка з назвою → `POST /api/vacancies` → редірект на `/vacancies/:id/prep`
- **«Створити нову співбесіду»** — dropdown підтверджених анкет → `POST /api/interviews { vacancyId }` → банер з `joinCode`

### API-ендпоінти

#### Анкети — `/api/vacancies`

| Метод | Шлях | Опис |
|---|---|---|
| `GET` | `/vacancies/mine` | Список анкет поточного HR (`createdAt desc`) |
| `POST` | `/vacancies` | Створити анкету: `{ "title": "..." }` → статус `DRAFT` |
| `GET` | `/vacancies/:id` | Анкета + профіль + стан prep-сесії |
| `PATCH` | `/vacancies/:id` | Оновити назву; якщо була `CONFIRMED` → скидає в `DRAFT` |
| `DELETE` | `/vacancies/:id` | Видалити; `409` якщо є прив'язані співбесіди |

#### Prep — `/api/prep/:vacancyId/*`

Усі ендпоінти prep тепер використовують `vacancyId` замість `interviewId`:

| Метод | Шлях | Опис |
|---|---|---|
| `GET` | `/prep/:vacancyId` | Стан prep-сесії та профіль |
| `POST` | `/prep/:vacancyId/message` | Надіслати повідомлення в чат |
| `POST` | `/prep/:vacancyId/finish` | Згенерувати профіль з історії чату |
| `POST` | `/prep/:vacancyId/confirm` | Підтвердити профіль → `Vacancy.status = CONFIRMED` |
| `DELETE` | `/prep/:vacancyId` | Скинути чат і профіль (не працює після confirm) |

#### Співбесіди — `/api/interviews`

| Метод | Шлях | Опис |
|---|---|---|
| `GET` | `/interviews/mine` | Список співбесід з `vacancyTitle`, `displayName`, `joinCode`, `reportSummary` |
| `POST` | `/interviews` | Створити співбесіду: `{ "vacancyId": "..." }` → `400` якщо анкета не підтверджена |
| `GET` | `/interviews/:id` | Деталі однієї співбесіди |

**Приклади curl:**

```bash
TOKEN="<token-from-login>"

# Створити анкету
curl -X POST http://localhost:3000/api/vacancies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Frontend Developer"}'

# Список анкет
curl "http://localhost:3000/api/vacancies/mine" \
  -H "Authorization: Bearer $TOKEN"

# Prep-чат (після створення анкети)
VACANCY_ID="<vacancyId>"
curl -X POST "http://localhost:3000/api/prep/$VACANCY_ID/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Middle Frontend Developer, React + TypeScript"}'

# Підтвердити профіль
curl -X POST "http://localhost:3000/api/prep/$VACANCY_ID/confirm" \
  -H "Authorization: Bearer $TOKEN"

# Створити співбесіду (потрібна підтверджена анкета)
curl -X POST http://localhost:3000/api/interviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"vacancyId\":\"$VACANCY_ID\"}"

# Список співбесід
curl "http://localhost:3000/api/interviews/mine" \
  -H "Authorization: Bearer $TOKEN"
```

**Seed-дані** (`npm --workspace backend run db:seed`):

```
Seeded test vacancy: id=... title=Test Position
Seeded test interview: id=... joinCode=TEST01
```

Анкета `Test Position` має статус `CONFIRMED`; співбесіда `TEST01` — `AWAITING_CANDIDATE`.

### HR Cabinet Quick Start (Day 9)

**1. Увійти:**

```bash
npm run dev
```

Відкрий [http://localhost:5173](http://localhost:5173) → логін `hr@test.com` / `123456`. Головна `/` показує overview-картки (анкети, співбесіди, очікують кандидата) і дві кнопки створення. Зліва — бічна панель «Анкети» / «Співбесіди».

**2. Статуси анкет (`VacancyStatus`):**

| Статус у БД | Мітка в UI | Опис |
|---|---|---|
| `DRAFT` | Чернетка | Prep не завершено або профіль не підтверджено |
| `CONFIRMED` | Підтверджена | Можна створювати співбесіди |

**3. Статуси співбесід (`InterviewStatus`):**

| Статус у БД | Мітка в UI |
|---|---|
| `AWAITING_CANDIDATE` | Очікує кандидата |
| `READY` | Готова |
| `LIVE` | В ефірі |
| `ENDED` | Завершена |

**4. Повний сценарій перевірки HR-частини (6 кроків):**

1. **Логін** `hr@test.com` / `123456` → на `/` видно overview-картки та бічну панель.
2. **Створити анкету** — «Створити нову анкету» → ввести назву → prep-чат на `/vacancies/:id/prep` → «Завершити чат» → «Підтвердити профіль».
3. **Створити співбесіду** — «Створити нову співбесіду» → обрати підтверджену анкету → банер з 6-символьним кодом → новий рядок у `/interviews`.
4. **Бічна панель** — перемикання `/vacancies` ↔ `/interviews` показує відповідні таблиці.
5. **Видалення анкети зі співбесідою** — спроба `DELETE /api/vacancies/:id` для анкети з прив'язаними співбесідами → `409`.
6. **Редагування підтвердженої анкети** — зміна назви через UI або `PATCH /api/vacancies/:id` → статус «Чернетка», потрібне повторне підтвердження; існуючі співбесіди не видаляються.

✅ HR-частина готова.

---

Частина 2 — Кабінет кандидата (дні 10–14)
Кандидат реєструється, заповнює анкету, приєднується за кодом.

## День 10 — Вхід для кандидата

**Задача:** кандидат може зареєструватися і зайти.

**Що робиш:**
- Сторінки реєстрації та логіну для кандидата (окремо від HR)
- Роль CANDIDATE у базі
- Після входу — кабінет кандидата (поки порожній)

**Definition of Done:**
- [ ] Демонстрація: кандидат реєструється, логіниться, бачить свій кабінет
- [ ] Сценарій: нова реєстрація створює `User` з роллю `CANDIDATE`; HR-акаунт не може зайти в кабінет кандидата і навпаки
- [ ] Збірка: `npm run build` проходить
- [x] README: тестовий акаунт кандидата, маршрути реєстрації/логіну

### Candidate Auth Quick Start (Day 10)

HR і кандидат мають окремі сторінки входу та role-aware редіректи: HR-акаунт не потрапляє в `/candidate`, кандидат — у HR-кабінет (`/`, `/vacancies`, …).

**1. Реєстрація та логін через UI:**

```bash
npm run dev
```

- HR: [http://localhost:5173/login](http://localhost:5173/login) → `hr@test.com` / `123456` (seed) → головна `/`
- Кандидат: [http://localhost:5173/candidate/register](http://localhost:5173/candidate/register) → нова реєстрація → кабінет `/candidate`
- Повторний вхід кандидата: [http://localhost:5173/candidate/login](http://localhost:5173/candidate/login)

Тестовий акаунт кандидата не в seed — створюється через реєстрацію (наприклад `candidate@test.com` / `123456`). Сесія зберігається в `localStorage` (`auth_token`), як у HR.

**2. Маршрути UI:**

| Маршрут | Опис |
|---|---|
| `/candidate/register` | Реєстрація нового кандидата |
| `/candidate/login` | Вхід кандидата |
| `/candidate` | Кабінет кандидата (поки порожній) |
| `/login` | Вхід HR (з лінком «Увійти як кандидат») |

**3. API-ендпоінти:**

| Метод | Шлях | Опис |
|---|---|---|
| `POST` | `/api/auth/hr/login` | Вхід HR (`role === "HR"`) |
| `POST` | `/api/auth/candidate/register` | Реєстрація кандидата → `201` + token |
| `POST` | `/api/auth/candidate/login` | Вхід кандидата (`role === "CANDIDATE"`) |

> `POST /api/auth/login` — тимчасовий alias для HR-логіну (зворотна сумісність).

**4. Реєстрація та логін через curl:**

```bash
curl -X POST http://localhost:3000/api/auth/candidate/register \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}'

curl -X POST http://localhost:3000/api/auth/candidate/login \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}'
```

Очікувана відповідь (register — `201`, login — `200`):

```json
{"token":"...","user":{"id":"...","email":"candidate@test.com","role":"CANDIDATE"}}
```

HR-логін:

```bash
curl -X POST http://localhost:3000/api/auth/hr/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@test.com","password":"123456"}'
```

**5. Ізоляція ролей (ручна перевірка):**

1. Увійти як HR → відкрити `/candidate/login` → редірект на `/`
2. Зареєструвати кандидата → відкрити `/vacancies` → редірект на `/candidate`
3. Без сесії відкрити `/candidate` → редірект на `/candidate/login`
4. Спроба `POST /api/auth/candidate/login` з `hr@test.com` → `403 { "error": "Candidate access only" }`

---

## День 11 — Candidate Agent (серверна частина)

**Задача:** AI-агент кандидата веде анкету в чаті.

**Що робиш:**
- Промпт: досвід, сильні/слабкі сторони, цілі
- API: повідомлення кандидата → відповідь агента
- Збереження чату в базі

**Definition of Done:**
- [x] Демонстрація: через API кандидат веде діалог з Candidate Agent (мінімум 3 обміни)
- [x] Сценарій: повідомлення зберігаються в окремій prep-сесії `CANDIDATE_PREP`; відповіді стосуються досвіду та навичок
- [x] Збірка: `npm run build` проходить
- [x] README: відмінність `CANDIDATE_PREP` від `COMPANY_PREP`, приклад API-запиту

### Terminology: COMPANY_PREP vs CANDIDATE_PREP

| Назва | Prisma-модель | Автори повідомлень |
|-------|---------------|-------------------|
| **COMPANY_PREP** | `PrepSessionHr` | `HUMAN_HR`, `AGENT_COMPANY` |
| **CANDIDATE_PREP** | `PrepSessionCandidate` | `HUMAN_CANDIDATE`, `AGENT_CANDIDATE` |

HR prep: `/api/prep/:vacancyId` (Дні 4–7). Candidate prep: `/api/candidate-prep/:interviewId`.

### Candidate Prep API

Усі endpoint-и вимагають `Authorization: Bearer <candidate-jwt>` (роль `CANDIDATE`).

| Метод | Шлях | Опис |
|-------|------|------|
| `GET` | `/candidate-prep/:interviewId` | Історія чату, `isClosed`, `profile` |
| `POST` | `/candidate-prep/:interviewId/message` | `{ "message": "..." }` → `{ "message", "readyForConfirmation" }` |
| `POST` | `/candidate-prep/:interviewId/finish` | Згенерувати профіль з історії чату |
| `POST` | `/candidate-prep/:interviewId/confirm` | Підтвердити профіль (`confirmedAt`) |
| `DELETE` | `/candidate-prep/:interviewId` | Скинути чат і непідтверджений профіль |

**Помилки:** `404` — interview не знайдено; `409` — сесія закрита або профіль підтверджено (DELETE); `403` — не CANDIDATE.

> **Тимчасово (День 11):** не перевіряється `interview.candidateUserId` — будь-який авторизований кандидат може писати за відомим `interviewId`. Ownership check — День 14.

### Candidate Prep Quick Start

**Передумова:** День 10 (candidate auth) — `POST /api/auth/candidate/register` і `POST /api/auth/candidate/login`.

```bash
# 1. Логін кандидата
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/candidate/login \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}' | jq -r .token)

# 2. interviewId з seed (joinCode=TEST01) — див. вивід npm --workspace backend run db:seed
INTERVIEW_ID="<interviewId-from-seed>"

# 3. Привітання агента (порожнє повідомлення)
curl -s -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":""}' | jq

# 4. Відповідь кандидата
curl -s -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"3 роки backend, Node.js, PostgreSQL"}' | jq

# 5. Ще один обмін + перевірка історії
curl -s "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Потрібен запущений LLM (`omlx serve` або `LLM_PROVIDER=gemini` у `backend/.env`).

---

## День 12 — Анкета кандидата в браузері

**Задача:** кандидат проходить анкету на сайті.

**Що робиш:**
- Сторінка «Мій профіль» / «Анкета»
- Чат з Candidate Agent (як у HR на дні 5)

**Definition of Done:**
- [ ] Демонстрація: кандидат проходить анкету в браузері
- [ ] Сценарій: UI працює аналогічно HR-анкеті; історія чату зберігається після перезавантаження
- [ ] Збірка: `npm run build` проходить
- [ ] README: маршрут анкети кандидата в UI

### Candidate Prep Chat UI Quick Start (Day 12)

**Передумови:** День 10 (candidate auth), День 11 (candidate prep API), запущений LLM.

**1. Підготувати demo-співбесіду:**

```bash
npm --workspace backend run db:seed
# У виводі з'явиться joinCode=TEST01 — його дає HR кандидату
```

**2. UI-маршрути:**

| Маршрут | Опис |
|---|---|
| `/candidate` | Кабінет кандидата, кнопка «Моя анкета» |
| `/candidate/prep/:interviewId` | Чат з Candidate Agent |

**3. Сценарій перевірки:**

```bash
npm run dev
```

1. Зареєструватися на `/candidate/register` (або увійти на `/candidate/login`)
2. На `/candidate` ввести код **TEST01** → «Приєднатися» → «Моя анкета» → `/candidate/prep/:interviewId`
3. Агент привітається; надіслати 2–3 відповіді про досвід
4. Перезавантажити сторінку — історія чату на місці
5. «Видалити чат» → нова розмова з привітанням
6. Увійти як HR → відкрити `/candidate/prep/:interviewId` → редірект на `/`

**4. API (для порівняння з UI):**

Див. [Candidate Prep Quick Start (Day 11)](#candidate-prep-quick-start) — ті самі endpoint-и, UI викликає їх через `fetchWithAuth`.

### Candidate Profile Quick Start (Day 13)

**Структура `CandidateProfile` JSON:**

```json
{
  "experience": ["3 роки backend у FinTech"],
  "skills": {
    "strong": ["TypeScript", "PostgreSQL"],
    "growth": ["публічні виступи"]
  },
  "goals": ["перейти на senior"],
  "summary": "Backend-розробник з 3 роками досвіду."
}
```

**Finish (після чату):**

```bash
curl -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/finish" \
  -H "Authorization: Bearer $CANDIDATE_TOKEN"
```

**Confirm:**

```bash
curl -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/confirm" \
  -H "Authorization: Bearer $CANDIDATE_TOKEN"
```

**UI-сценарій:**
1. Пройти анкету в `/candidate/prep/:interviewId` (3+ обміни).
2. Натиснути «Завершити чат» → переглянути профіль.
3. Натиснути «Підтвердити профіль» → «✓ Підтверджено {дата}».
4. Reload — профіль і `confirmedAt` на місці; «Видалити чат» disabled.

---

## День 13 — Профіль кандидата + підтвердження

**Задача:** після анкети — структурований профіль і підтвердження.

**Що робиш:**
- AI збирає JSON: досвід, навички, цілі, короткий summary
- Екран перегляду + кнопка «Підтвердити профіль»

**Definition of Done:**
- [ ] Демонстрація: кандидат бачить свій профіль і підтверджує його
- [ ] Сценарій: JSON містить `experience`, `skills`, `goals`, `summary`; після підтвердження `confirmedAt` заповнено, prep закритий
- [x] Збірка: `npm run build` проходить
- [x] README: структура `CandidateProfile` JSON

---

## День 14 — Приєднання за кодом

**Задача:** кандидат вводить код від HR і потрапляє на співбесіду.

**Що робиш:**
- Форма «Ввести код співбесіди» (модалка в кабінеті кандидата)
- Перевірка: код існує, співбесіда не зайнята іншим кандидатом
- Прив’язка кандидата до співбесіди (`Interview.candidateUserId`)
- Статус оновлюється: «Обидва готові» (`READY`) після join + confirm профілю кандидата

**Definition of Done:**
- [ ] Демонстрація: HR дав код → кандидат ввів → prep → confirm → обидва в `READY` («Обидва готові»)
- [ ] Сценарій: невалідний код → помилка; код зайнятий → помилка; валідний join → `candidateUserId` встановлено
- [ ] Збірка: `npm run build` проходить
- [ ] README: endpoint `POST /api/candidate/interview/join`, сценарій HR + кандидат до `READY`

### Candidate Join Quick Start (Day 14)

**Endpoint:** `POST /api/candidate/interview/join`  
**Auth:** Bearer token, `role: CANDIDATE`  
**Body:** `{ "joinCode": "TEST01" }`

**Потік:**

1. HR створює співбесіду з підтвердженої анкети → отримує 6-символьний код
2. Кандидат: `/candidate` → «Приєднатися до зустрічі» → вводить код
3. Кандидат проходить prep → finish → confirm
4. `Interview.status` → `READY` («Обидва готові») у HR і candidate UI

**Помилки join:**

| HTTP | error | Значення |
|------|-------|----------|
| 404 | `Invalid join code` | Невірний код |
| 409 | `Interview already taken` | Код зайнятий іншим кандидатом |
| 409 | `Interview is not joinable` | LIVE або ENDED |
| 409 | `Candidate already has active interview` | У кандидата вже є активна співбесіда |

### Запрошення кандидата (dual channel)

HR може запросити кандидата **двома незалежними каналами** — зовнішнім (код/посилання) і внутрішнім (запрошення в кабінеті). SMTP не використовується: HR копіює код, посилання або готовий текст і надсилає кандидату самостійно (месенджер, email тощо).

**Зовнішній канал (завжди доступний):**
- Після створення співбесіди HR бачить 6-символьний `joinCode` і кнопки «Скопіювати код», «Скопіювати посилання», «Скопіювати текст запрошення»
- Посилання: `/join?code=XXXXXX` (публічна сторінка; після логіну кандидат потрапляє на join-флоу)
- Текст запрошення містить назву співбесіди, код, посилання та (за наявності) запланований час

**Кабінетний канал (опційно):**
- При створенні або на сторінці `/interviews/:id` HR може вказати `candidateEmail`
- Створюється `Invitation` зі статусом `PENDING` для email кандидата (нормалізованого до lowercase)
- Кандидат з таким email після входу бачить блок «Запрошення» на `/candidate` → **Прийняти** / **Відхилити**
- Accept прив’язує кандидата до співбесіди (`candidateUserId`) так само, як join за кодом; інші PENDING-запрошення для цієї співбесіди скасовуються
- Decline переводить запрошення в `DECLINED`

**Опційний `scheduledAt`:**
- ISO-дата/час при створенні (`POST /api/interviews`) або пізніше (`PATCH /api/interviews/:id`)
- Відображається в UI HR і кандидата; входить у текст запрошення

**Ключові endpoint-и:**

| Метод | Шлях | Опис |
|-------|------|------|
| `POST` | `/api/interviews` | `{ vacancyId, candidateEmail?, scheduledAt? }` → співбесіда + опційне PENDING-запрошення |
| `PATCH` | `/api/interviews/:id/invitation` | `{ candidateEmail: string \| null }` — створити/замінити або скасувати запрошення |
| `PATCH` | `/api/interviews/:id` | `{ scheduledAt: string \| null }` — оновити запланований час |
| `GET` | `/api/candidate/invitations` | Список PENDING-запрошень для email поточного кандидата |
| `POST` | `/api/candidate/invitations/:id/accept` | Прийняти → `{ interview }` |
| `POST` | `/api/candidate/invitations/:id/decline` | Відхилити → `{ invitation }` |

> Join за кодом (`POST /api/candidate/interview/join`) працює паралельно — кандидат може приєднатися і без запрошення в кабінеті.

**Приклад створення з email і часом:**

```bash
curl -X POST http://localhost:3000/api/interviews \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vacancyId": "vac_...",
    "candidateEmail": "candidate@test.com",
    "scheduledAt": "2026-07-15T14:00:00.000Z"
  }'
```

**Ручний чекліст:**
- [ ] HR створює співбесіду без email → код і кнопки копіювання працюють; `invitation: null`
- [ ] HR створює з `candidateEmail` → у відповіді `invitation.status === "PENDING"`; на `/interviews/:id` видно email «очікує»
- [ ] HR задає `scheduledAt` → час видно в модалці створення, деталях співбесіди та тексті запрошення
- [ ] Кандидат з іншим email не бачить чуже запрошення; з відповідним email — блок «Запрошення» на `/candidate`
- [ ] Accept запрошення → кандидат прив’язаний до співбесіди; Decline → запрошення зникає зі списку
- [ ] Посилання `/join?code=TEST01` відкриває join-флоу після логіну кандидата
- [ ] `PATCH .../invitation` з `null` скасовує PENDING; з новим email — замінює попереднє

✅ Кабінет кандидата готовий.

---

Частина 3 — Спільна співбесіда (дні 15–19)
HR і кандидат в одному чаті + три AI-агенти.

## День 15 — Живий чат між людьми

**Задача:** HR і кандидат пишуть один одному в реальному часі.

**Що робиш:**
- Socket.IO: підключення до кімнати співбесіди
- Повідомлення з’являються миттєво в обох вкладках
- Збереження в базі, підпис хто написав (HR / кандидат)

**Definition of Done:**
- [x] Демонстрація: дві вкладки браузера — пишеш в одній, бачиш в іншій миттєво
- [x] Сценарій: повідомлення зберігаються в `LiveSession` / `LiveMessage` з `authorType: HUMAN_HR` або `HUMAN_CANDIDATE`; після перезавантаження історія відновлюється
- [x] Збірка: `npm run build` проходить
- [x] README: socket-події `room:join`, `room:message`, `room:messages`

### Interview Tabs Live Room Quick Start

End-to-end сценарій вкладок «Співбесіда»:

1. **HR** `/interviews` → «Створити зустріч» → анкета → код → «Далі» → кімната (banner «Очікуємо кандидата»)
2. **Кандидат** confirmed анкета → join за кодом → «Увійти в кімнату» при `READY`
3. **LIVE** — коли обидва в socket-кімнаті при `READY`; тоді Arbiter відповідає на людські msg
4. **Видалення** — 🗑 на `/interviews` з confirm (будь-який статус)

Spec: `docs/superpowers/specs/2026-07-10-interview-tabs-live-room-design.md`

### Live Chat Quick Start (Day 15)

**1. Підготувати співбесіду в статусі READY**

- HR: анкета confirmed, співбесіда створена
- Кандидат: приєднався за кодом, профіль confirmed
- Статус співбесіди: «Обидва готові» (`READY`)

**2. Відкрити дві вкладки**

| Роль | URL |
|------|-----|
| HR | `http://localhost:5173/interviews/:id/room` |
| Кандидат | `http://localhost:5173/candidate/interview` → «Увійти в кімнату» |

**3. Перевірити realtime**

- HR може зайти раніше (`AWAITING_CANDIDATE`); агенти мовчать до `LIVE`
- `LIVE` — коли обидва учасники в кімнаті при `READY`
- Повідомлення в одній вкладці → миттєво в іншій

**Socket events**

| Напрям | Подія | Payload |
|--------|-------|---------|
| client → server | `room:join` | `{ interviewId: string }` |
| client → server | `room:message` | `{ interviewId: string, content: string }` |
| server → client | `room:messages` | `{ messages: LiveMessageDto[] }` |
| server → client | `room:status` | `{ status: "AWAITING_CANDIDATE" \| "READY" \| "LIVE" \| "ENDED" }` |
| server → client | `room:error` | `{ error: string }` |

Auth: JWT у `handshake.auth.token` (той самий `auth_token` з localStorage).

Повідомлення зберігаються в `LiveSession` / `LiveMessage` з `authorType: HUMAN_HR` або `HUMAN_CANDIDATE`.

---

## День 16 — Запуск агентів після повідомлення

**Задача:** після тексту від людини система запускає чергу агентів.

**Що робиш:**
- Логіка: людина написала → почекати → викликати агентів по черзі
- Індикатор «агент думає» для UI
- Поки можна з одним тестовим агентом-заглушкою

**Definition of Done:**
- [x] Демонстрація: написав повідомлення → через кілька секунд з’являється відповідь агента-заглушки
- [x] Сценарій: індикатор «думає» з’являється під час очікування і зникає після відповіді; агент не відповідає на власні повідомлення
- [x] Збірка: `npm run build` проходить
- [x] README: опис orchestrator pipeline (людина → агент)

### Agent Orchestrator Quick Start (Day 16)

**Pipeline:** `Human message → debounce 2.5s → Arbiter stub → room:messages`

> **Примітка (Day 17):** Arbiter stub замінено на LLM Arbiter — див. [День 17 — Arbiter](#день-17--arbiter).

**1. Відкрити live-кімнату** (як у Day 15) у двох вкладках.

**2. Написати повідомлення від HR або кандидата**

- Через ~2.5 с з'являється «Arbiter думає…»
- Ще через ~1.5 с — відповідь `[Arbiter stub] …`
- Відповідь видна в обох вкладках

**3. Перевірити debounce і скасування**

- Швидко надіслати 3 повідомлення → stub відповідає один раз (на останнє)
- Під час «думає» надіслати ще одне → debounce починається заново

**Нова socket-подія**

| Напрям | Подія | Payload |
|--------|-------|---------|
| server → client | `room:agent-thinking` | `{ active: boolean; agentType?: "AGENT_ARBITER" }` |

Агентські повідомлення зберігаються в `LiveMessage` з `authorType: AGENT_ARBITER`.

---

## День 17 — Arbiter

**Задача:** третій агент керує розмовою.

**Що робиш:**
- Промпт Arbiter: стежить за темою, не дає зациклитись, пропонує рух далі
- Arbiter завжди аналізує після повідомлення людини
- Максимум одне публічне повідомлення від кожного агента за один хід

**Definition of Done:**
- [x] Демонстрація: Arbiter пише в чат осмислені коментарі (підсумки, направлення)
- [x] Сценарій: після повідомлення людини Arbiter відповідає не більше одного разу; коментарі модерують тему, а не повторюють попередні
- [x] Збірка: `npm run build` проходить
- [x] README: роль Arbiter у кімнаті, промпт-файл

### Arbiter Quick Start (Day 17)

**Pipeline:** `Human message → debounce 2.5s → LLM Arbiter → 0 або 1 AGENT_ARBITER message`

**JSON-формат відповіді LLM:**
- `{ "post": false }` — Arbiter проаналізував, але не публікує
- `{ "post": true, "message": "..." }` — один коментар у чат

**Промпт:** `backend/src/agents/prompts/arbiter-agent.uk.ts`

**Ручна перевірка:**
1. Відкрити live-кімнату (як Day 15) з підтвердженими профілями.
2. Надіслати on-topic повідомлення → Arbiter може мовчати (`post:false`).
3. Надіслати офтоп або повторити те саме кілька разів → Arbiter публікує модеруючий коментар.
4. Швидко надіслати 3 повідомлення → Arbiter відповідає один раз (debounce).

> **Примітка (Day 18):** Orchestrator розширено до ланцюжка Arbiter → Company → Candidate — див. [День 18](#день-18--company-і-candidate-agent-у-кімнаті).

---

## День 18 — Company і Candidate Agent у кімнаті

**Задача:** усі три агенти відповідають у live-чаті.

**Що робиш:**
- Company Agent — ставить питання з профілю компанії
- Candidate Agent — відповідає від імені кандидата, тільки з його профілю (без вигадок)
- Порядок: Людина → Arbiter → Company → Candidate

**Definition of Done:**
- [x] Демонстрація: повний ланцюжок агентів після кожного повідомлення людини
- [x] Сценарій: Company посилається на профіль компанії; Candidate — лише на профіль кандидата (без вигаданих фактів); порядок відповідей дотримується
- [x] Збірка: `npm run build` проходить
- [x] README: повний agent pipeline `Human → Arbiter → Company → Candidate`

### Live Agents Quick Start (Day 18)

**Pipeline:** `Human message → debounce 2.5s → Arbiter → Company → Candidate`

Кожен агент аналізує розмову і публікує **0 або 1** повідомлення за хід. Порядок фіксований; наступний агент бачить повідомлення попередніх у тому ж ході.

**JSON-формат відповіді LLM** (спільний для всіх трьох агентів):
- `{ "post": false }` — агент проаналізував, але не публікує
- `{ "post": true, "message": "..." }` — одне повідомлення у чат

**Ролі агентів у live-кімнаті:**

| Агент | `authorType` | Що робить |
|-------|--------------|-----------|
| Arbiter | `AGENT_ARBITER` | Модерує розмову, дає сигнал старту після вітання, стежить за зацикленням, може запропонувати завершення |
| Company | `AGENT_COMPANY` | Ставить одне інтерв'ю-питання з профілю компанії (після сигналу Arbiter) |
| Candidate (AI) | `AGENT_CANDIDATE` | Відповідає від імені кандидата з профілю; на питання HR теж; якщо даних немає — просить живого кандидата |

**Промпти:**
- `backend/src/agents/prompts/arbiter-agent.uk.ts`
- `backend/src/agents/prompts/company-live-agent.uk.ts`
- `backend/src/agents/prompts/candidate-live-agent.uk.ts`

**Ключові файли:**

| Файл | Відповідальність |
|------|------------------|
| `backend/src/agents/agent-post-reply.ts` | Спільний парсер JSON `{ post, message }` |
| `backend/src/agents/company-live-agent.ts` | Company Agent у live-чаті |
| `backend/src/agents/candidate-live-agent.ts` | Candidate Agent у live-чаті |
| `backend/src/socket/orchestrator.ts` | Ланцюжок агентів після debounce |

**1. Відкрити live-кімнату** (як у Day 15) у двох вкладках — HR і кандидат, з підтвердженими профілями.

**2. Вітання та старт співбесіди**

- HR і кандидат вітаються
- Через ~2.5 с з'являється «Arbiter думає…» → можливо «Компанія думає…» → «Кандидат (AI) думає…»
- Arbiter публікує сигнал старту (напр. «Давайте почнемо співбесіду»)
- Company ставить питання з профілю вакансії
- Candidate відповідає з профілю кандидата

**3. HR ставить питання напряму**

- Company може `post:false` (HR уже веде діалог)
- Candidate відповідає на питання HR, якщо відповідь є в профілі

**4. Питання поза профілем кандидата**

- Candidate просить живого кандидата відповісти самому (природна мова, без окремого типу повідомлення)

**5. Перевірити debounce**

- Швидко надіслати 3 повідомлення → ланцюжок спрацьовує один раз (на останнє)

**Індикатор «думає»** (`room:agent-thinking`):

| Напрям | Подія | Payload |
|--------|-------|---------|
| server → client | `room:agent-thinking` | `{ active: boolean; agentType?: "AGENT_ARBITER" \| "AGENT_COMPANY" \| "AGENT_CANDIDATE" }` |

Агентські повідомлення зберігаються в `LiveMessage` з `authorType`: `AGENT_ARBITER`, `AGENT_COMPANY`, `AGENT_CANDIDATE`.

---

## День 19 — Інтерфейс співбесіди

**Задача:** зручна кімната для обох сторін.

**Що робиш:**
- Кнопки «Увійти в співбесіду» у HR і кандидата (коли статус `READY`/`LIVE`)
- Різні кольори/мітки: HR, кандидат, кожен агент
- Кнопка HR «Завершити співбесіду» (лише при `LIVE`)

**Definition of Done:**
- [x] Демонстрація: повноцінна live-співбесіда з UI — обидві сторони бачать кімнату з кольоровими мітками
- [x] Сценарій: вхід доступний лише при статусі `READY`/`LIVE`; кнопка «Завершити» видна тільки HR; повідомлення різних учасників візуально відрізняються
- [x] Збірка: `npm run build` проходить
- [x] README: UI кімнати співбесіди, хто може завершити сесію

### Interview Room Quick Start (Day 19+20)

**1. Увійти в кімнату**

| Роль | Маршрут | Кнопка | Коли видна |
|------|---------|--------|------------|
| HR | `/interviews` | «Увійти в співбесіду» | `READY` або `LIVE` |
| HR | `/interviews` | клік по назві співбесіди | будь-який статус (ранній доступ) |
| Кандидат | `/candidate/interview` | «Увійти в співбесіду» | `READY` або `LIVE` |

Після натискання — live-чат з кольоровими мітками учасників і агентів (як у Day 15–18).

**2. Кольори учасників**

| `authorType` | Мітка | Колір (accent) |
|--------------|-------|----------------|
| `HUMAN_HR` | HR | блакитний (`#dbeafe`) |
| `HUMAN_CANDIDATE` | Кандидат | зелений (`#d1fae5`) |
| `AGENT_ARBITER` | Arbiter | фіолетовий (`#ede9fe`) |
| `AGENT_COMPANY` | Компанія | помаранчевий (`#ffedd5`) |
| `AGENT_CANDIDATE` | Кандидат (AI) | рожевий (`#fce7f3`) |

Власні повідомлення людини — accent-колір; чужі людські — нейтральний сірий. Агенти завжди з accent-кольором.

**3. Завершити співбесіду (HR, лише `LIVE`)**

- Кнопка «Завершити співбесіду» у верхній панелі кімнати
- Підтвердження → `POST /api/interviews/:id/end`
- Статус → `ENDED`, чат read-only для обох; socket `room:status` → `{ status: "ENDED" }`
- Успіх: banner з рекомендацією; у таблиці `/interviews` колонка «Звіт» показує `recommendation`

**4. Перегляд звіту в UI**

> Сторінка `/report/:id` — **День 21**. Зараз звіт зберігається в БД; HR бачить рекомендацію в списку співбесід.

**Ключові файли:**

| Файл | Відповідальність |
|------|------------------|
| `frontend/src/utils/live-message-styles.ts` | Кольори та мітки 5 типів учасників |
| `frontend/src/components/LiveChatPanel.vue` | Live-чат з кольоровими бульбашками |
| `frontend/src/components/InterviewRoomContent.vue` | Кнопка «Завершити», banner після end |
| `frontend/src/views/InterviewListView.vue` | HR: «Увійти в співбесіду» при `READY`/`LIVE` |
| `frontend/src/views/CandidateInterviewView.vue` | Кандидат: «Увійти в співбесіду» |
| `frontend/src/api/interviews.ts` | `endInterview()` |
| `backend/src/agents/final-report-agent.ts` | AI-звіт: prompt, парсинг JSON |
| `backend/src/routes/interviews.ts` | `POST /interviews/:id/end` |

✅ Спільна частина готова.

---

Частина 4 — Звіт і запуск (дні 20–22)

## День 20 — Фінальний звіт

**Задача:** після завершення HR отримує звіт.

**Що робиш:**
- AI аналізує весь чат + обидва профілі
- Генерує markdown-звіт: match-score, ризики, рекомендація (`HIRE` / `MAYBE` / `REJECT`)
- Зберігає в базі

> **Примітка:** backend завершення і генерація звіту реалізовані разом із Day 19 — див. [Interview Room Quick Start (Day 19+20)](#interview-room-quick-start-day-1920).

**Definition of Done:**
- [x] Демонстрація: HR натиснув «Завершити» → звіт згенеровано і збережено в `FinalReport`
- [x] Сценарій: звіт містить match-score, ризики та рекомендацію; статус співбесіди → `ENDED`; повторне завершення неможливе
- [x] Збірка: `npm run build` проходить
- [x] README: endpoint `POST /interviews/:id/end`, структура звіту

### Final Report API (Day 20)

**Endpoint:** `POST /api/interviews/:id/end`

| Умова | Значення |
|-------|----------|
| Auth | HR (JWT), лише власник співбесіди |
| Статус | `LIVE` → `ENDED` |
| LLM | Аналіз transcript + профілі компанії та кандидата |

**Успіх (201):**

```json
{
  "report": {
    "id": "...",
    "recommendation": "HIRE",
    "matchScore": 78
  }
}
```

**Помилки:**

| HTTP | error | Значення |
|------|-------|----------|
| 403 | `Forbidden` | Не HR або не власник |
| 404 | `Interview not found` | Невірний id |
| 409 | `Interview is not live` | Статус не `LIVE` |
| 409 | `Interview already ended` | Звіт уже існує |
| 409 | `Profiles not ready` | Немає confirmed профілів |
| 502/503 | `LLM unavailable` | LLM не відповів або невалідний JSON |

**Модель `FinalReport`:**

| Поле | Тип | Опис |
|------|-----|------|
| `reportMarkdown` | `string` | Повний markdown-звіт |
| `recommendation` | `HIRE` \| `MAYBE` \| `REJECT` | Рекомендація HR |
| `matchScore` | `int` (0–100) | Оцінка відповідності |
| `strengths` | `string[]` (JSON) | Сильні сторони кандидата |
| `risks` | `string[]` (JSON) | Ризики / застереження |

> Перегляд звіту в браузері (`/report/:id`) — **День 21**.

---

## День 21 — Сторінка звіту + хмарна модель

**Задача:** звіт у браузері + можливість хмарної моделі.

**Що робиш:**
- Сторінка `/report/:id` — структурований перегляд звіту (match-score, рекомендація, strengths/risks, markdown)
- Посилання на звіт зі списку співбесід, live-кімнати та деталей співбесіди
- Перемикач у `.env`: `omlx` (локально) або `gemini` (хмара)

**Definition of Done:**
- [ ] Демонстрація: звіт читається в UI за `/report/:id`
- [ ] Сценарій: посилання на звіт працює зі списку, кімнати (після завершення) і `/interviews/:id`
- [ ] `LLM_PROVIDER=gemini` + `GEMINI_API_KEY` — `npm run llm:test --workspace backend` відповідає
- [ ] Збірка: `npm run build` проходить
- [ ] README: змінні `GEMINI_*`, як перемкнути провайдера

### Report API (Day 21)

**Endpoint:** `GET /api/reports/:id`

| Умова | Значення |
|-------|----------|
| Auth | HR (JWT), лише власник співбесіди |
| `:id` | `FinalReport.id` |

**Успіх (200):** повний звіт (`reportMarkdown`, `recommendation`, `matchScore`, `strengths`, `risks`).

**Помилки:** 403 (не власник), 404 (звіт не знайдено).

### Перемикання LLM-провайдера

```env
# Локально (за замовчуванням)
LLM_PROVIDER=omlx

# Хмара (Google Gemini)
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.0-flash
```

Після зміни `.env` — рестарт backend. Тест: `npm run llm:test --workspace backend`.

---

## День 22 — Docker і фінальна перевірка

**Задача:** будь-хто може запустити проєкт однією командою.

**Що робиш:**
- docker-compose.yml: postgres + backend + frontend
- README: як встановити, запустити, тестові акаунти
- Повний прогін: HR → кандидат → співбесіда → звіт
- Виправлення багів, знайдених при прогоні

**Definition of Done:**
- [ ] Демонстрація: `docker compose up --build` піднімає postgres + backend + frontend; весь сценарій проходить
- [ ] Сценарій: повний E2E-прогін — HR логін → анкета → підтвердження → код → кандидат реєстрація → анкета → join → співбесіда → завершення → звіт у UI
- [ ] Збірка: `docker compose up --build` завершується без помилок збірки
- [ ] README: швидкий старт (Docker), тестові акаунти, повний сценарій перевірки MVP, відомі обмеження

✅ MVP готовий.

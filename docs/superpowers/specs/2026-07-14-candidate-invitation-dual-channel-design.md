# Запрошення кандидата (зовнішній канал + кабінет) — Design Spec

**Дата:** 2026-07-14  
**Статус:** Затверджено в brainstorming  
**Контекст:** HR має запрошувати кандидата двома шляхами одразу — готовим текстом/лінком для Telegram/email і запрошенням у кабінет за email  
**Передумови:** Day 8–9 (створення співбесіди + `joinCode`), Day 10 (candidate auth), Day 14 (join-by-code + `interview-readiness`), candidate dashboard (`CandidateHome`, `JoinInterviewModal`)  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- `Interview` з унікальним 6-символьним `joinCode`, статус `AWAITING_CANDIDATE` після створення
- HR UI: `CreateInterviewModal` показує лише код
- Candidate: ручний ввід коду через `JoinInterviewModal` → `POST /api/candidate/interview/join`
- Правила join / `READY` у `interview-readiness.ts` (підтверджена анкета кандидата, confirmed vacancy/company profile тощо)

**Що відсутнє:**

- Зручні дії «скопіювати код / посилання / текст запрошення» для зовнішніх каналів
- Deep link `/join?code=XXXXXX` з логіном і авто-join
- Модель `Invitation` і показ у `CandidateHome` (Прийняти / Відхилити)
- Опційний `scheduledAt` на співбесіді

**Мета:** після створення (і на деталях) HR одразу має зовнішній і кабінетний канали; кандидат бачить pending у кабінеті або проходить за лінком/кодом; без SMTP з сервера.

**Поза scope:**

- Реальна SMTP-розсилка з backend
- Зміни AI-агентів, live room logic, `FinalReport` / звіти
- Кілька одночасних pending invitations на одну співбесіду
- Multi-candidate на одне `Interview`

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Email при створенні | **A** — опційний; можна додати одразу або пізніше |
| Кількість pending | **A** — максимум одне PENDING на інтерв’ю; заміна = скасувати старе |
| Join за кодом при pending | **A** — авто-скасувати invitation → `CANCELLED` |
| Де керувати email | **B** — модалка створення + сторінка деталей співбесіди |
| `/join?code=` | **A** — публічний маршрут; логін/реєстрація з returnUrl → авто-join |
| Відхилити | **A** — `DECLINED`; зустріч лишається joinable; HR може замінити email |
| Архітектура | **1** — окрема модель `Invitation` + опційний `Interview.scheduledAt` |

---

## Підходи (розглянуті)

### 1. Окрема модель `Invitation` (обрано)

Таблиця запрошень з lifecycle `PENDING | ACCEPTED | DECLINED | CANCELLED`; Accept викликає ті самі правила, що join.

**Плюси:** чіткий pending для ще не зареєстрованих; чисті статуси; відповідає мові вимог.  
**Мінуси:** +1 модель і міграція.

### 2. Поля на `Interview` (`inviteEmail` + `inviteStatus`) (відхилено)

**Плюси:** менше схеми.  
**Мінуси:** змішує сесію й запрошення; історія decline/replace — лише перезаписом.

### 3. `Invitation` + audit log (відхилено)

**Плюси:** повна історія подій.  
**Мінуси:** зайве для MVP.

---

## Модель даних

### `Interview` (зміна)

```prisma
scheduledAt DateTime?  // опційно; показувати в запрошенні й кабінеті
```

Існуючі поля (`joinCode`, `candidateUserId`, `status`, …) без змін семантики.

### `Invitation` (нова)

```prisma
enum InvitationStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
}

model Invitation {
  id          String           @id @default(cuid())
  interviewId String
  email       String           // normalized: trim + lowercase
  status      InvitationStatus @default(PENDING)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  interview   Interview        @relation(fields: [interviewId], references: [id], onDelete: Cascade)

  @@index([email, status])
  @@index([interviewId, status])
}
```

**Інваріант «одне PENDING»:** у транзакції перед створенням нового PENDING для `interviewId` усі існуючі PENDING цього інтерв’ю → `CANCELLED`. Partial unique index у PostgreSQL в MVP не вимагаємо (покриваємо тестами + транзакцією).

**Прив’язка до user:** запрошення завжди за `email`. Список для кандидата: `Invitation` зі `status = PENDING` і `email === currentUser.email` (role `CANDIDATE`). Якщо User ще не існує — рядок усе одно існує; з’явиться в кабінеті після реєстрації/логіну з цим email.

---

## Backend

### Розширити `POST /api/interviews` (HR)

**Body:**

```json
{
  "vacancyId": "...",
  "candidateEmail": "anna@mail.com",
  "scheduledAt": "2026-07-15T14:00:00.000Z"
}
```

- `candidateEmail`, `scheduledAt` — опційні.
- Якщо `candidateEmail` передано: валідація формату; якщо `User` з цим email існує і `role !== CANDIDATE` → `400`.
- Створити `Interview` (як зараз) + за наявності email — `Invitation` `PENDING`.
- Response: наявні поля interview + `scheduledAt` + `invitation: { id, email, status } | null`.

### `PATCH /api/interviews/:id/invitation` (HR)

**Body:** `{ "candidateEmail": "x@y.com" }` або `{ "candidateEmail": null }` (скасувати pending).

Правила:

- Лише власник `hrUserId`.
- Якщо вже є `candidateUserId` або status ∈ `{ LIVE, ENDED }` → `409`.
- Новий email: скасувати поточне PENDING → створити нове PENDING.
- `null`: усі PENDING цього interview → `CANCELLED`.
- Та сама валідація email / role, що на create.

### `PATCH /api/interviews/:id` (HR)

Новий endpoint (зараз PATCH для interviews немає).

**Body:** `{ "scheduledAt": "<ISO>" | null }` — єдине дозволене поле в MVP.

- Лише власник HR.
- Дозволено змінювати лише коли `status ∈ { AWAITING_CANDIDATE, READY }`; інакше `409`.
- Response: оновлений interview з `scheduledAt`.

### Розширити list/detail interview (HR)

`GET /api/interviews/mine`, `GET /api/interviews/:id` — додати:

- `scheduledAt: string | null`
- `invitation: { id, email, status } | null` — лише поточне **PENDING**; після decline/cancel/accept поле `null`. HR знову вводить email через `PATCH .../invitation`.

### `GET /api/candidate/invitations` (CANDIDATE)

Повертає PENDING invitations, де `email` = email поточного user:

```json
{
  "invitations": [
    {
      "id": "...",
      "interviewId": "...",
      "displayName": "Backend Engineer",
      "scheduledAt": "2026-07-15T14:00:00.000Z",
      "status": "PENDING"
    }
  ]
}
```

### `POST /api/candidate/invitations/:id/accept` (CANDIDATE)

1. Знайти invitation; має бути `PENDING` і `email === req.user.email` → інакше `404`.
2. Завантажити interview; викликати `canCandidateJoinInterview` (ті самі правила, що join).
3. У транзакції: `candidateUserId = user.id`, invitation → `ACCEPTED`, інші PENDING цього interview → `CANCELLED` (на випадок гонок).
4. `maybeTransitionToReady`.
5. Response у форматі як успішний join (interview summary для кандидата).

### `POST /api/candidate/invitations/:id/decline` (CANDIDATE)

- Лише своє PENDING → `DECLINED`.
- Interview не змінюється; зовнішній код/лінк далі працюють.

### `POST /api/candidate/interview/join` (існуючий)

Після успішного bind кандидата: усі PENDING invitations цього `interviewId` → `CANCELLED`.

### Без SMTP

Жоден endpoint не надсилає лист. Готовий текст формується **на frontend** з `displayName`, `joinCode`, origin + `/join?code=`, опційний `scheduledAt`.

---

## Frontend

### HR — `CreateInterviewModal`

1. Форма: вибір vacancy + опційні поля email і `scheduledAt` (datetime-local).
2. Після create — крок «Запрошення»:
   - показ коду (як зараз);
   - кнопки: **Скопіювати код**, **Скопіювати посилання**, **Скопіювати текст запрошення**;
   - якщо є invitation — рядок «Запрошення: email · очікує»;
   - scheduledAt (якщо є) у підказці / у тексті.
3. Закрити / Далі — без змін навігації в кімнату.

Шаблон тексту (приклад):

```text
Вас запрошено на співбесіду «{displayName}».
Код: {joinCode}
Посилання: {origin}/join?code={joinCode}
Час: {scheduledAt formatted UK}   // рядок лише якщо scheduledAt є
```

### HR — `InterviewDetailView`

- Ті самі 3 copy-кнопки для код/лінк/текст.
- Блок invitation: показати pending email або форму «Додати / замінити email» (`PATCH .../invitation`), поки немає `candidateUserId` і status дозволяє invite.
- Редагування `scheduledAt` (`PATCH /api/interviews/:id`).
- Список співбесід (`InterviewListView`) у MVP не обов’язково змінювати; достатньо details + create modal.

### Candidate — `CandidateHomeView`

- Секція **Запрошення**: список з `GET /candidate/invitations`.
- Картка: `displayName`, `scheduledAt` (якщо є), **Прийняти** / **Відхилити**.
- **Прийняти:** ті самі UX-умови, що join (підтверджена анкета); інакше disabled або помилка з API.
- Ручний ввід коду (`JoinInterviewModal`) лишається.

### `/join` (новий публічний маршрут)

- Query: `code` (обов’язковий для успішного join).
- Немає auth:
  - зберегти returnUrl `/join?code=...`;
  - редірект на `/candidate/login` (з лінком на реєстрацію).
- Auth як CANDIDATE: виклик `joinInterviewByCode`; успіх → `candidate-home` (банер); помилка → показ повідомлення + опція ручного коду.
- Auth як HR: повідомлення українською «Увійдіть як кандидат» + лінк на candidate login (сесію HR не ламати без потреби — достатньо тексту/лінка).

### API clients

- Оновити `frontend/src/api/interviews.ts` (create body, types, patch invitation/schedule).
- Новий або розширений `candidate-invitations.ts` (list/accept/decline).
- Хелпер `buildInviteLink(joinCode)` / `buildInviteMessage(...)`.

UI українською; візуально — існуючі Calm Slate / Teal токени.

---

## Потік даних (коротко)

```text
HR create (±email, ±scheduledAt)
  → Interview AWAITING_CANDIDATE (+ Invitation PENDING?)
  → UI copy code/link/text  |  CandidateHome бачить invitation (якщо user є)

Зовнішній: /join?code → login → join → CANCELLED pending invitation
Кабінет: Accept → join-логіка → ACCEPTED
Кабінет: Decline → DECLINED (зустріч жива)
HR replace email → старе PENDING CANCELLED → нове PENDING
```

---

## Помилки

| Ситуація | Поведінка |
|----------|-----------|
| Невірний email | `400` |
| Email = User з role ≠ CANDIDATE | `400` |
| Invite коли вже є кандидат / LIVE\|ENDED | `409` |
| Accept чужого / не PENDING | `404` |
| Accept: правила join | ті самі `409`/`400`, що join |
| Clipboard fail | toast «Не вдалося скопіювати» |
| `/join` під HR-сесією | UI: увійдіть як кандидат |

Повідомлення API в JSON — англійською в полі `error` (як join зараз). Frontend показує українські тексти там, де вже є локальні лейбли (тоасти, заголовки); для join/accept 409 — ті самі рядки, що вже мапить `candidate-interview.ts`.

---

## Тестування

### Backend (обов’язково)

- create без email → invitation null; з email → PENDING
- create + scheduledAt
- PATCH invitation (create/replace/null cancel)
- PATCH scheduledAt
- GET candidate invitations (match by email; ignore інших)
- accept → candidate bound + ACCEPTED + ready rules
- decline → DECLINED; join за кодом далі ок
- join за кодом → PENDING → CANCELLED
- pending для неіснуючого email → після register/login list непустий
- email з role HR → 400 на invite

### Frontend

- Unit на `buildInviteMessage` / link helper (якщо зручно додати в існуючий test runner frontend).
- Інакше: короткий ручний чеклист у README.

### README

Короткий розділ: два канали, `/join?code=`, Invitation pending, без SMTP, приклад copy-тексту, як HR вказує email і scheduledAt.

### Перевірка готовності

`npm` build (frontend + backend за скриптами репо) і `backend` test script мають пройти.

---

## Поза scope (повторення)

- SMTP / черги листів
- AI-агенти, оркестратор, звіт
- Кілька PENDING одночасно
- Нотифікації push / in-app поза списком на CandidateHome

# HR рішення після звіту + діалоги HR↔кандидат — Design Spec

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming  
**Контекст:** Після перегляду `FinalReport` HR має зафіксувати рішення (прийняти / відхилити / додаткова зустріч), надіслати індивідуальний лист у кабінет кандидата і далі спілкуватись у звичайному чаті без LLM.  
**Передумови:** Сторінка звіту (`GET /api/reports/:id`, `ReportView`), наявний кандидат на співбесіді, auth HR/Candidate.  
**Мова:** Українська (UI, листи, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- Генерацію та перегляд AI-звіту (`FinalReport`, recommendation `HIRE|MAYBE|REJECT`)
- Планування співбесід через `Interview.scheduledAt` і створення інтерв’ю з заявок
- In-app `HrNotification` для заявок на вакансії
- Prep/live чати з агентами (не людський post-interview чат)

**Що відсутнє:**

- Фінальне HR-рішення після звіту
- LLM-листи accept/reject/additional meeting з редагуванням перед відправкою
- Людський діалог HR↔кандидат поза live-кімнатою
- Вкладка «Діалоги» в обох кабінетах

**Мета:** HR після звіту може прийняти рішення, відредагувати й надіслати лист у діалог з кандидатом; обидві сторони мають список діалогів і можуть продовжити листування без LLM.

**Поза scope:**

- Email / push-сповіщення
- Socket.IO realtime для діалогів
- Автостворення follow-up `Interview` при «Додаткова зустріч»
- Окрема система candidate notifications (unread badge у списку — не в MVP цього spec)
- Доступ кандидата до самого AI-звіту
- PDF / експорт листів

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Робота з листом | **A** — LLM-чернетка → HR редагує → окреме «Надіслати» |
| Додаткова зустріч | **C** — лише діалог/лист; нову співбесіду HR планує пізніше вручну |
| Перше повідомлення про додаткову зустріч | **A** — LLM-чернетка (як accept/reject) |
| Зміна рішення | **C** — можна будь-коли; новий лист у тому ж діалозі |
| Групування діалогів | Один діалог = пара **HR ↔ кандидат** |
| Створення діалогу | **B** — вручну з кабінету HR або через надіслане рішення зі звіту |
| Архітектура | **Підхід 1** — Decision + Dialog поверх REST, без Socket.IO і email |

---

## Підходи (розглянуті)

### 1. Decision + Dialog (REST) — обрано

Моделі `Dialog`, `DialogMessage`, `InterviewDecision`; draft/send на reports API; вкладка діалогів у обох кабінетах.

**Плюси:** відповідає існуючим патернам; простіше тестувати; достатньо для MVP.  
**Мінуси:** нові повідомлення видно після перезавантаження/повторного fetch.

### 2. Те саме + Socket.IO — відхилено

**Плюси:** live-оновлення стрічки.  
**Мінуси:** зайва складність для рідкого листування.

### 3. Decision + Dialog + inbox-сповіщення — відхилено (на потім)

**Плюси:** badge/unread як у заявок.  
**Мінуси:** ширший scope; можна додати окремим кроком.

---

## Моделі даних

### `Dialog`

| Поле | Тип | Примітки |
|------|-----|----------|
| `id` | string (cuid) | PK |
| `hrUserId` | string | FK → User |
| `candidateUserId` | string | FK → User |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | оновлюється при новому повідомленні |

Унікальний індекс: `(hrUserId, candidateUserId)` — рівно один діалог на пару.

### `DialogMessage`

| Поле | Тип | Примітки |
|------|-----|----------|
| `id` | string | PK |
| `dialogId` | string | FK → Dialog |
| `senderUserId` | string | FK → User |
| `body` | string | текст повідомлення / листа |
| `kind` | enum | `USER` \| `DECISION_LETTER` |
| `decisionId` | string? | FK → InterviewDecision, лише для `DECISION_LETTER` |
| `createdAt` | DateTime | |

### `InterviewDecision`

| Поле | Тип | Примітки |
|------|-----|----------|
| `id` | string | PK |
| `interviewId` | string | FK → Interview |
| `finalReportId` | string | FK → FinalReport (звіт, з якого прийнято рішення) |
| `decidedByUserId` | string | FK → User (HR) |
| `type` | enum | `ACCEPT` \| `REJECT` \| `ADDITIONAL_MEETING` |
| `letterBody` | string | фінальний текст після редагування HR |
| `dialogMessageId` | string? | FK → DialogMessage після send |
| `createdAt` | DateTime | |

Поточне рішення по співбесіді = **останній** `InterviewDecision` за `interviewId` + `createdAt desc`. Окремого `currentDecision` на `Interview` немає (уникаємо розсинхрону). Історія зберігається повністю — зміна рішення = новий рядок.

Зв’язок: для draft/decision обов’язковий `Interview.candidateUserId` (не лише email у `CandidateProfile`). Якщо `null` → `400`.

---

## API

### Рішення зі звіту (HR only, власник вакансії/звіту)

#### `POST /api/reports/:id/decisions/draft`

Body:

```json
{ "type": "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING" }
```

Поведінка:

1. Завантажити звіт + interview + vacancy + профілі
2. Викликати LLM agent з типом рішення та контекстом
3. Повернути чернетку (без запису рішення в БД)

Response `200`:

```json
{ "type": "ACCEPT", "body": "…" }
```

Чернетка **не** обов’язково персиститься на сервері: клієнт тримає текст у модалці до send. (Якщо потрібен retry UX — достатньо повторного виклику draft.)

#### `POST /api/reports/:id/decisions`

Body:

```json
{
  "type": "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING",
  "letterBody": "…"
}
```

Поведінка (транзакція):

1. Валідація: непустий `letterBody`, є candidate user
2. Створити `InterviewDecision`
3. Find-or-create `Dialog(hrUserId, candidateUserId)`
4. Створити `DialogMessage` з `kind=DECISION_LETTER`, прив’язати `decisionId`
5. Оновити `Dialog.updatedAt`
6. Проставити `InterviewDecision.dialogMessageId`

Response `201`:

```json
{
  "decision": { "id": "…", "type": "ACCEPT", "createdAt": "…" },
  "dialogId": "…"
}
```

Повторні виклики дозволені (нова зміна рішення).

### Діалоги

#### `GET /api/dialogs`

Auth: HR або Candidate. Повертає діалоги, де юзер — учасник.

Кожен елемент: `id`, співрозмовник (`id`, `email`/`name` якщо є), `lastMessage` preview, `updatedAt`.

#### `POST /api/dialogs`

Auth: **лише HR**.

Body:

```json
{ "candidateUserId": "…" }
```

Find-or-create за парою: якщо діалог уже є → `200` з існуючим; якщо створено → `201`. UI «Новий діалог» ідемпотентний.

Обмеження: кандидат має бути пов’язаний із хоча б однією співбесідою/заявкою цього HR (анти-спам по всій базі User).

#### `GET /api/dialogs/:id`

Мета діалогу + список повідомлень (хронологічно). Лише учасники.

#### `POST /api/dialogs/:id/messages`

Body:

```json
{ "body": "…" }
```

Створює `DialogMessage` з `kind=USER`. Обидві сторони можуть писати. LLM не викликається.

### Права доступу

| Endpoint | HR | Candidate |
|----------|----|-----------|
| draft / decisions | власник звіту | ні |
| list/get/post messages dialogs | учасник | учасник |
| `POST /api/dialogs` | так | ні |

Чужий ресурс → `404` (без витоку існування) або `403` за існуючим стилем проєкту.

---

## LLM

Окремий agent + український prompt, наприклад `decision-letter-agent`.

Вхід:

- `type`: ACCEPT | REJECT | ADDITIONAL_MEETING
- `reportMarkdown` / strengths / risks / recommendation / matchScore
- назва вакансії, короткі company/candidate профілі

Вихід: текст листа українською, без markdown-огорож, готовий до редагування в textarea.

Для `ADDITIONAL_MEETING`: пояснити потребу в уточненнях; **не** вигадувати конкретну дату/час; запропонувати узгодити деталі в діалозі / через окреме планування в системі.

Після send LLM у діалозі **не** бере участі.

---

## UI

### `ReportView`

- Блок «Рішення» з трьома кнопками
- Показ поточного (останнього) рішення, якщо є; кнопки лишаються активними
- Модалка: стан loading → textarea з чернеткою → «Надіслати» / «Скасувати»
- Після успішного send: підтвердження + лінк на `/dialogs/:id`

### Вкладка «Діалоги»

Маршрути: `/dialogs`, `/dialogs/:id` (окремо під HR і Candidate layouts / guards як інші кабінетні сторінки).

- Список: ім’я/email співрозмовника, прев’ю, час
- HR: «Новий діалог» — вибір кандидата зі своїх співбесід/заявок
- Стрічка: вирівнювання за sender; для `DECISION_LETTER` — мітка типу (Прийнято / Відхилено / Додаткова зустріч)
- Композер: звичайний текст, без LLM

### Навігація

- HR sidebar: … → Звіти → **Діалоги**
- Candidate sidebar: … → **Діалоги**

Стилі — у рамках існуючого кабінету (як reports / applications).

---

## Потоки (коротко)

```text
HR відкриває /report/:id
  → обирає тип рішення
  → POST .../decisions/draft (LLM)
  → редагує текст
  → POST .../decisions
       → InterviewDecision + Dialog + DialogMessage
  → опційно відкриває /dialogs/:id

HR або Candidate
  → /dialogs → обирає тред
  → POST .../messages (людський чат)

«Додаткова зустріч»
  → лише лист у діалог
  → нову співбесіду HR створює існуючим flow (Create Interview) окремо
```

---

## Помилки

| Ситуація | Поведінка |
|----------|-----------|
| Немає candidate user на співбесіді | `400` на draft/decision |
| Порожній `letterBody` | `400` |
| Чужий звіт/діалог | `403`/`404` |
| LLM недоступний на draft | `502` + повідомлення в модалці; рішення не створюється |
| Порожнє USER-повідомлення | `400` |

---

## Тестування

**Backend**

- draft: mock LLM → повертає body; 400 без кандидата; authz
- create decision: створює decision + dialog + DECISION_LETTER; повторний decision додає другий запис і ще одне повідомлення в той самий dialog
- dialogs: list лише свої; create find-or-create; post message обома сторонами; чужий dialog недоступний

**Frontend (smoke)**

- модалка рішення на ReportView
- список і стрічка діалогів у HR і Candidate

---

## Критерії готовності

1. Зі сторінки звіту HR може згенерувати, відредагувати й надіслати лист для кожного з трьох типів рішень.
2. Надісланий лист з’являється в діалозі HR↔кандидат; обидві сторони бачать вкладку «Діалоги» і можуть писати далі без LLM.
3. Повторне рішення створює новий запис історії й новий лист у тому ж діалозі.
4. «Додаткова зустріч» не створює автоматично нову співбесіду.
5. Немає email/Socket.IO в рамках цієї фічі.
6. Backend-тести на happy path і authz зелені.
`)
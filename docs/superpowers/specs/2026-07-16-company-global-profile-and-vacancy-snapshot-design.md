# Глобальний профіль компанії та snapshot у вакансіях — Design Spec

**Дата:** 2026-07-16
**Статус:** Затверджено в brainstorming
**Контекст:** Розділення HR-анкети на універсальні (компанія) та вакансійні питання
**Мова:** Українська (промпт, UI, повідомлення про помилки)

---

## Контекст і мета

Зараз Company Agent збирає всі 4 теми (`role`, `requirements`, `culture`, `expectations`) окремо для кожної вакансії. Частина відповідей (культура, напрям, політики, формат роботи, онбординг) однакова для всіх вакансій одного HR і повторюється без потреби.

**Мета:** винести універсальні питання в окремий чат «Профіль компанії» (1 на HR-користувача). HR заповнює його один раз, підтверджує. При формуванні профілю вакансії універсальні поля копіюються (snapshot) і разом з вакансійними полями показуються на екрані підтвердження — усі редаговані до `confirmedAt`.

---

## Рішення з brainstorming

| Питання | Рішення |
|---|---|
| Scope профілю компанії | 1 профіль на HR-користувача |
| Поділ полів | **B (розширений):** універсальні — `culture`, `companyDirection`, `policies`, `workFormat`, `onboardingApproach`; вакансійні — `role`, `requirements`, `expectations` |
| Поведінка при зміні глобального профілю | **A (snapshot):** існуючі вакансії не змінюються; нові отримують актуальні значення на момент `finish` |
| Gate перед анкетою вакансії | **A (жорсткий):** без підтвердженого глобального профілю вакансійний prep недоступний |
| Редагування перед підтвердженням вакансії | **A:** усі поля (універсальні + вакансійні) редагуються локально в межах вакансії |
| Підхід реалізації | **Підхід 1:** два незалежні контури (company-prep + vacancy prep) |

---

## Архітектура і модель даних

### Нова сутність: `HrCompanyProfile`

1:1 до `User` (HR). Зберігає підтверджений глобальний профіль компанії.

| Поле | Тип | Опис |
|---|---|---|
| `id` | `String @id` | cuid |
| `hrUserId` | `String @unique` | FK → `User.id` |
| `culture` | `Json` | масив рядків |
| `companyDirection` | `Json` | масив рядків (напрям/місія компанії) |
| `policies` | `Json` | масив рядків (політики, правила) |
| `workFormat` | `Json` | масив рядків (офіс/remote/гібрид, години тощо) |
| `onboardingApproach` | `Json` | масив рядків (підхід до онбордингу) |
| `confirmedAt` | `DateTime?` | null до підтвердження |
| `createdAt` / `updatedAt` | `DateTime` | стандартні |

### Нові сутності для чату глобального профілю

**`PrepSessionCompany`** — 1:1 до `hrUserId`:

- `id`, `hrUserId @unique`, `isClosed`, `createdAt`, `updatedAt`

**`PrepMessageCompany`** — повідомлення сесії:

- `id`, `sessionId`, `authorType` (`HUMAN_HR` | `AGENT_COMPANY`), `content`, `createdAt`
- індекс `(sessionId, createdAt)`

### Розширення `CompanyProfile` (вакансія)

Додати snapshot-поля (nullable для backward compatibility):

| Нове поле | Тип | Джерело snapshot |
|---|---|---|
| `companyDirection` | `Json?` | `HrCompanyProfile.companyDirection` |
| `policies` | `Json?` | `HrCompanyProfile.policies` |
| `workFormat` | `Json?` | `HrCompanyProfile.workFormat` |
| `onboardingApproach` | `Json?` | `HrCompanyProfile.onboardingApproach` |

Поле `culture` вже існує — на `finish` вакансії також копіюється з `HrCompanyProfile.culture` (перезаписує значення з вакансійного чату, якщо агент його збирав раніше).

### Правило snapshot

На `POST /api/prep/:vacancyId/finish`:

1. Витягнути вакансійні поля (`role`, `requirements`, `expectations`) з діалогу вакансійного чату.
2. Прочитати підтверджений `HrCompanyProfile` поточного HR.
3. Записати в `CompanyProfile` вакансії: вакансійні поля + snapshot універсальних полів.
4. Закрити `PrepSessionHr` (`isClosed: true`).

Після `finish` зміни в `HrCompanyProfile` **не** поширюються на вже сформовані профілі вакансій.

---

## API-контракт

### Глобальний профіль компанії

Базовий шлях: `/api/company-prep`. Усі ендпоінти вимагають `requireAuth` + `requireHr`.

#### `GET /api/company-prep`

Повертає стан чату та профіль для поточного HR.

```json
{
  "messages": [{ "id": "...", "authorType": "AGENT_COMPANY", "content": "...", "createdAt": "..." }],
  "isClosed": false,
  "profile": null
}
```

Якщо сесії немає — `{ messages: [], isClosed: false, profile: null }`.
Якщо `isClosed` — `profile` містить поля `HrCompanyProfile` + `confirmedAt`.

#### `POST /api/company-prep/message`

```json
Body: { "message"?: string }
Response: { "message": "...", "readyForConfirmation": false }
```

Поведінка аналогічна `POST /api/prep/:vacancyId/message`: порожній виклик = greeting + перше питання.

#### `POST /api/company-prep/finish`

Закриває сесію, витягує structured profile з діалогу, upsert у `HrCompanyProfile`.

```json
Response: {
  "profile": {
    "culture": ["..."],
    "companyDirection": ["..."],
    "policies": ["..."],
    "workFormat": ["..."],
    "onboardingApproach": ["..."],
    "confirmedAt": null
  }
}
```

#### `POST /api/company-prep/confirm`

Ставить `HrCompanyProfile.confirmedAt = now()`.

```json
Response: { "profile": { ..., "confirmedAt": "2026-07-16T09:00:00.000Z" } }
```

- `404` — профіль не знайдено (не викликали `finish`)
- `409` — вже підтверджено

#### `DELETE /api/company-prep`

Скидає чат і непідтверджений профіль.

- `409` — якщо `HrCompanyProfile.confirmedAt !== null`

### Вакансійний prep (зміни)

#### Gate

`POST /api/prep/:vacancyId/message`, `finish`, `confirm` — перед обробкою перевіряють:

```typescript
const hrProfile = await prisma.hrCompanyProfile.findUnique({ where: { hrUserId: req.user.id } });
if (!hrProfile?.confirmedAt) {
  res.status(409).json({ error: "Company profile is not confirmed" });
  return;
}
```

#### `GET /api/prep/:vacancyId` — розширена відповідь

Додати поле для UI:

```json
{ "missingCompanyProfile": false, ... }
```

`missingCompanyProfile: true` — якщо `HrCompanyProfile.confirmedAt == null`.

#### `POST /api/prep/:vacancyId/finish` — snapshot

Після extraction вакансійних полів — merge з `HrCompanyProfile` (див. правило snapshot вище).

Response profile містить усі 8 полів:

```json
{
  "profile": {
    "role": "...",
    "requirements": ["..."],
    "expectations": ["..."],
    "culture": ["..."],
    "companyDirection": ["..."],
    "policies": ["..."],
    "workFormat": ["..."],
    "onboardingApproach": ["..."],
    "confirmedAt": null
  }
}
```

#### `PATCH /api/prep/:vacancyId/profile` (новий)

Редагування профілю вакансії **до** підтвердження.

```json
Body: {
  "role"?: string,
  "requirements"?: string[],
  "expectations"?: string[],
  "culture"?: string[],
  "companyDirection"?: string[],
  "policies"?: string[],
  "workFormat"?: string[],
  "onboardingApproach"?: string[]
}
```

- `404` — профіль не знайдено
- `409` — `profile.confirmedAt !== null`
- Валідація: `role` — непорожній рядок; масиви — непорожні, елементи — trim, без порожніх рядків

Response: `{ "profile": { ... } }`

---

## Агенти і промпти

### Новий агент: Company Profile Agent

Окремий system prompt (`company-profile-agent.uk.ts`) для збору 5 універсальних тем:

1. **Культура** (`culture`) — цінності, стиль роботи команди
2. **Напрям компанії** (`companyDirection`) — місія, продукт, ринок
3. **Політики** (`policies`) — правила, процеси, політики компанії
4. **Формат роботи** (`workFormat`) — офіс/remote/гібрид, години, локація
5. **Онбординг** (`onboardingApproach`) — як компанія зустрічає нових співробітників

Правила діалогу — як у поточного Company Agent: одне питання за раз, українською, `READY:true/false` маркер.

Окремий extraction prompt (`company-profile-extraction.uk.ts`) повертає JSON:

```json
{
  "culture": ["..."],
  "companyDirection": ["..."],
  "policies": ["..."],
  "workFormat": ["..."],
  "onboardingApproach": ["..."]
}
```

### Зміни в Vacancy Company Agent

Промпт (`company-agent.uk.ts`) скорочується до 3 вакансійних тем:

1. **Посада** (`role`)
2. **Вимоги** (`requirements`)
3. **Очікування** (`expectations`) — очікування від кандидата саме на цій ролі

Extraction prompt (`company-profile-extraction.uk.ts` для вакансії) — лише 3 поля. Універсальні поля не збираються в вакансійному чаті.

---

## UI/UX

### Навігація: пункт «Профіль компанії» у лівій панелі

У `HrSidebar` додається постійний пункт навігації **«Профіль компанії»** — основний вхід до глобального профілю, де зберігаються відповіді на універсальні питання.

**Порядок пунктів у sidebar:**

1. Головна
2. **Профіль компанії** ← новий
3. Анкети
4. Співбесіди
5. Звіти

**Поведінка:**

- `RouterLink` → `/company-profile`, активний стан: `route.path.startsWith('/company-profile')`
- Клік відкриває `CompanyProfilePrepView` — чат для збору/редагування універсальних відповідей
- Після підтвердження профілю на цьому екрані показується read-only прев'ю з 5 полями (`culture`, `companyDirection`, `policies`, `workFormat`, `onboardingApproach`)
- Якщо профіль ще не підтверджено — біля пункту sidebar можна показати індикатор «потрібно заповнити» (опційно, для MVP достатньо текстового банера на екрані)

**Роут:**

```
path: "company-profile"
name: "company-profile"
component: CompanyProfilePrepView
```

Додати в `HrLayout` children поруч із `vacancies`, `interviews`, `reports`.

### Новий екран: `CompanyProfilePrepView`

- Роут: `/company-profile`
- Доступ: HR, через sidebar «Профіль компанії» (основний вхід); додатково — CTA з `VacancyPrepView` при gate
- UX: аналогічний `VacancyPrepView` — чат → finish → прев'ю профілю → confirm
- Після confirm: read-only прев'ю універсальних відповідей з позначкою «✓ Профіль компанії підтверджено»
- Дані зберігаються в `HrCompanyProfile` (1 на HR); це єдине джерело truth для універсальних полів

### Зміни в `VacancyPrepView`

**Gate:** якщо `missingCompanyProfile === true`:

- чат не стартує;
- банер: «Спочатку заповніть і підтвердіть профіль компанії»;
- CTA-кнопка → `/company-profile` (веде на той самий екран, що й sidebar).

**Після `finish` вакансії:** екран «Зібраний профіль вакансії» у режимі редагування:

- усі 8 полів редаговані (textarea / списки);
- кнопки: «Зберегти зміни» (`PATCH`), «Підтвердити профіль» (`POST confirm`);
- після confirm — read-only (як зараз).

### Термінологія в UI

| Термін | Значення |
|---|---|
| Профіль компанії | Глобальний, 1 на HR, універсальні поля |
| Профіль вакансії | Локальний snapshot + вакансійні дані |

---

## Стани

### Глобальний профіль компанії

```
EMPTY → IN_PROGRESS → FORMED (finish) → CONFIRMED (confirm)
```

### Профіль вакансії

```
BLOCKED (no confirmed company profile)
  → EMPTY → IN_PROGRESS → FORMED (finish + snapshot) → EDITABLE → CONFIRMED
```

Після `CONFIRMED` вакансії: редагування та скидання заборонені.

---

## Помилки

| Ситуація | Код | Тіло |
|---|---|---|
| Глобальний профіль не підтверджено | 409 | `{ error: "Company profile is not confirmed" }` |
| Профіль вже підтверджено | 409 | `{ error: "Profile already confirmed" }` |
| Профіль компанії підтверджено, DELETE заборонено | 409 | `{ error: "Company profile is confirmed and cannot be reset" }` |
| LLM недоступна | 503 | `{ error: "LLM unavailable", detail }` |
| Невалідний JSON extraction | 502 | `{ error: "LLM unavailable", detail }` |

---

## Тестування

### Backend integration

- Gate: `POST /prep/:vacancyId/message` → 409 без confirmed `HrCompanyProfile`
- Snapshot: `finish` вакансії копіює всі 5 універсальних полів з `HrCompanyProfile`
- `PATCH /prep/:vacancyId/profile` — дозволено до confirm, заборонено після
- `DELETE /company-prep` — 409 після confirm глобального профілю
- Повний flow: company-prep confirm → vacancy prep finish → edit → confirm

### Agent/parsing unit tests

- `company-profile-agent`: extraction повертає 5 універсальних полів
- `company-agent` (vacancy): extraction повертає лише 3 вакансійні поля
- `parseAgentReply` — без змін

### Frontend

- Пункт «Профіль компанії» в `HrSidebar` з активним станом і роутом `/company-profile`
- `CompanyProfilePrepView` — повний цикл чат → finish → confirm; read-only прев'ю універсальних відповідей після confirm
- Банер + CTA на `VacancyPrepView` при `missingCompanyProfile` (веде на `/company-profile`)
- Форма редагування 8 полів перед підтвердженням вакансії

---

## Rollout і сумісність

- Міграція: нові таблиці (`HrCompanyProfile`, `PrepSessionCompany`, `PrepMessageCompany`) + nullable-поля в `CompanyProfile`
- Існуючі `CompanyProfile` без нових полів — працюють; нові поля `null`/`[]` до наступного `finish` або ручного редагування
- Candidate/live/report flow — без змін
- Arbiter Agent читає `CompanyProfile` вакансії як і раніше; після snapshot профіль містить повний набір полів

---

## Поза scope

- Редагування підтвердженого глобального профілю компанії (нова версія / re-confirm)
- Multi-tenant (кілька компаній на одного HR)
- Live inheritance (оновлення існуючих вакансій при зміні глобального профілю)
- Автоматичне оновлення snapshot у draft-вакансіях

# Приєднання кандидата за кодом — Day 14 Design Spec

**Дата:** 2026-07-09  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 14 плану розробки (README) — «Приєднання за кодом»  
**Передумови:** День 10 (candidate auth), Дні 11–13 (prep + profile confirm), candidate dashboard UI (join modal)  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- HR створює співбесіду з 6-символьним `joinCode` (День 8–9); HR може мати **кілька** активних співбесід одночасно
- Candidate auth і role-aware router guards (День 10)
- Candidate prep + profile confirm (Дні 11–13); `POST /confirm` **не** змінює `Interview.status`
- Join API (поточна гілка): `GET/POST /api/candidate/interview` — прив’язка `candidateUserId`, без переходу в `READY`
- Join UI (candidate dashboard): `JoinInterviewModal`, кнопки на home/profile/interview pages

**Мета Дня 14:** завершити join-by-code — валідація, прив’язка кандидата, перехід у `READY` («Обидва готові»), коли виконані всі умови готовності.

**Поза scope:**

- `InterviewParticipant` (у README згадано помилково; прив’язка через `Interview.candidateUserId`)
- Зміни Prisma-схеми
- Live interview room (Дні 15–19)
- Inline join-форма (модалка вже реалізована в candidate dashboard)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Коли `READY` | Коли кандидат **приєднався** і **підтвердив профіль**; helper викликається з join **і** confirm |
| HR-профіль для `READY` | `Vacancy.status === CONFIRMED` і `CompanyProfile.confirmedAt !== null` |
| Join-дозволені статуси | Лише `AWAITING_CANDIDATE`, `READY`; `LIVE`/`ENDED` → 409 |
| Одна активна співбесіда | Лише для **кандидата**; HR може мати скільки завгодно |
| Архітектура | Спільний модуль `interview-readiness.ts` (підхід 2) |
| UI join | Без змін layout; оновити лейбл `READY` → «Обидва готові» і нові помилки join |

---

## Підходи (розглянуті)

### 1. Inline-логіка в роутерах (відхилено)

Дублювання `maybeTransitionToReady` у `candidate-interview.ts` і `candidate-prep.ts`.

Плюси: мінімальний diff. Мінуси: правила розмазані, важче тестувати.

### 2. Спільний модуль `interview-readiness.ts` (обрано)

```ts
maybeTransitionToReady(prisma, interviewId) → Interview | null
canCandidateJoinInterview(prisma, candidateUserId, interview) → { ok: boolean; error?: string }
```

Плюси: одне джерело правил, unit-тести, зрозумілі межі.  
Мінуси: +1 файл (~60 рядків).

### 3. DB-тригер / Prisma middleware (відхилено)

Автоматичний перехід при зміні полів.

Плюси: «магія» в БД. Мінуси: непрозоро, не відповідає стилю проєкту.

---

## Життєвий цикл статусу (Day 14)

```text
HR створює співбесіду (Vacancy CONFIRMED) → AWAITING_CANDIDATE
  ↓
Кандидат join за кодом → candidateUserId встановлено; статус лишається AWAITING_CANDIDATE
  ↓
Кандидат проходить prep → finish → confirm
  ↓
maybeTransitionToReady() → READY («Обидва готові»)
```

**Зворотний порядок (рідкісний):** confirm до join неможливий у UI (prep потребує `interviewId` після join). Тест backend: confirm + join для покриття helper з обох точок.

**HR-профіль скинуто після створення співбесіди:** якщо HR редагує vacancy і `CompanyProfile.confirmedAt → null`, `maybeTransitionToReady` **не** переводить у `READY`, навіть якщо кандидат підтвердив профіль.

---

## Backend

### Новий модуль: `backend/src/utils/interview-readiness.ts`

#### `canCandidateJoinInterview(prisma, candidateUserId, interview)`

| Перевірка | Результат |
|-----------|-----------|
| `interview.status` ∈ `{ LIVE, ENDED }` | `{ ok: false, error: "Interview is not joinable" }` |
| `interview.candidateUserId` встановлено іншим user | `{ ok: false, error: "Interview already taken" }` |
| Кандидат має іншу активну співбесіду (`AWAITING_CANDIDATE`/`READY`/`LIVE`, `id !== interview.id`) | `{ ok: false, error: "Candidate already has active interview" }` |
| Інакше | `{ ok: true }` |

Активні статуси кандидата — ті самі, що в `GET /candidate/interview` (`ACTIVE_STATUSES`).

#### `maybeTransitionToReady(prisma, interviewId)`

1. Завантажити `Interview` з `vacancy.companyProfile` і `candidateProfile`.
2. Якщо `interview.status !== AWAITING_CANDIDATE` → повернути interview без змін (no-op).
3. Перевірити умови:
   - `interview.candidateUserId !== null`
   - `candidateProfile?.confirmedAt !== null`
   - `vacancy.status === CONFIRMED`
   - `vacancy.companyProfile?.confirmedAt !== null`
4. Якщо всі виконані → `prisma.interview.update({ status: "READY" })`.
5. Повернути актуальний interview.

### `POST /api/candidate/interview/join` (оновити)

**Auth:** Bearer token, `role: CANDIDATE`

**Body:** `{ "joinCode": "TEST01" }` — trim + uppercase на backend (як зараз)

**Обробка:**

1. Валідація `joinCode` → `400 { error: "joinCode is required" }`
2. `findUnique({ joinCode })` → `404 { error: "Invalid join code" }`
3. `canCandidateJoinInterview(...)` → `409 { error: "<reason>" }` якщо `!ok`
4. Якщо `candidateUserId === candidateUserId` (re-join) — skip update
5. Інакше `update({ candidateUserId })`
6. `maybeTransitionToReady(prisma, interview.id)`
7. Відповідь `200`:

```json
{
  "interview": {
    "id": "...",
    "displayName": "Frontend Dev",
    "status": "AWAITING_CANDIDATE"
  }
}
```

(`status` може бути `READY`, якщо профіль уже підтверджено — edge case.)

### `POST /api/candidate-prep/:interviewId/confirm` (оновити)

Після успішного `candidateProfile.update({ confirmedAt })`:

1. Викликати `maybeTransitionToReady(prisma, interviewId)`
2. У відповіді `interviewStatus` — **актуальний** статус (може бути `READY`)

### `GET /api/candidate/interview`

Без змін поведінки; повертає interview з актуальним `status`.

---

## Frontend

Join UI **вже реалізовано** (`JoinInterviewModal`, candidate dashboard). День 14 — мінімальні зміни:

### API-клієнт (`frontend/src/api/candidate-interview.ts`)

Додати мапінг нових 409-помилок:

| Backend `error` | UI-текст |
|-----------------|----------|
| `Interview is not joinable` | Співбесіду вже завершено або вона в ефірі |
| `Candidate already has active interview` | У вас уже є активна співбесіда |

### Лейбл статусу `READY`

Замінити «Готова» → **«Обидва готові»** у:

| Файл |
|------|
| `frontend/src/views/CandidateHomeView.vue` |
| `frontend/src/views/CandidateInterviewView.vue` |
| `frontend/src/views/InterviewListView.vue` |
| `frontend/src/views/InterviewDetailView.vue` |

Інші статуси без змін: `AWAITING_CANDIDATE` → «Очікує кандидата», `LIVE` → «В ефірі».

---

## Обробка помилок

| HTTP | Умова | UI (модалка join) |
|------|-------|-------------------|
| 400 | Порожній код | Кнопка disabled (frontend) |
| 404 | Невалідний код | Невірний код співбесіди |
| 409 | Зайнято іншим | Ця співбесіда вже зайнята іншим кандидатом |
| 409 | Not joinable | Співбесіду вже завершено або вона в ефірі |
| 409 | Active interview exists | У вас уже є активна співбесіда |
| 500 | Internal | Не вдалося приєднатися до співбесіди |

---

## Файли

### Backend (нові)

| Файл | Призначення |
|------|-------------|
| `backend/src/utils/interview-readiness.ts` | `canCandidateJoinInterview`, `maybeTransitionToReady` |
| `backend/src/utils/interview-readiness.test.ts` | Unit-тести readiness і join-валідації |

### Backend (оновити)

| Файл | Зміни |
|------|-------|
| `backend/src/routes/candidate-interview.ts` | Join-валідація + `maybeTransitionToReady` |
| `backend/src/routes/candidate-interview.test.ts` | Нові кейси join/409/READY |
| `backend/src/routes/candidate-prep.ts` | `maybeTransitionToReady` після confirm |
| `backend/src/routes/candidate-prep.test.ts` | Confirm → `READY` коли joined |
| `backend/package.json` | Додати `interview-readiness.test.ts` до `test` script |

### Frontend (оновити)

| Файл | Зміни |
|------|-------|
| `frontend/src/api/candidate-interview.ts` | Нові 409-помилки |
| `frontend/src/views/CandidateHomeView.vue` | Лейбл `READY` |
| `frontend/src/views/CandidateInterviewView.vue` | Лейбл `READY` |
| `frontend/src/views/InterviewListView.vue` | Лейбл `READY` |
| `frontend/src/views/InterviewDetailView.vue` | Лейбл `READY` |

### Docs

| Файл | Зміни |
|------|-------|
| `README.md` | Day 14 DoD, endpoint, сценарій, прибрати `InterviewParticipant` |

---

## Тестування

### Unit (`interview-readiness.test.ts`)

- `maybeTransitionToReady`: joined + confirmed + HR confirmed → `READY`
- `maybeTransitionToReady`: joined без confirm → no-op (`AWAITING_CANDIDATE`)
- `maybeTransitionToReady`: confirm без join → no-op
- `maybeTransitionToReady`: HR profile reset → no-op
- `maybeTransitionToReady`: вже `READY`/`LIVE` → no-op
- `canCandidateJoinInterview`: LIVE/ENDED → not ok
- `canCandidateJoinInterview`: інша активна співбесіда → not ok
- `canCandidateJoinInterview`: re-join same → ok

### Integration (`candidate-interview.test.ts`)

- join валідний код → 200, `candidateUserId` встановлено, `AWAITING_CANDIDATE`
- join + confirm (через prep mock) → `READY`
- join `ENDED`/`LIVE` → 409
- join при наявній активній → 409
- re-join same → 200 idempotent
- 404 invalid code, 409 taken (існуючі тести — без регресії)

### Integration (`candidate-prep.test.ts`)

- confirm після join → `interviewStatus: "READY"` (оновити існуючий тест confirm)

### Ручний сценарій (Day 14 DoD)

1. HR: login → підтверджена анкета → створити співбесіду → скопіювати код
2. Кандидат: login → «Приєднатися до зустрічі» → ввести код → банер успіху
3. HR dashboard: співбесіда «Очікує кандидата»
4. Кандидат: prep → finish → confirm
5. Обидва бачать статус **«Обидва готові»** (`READY`)
6. Невалідний код → помилка в модалці
7. Другий кандидат на той самий код → «вже зайнята»

**Build:** `npm run build` у корені без помилок.

---

## Definition of Done

- [ ] Демонстрація: HR дав код → кандидат ввів → prep → confirm → обидва в `READY`
- [ ] Сценарій: невалідний код → помилка; код зайнятий → помилка; валідний join → `candidateUserId` встановлено
- [ ] Збірка: `npm run build` проходить
- [ ] README: endpoint `POST /api/candidate/interview/join`, сценарій до `READY`

---

## Ризики та мітигації

| Ризик | Мітигація |
|-------|-----------|
| HR скинув анкету після join | `maybeTransitionToReady` перевіряє `CompanyProfile.confirmedAt`; статус лишається `AWAITING_CANDIDATE` |
| Confirm до join (API-only) | Helper безпечний: без `candidateUserId` не переводить у `READY` |
| Дублювання `ACTIVE_STATUSES` | Експортувати константу з `interview-readiness.ts` або `candidate-interview.ts` |

---

## Наступний крок

Після review цього spec → implementation plan (writing-plans) для Дня 14.

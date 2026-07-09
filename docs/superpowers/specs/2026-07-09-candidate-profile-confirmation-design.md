# Профіль кандидата + підтвердження — Day 13 Design Spec

**Дата:** 2026-07-09  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 13 плану розробки (README) — «Профіль кандидата + підтвердження»  
**Передумови:** День 11 (Candidate Agent backend), День 12 (Candidate Prep Chat UI)  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- Candidate prep backend: `GET/POST/DELETE /api/candidate-prep/:interviewId` (День 11)
- Candidate prep UI: `CandidatePrepView.vue` — чат, `readyForConfirmation` у `ref`, без finish/confirm (День 12)
- HR-еталон: `VacancyPrepView.vue` + `POST /prep/:vacancyId/finish` + `POST /prep/:vacancyId/confirm` (Дні 5–7)
- Prisma-модель `CandidateProfile`: `experience`, `skills`, `goals` (Json), `summary` (String), `confirmedAt` (DateTime?)

**Мета Дня 13:** після анкети AI формує структурований JSON-профіль; кандидат переглядає його read-only і явно підтверджує кнопкою «Підтвердити профіль».

**Поза scope Дня 13:** join-by-code (День 14), зміна `Interview.status`, редагування профілю, shared refactor HR/candidate UI, зміни Prisma-схеми.

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| JSON-структура | Змішаний формат: `experience[]`, `goals[]`, `skills: { strong[], growth[] }`, `summary` (рядок) |
| `POST /confirm` | Лише `confirmedAt`; `Interview.status` **не** змінюється (`READY` — на Дні 14 після join) |
| «Завершити чат» | Завжди доступна; якщо `!readyForConfirmation` — `window.confirm()` з попередженням (як у HR) |
| Архітектура | Дзеркало HR у `candidate-prep.ts` + розширення `CandidatePrepView.vue` (без shared refactor) |
| Підтвердження | Незворотне для MVP; повторний `/confirm` → `409` |
| UI confirm | `window.confirm()` перед фіксацією (той самий текст, що у HR) |

---

## Структура `CandidateProfile` JSON

LLM extraction і UI використовують єдиний контракт:

```json
{
  "experience": [
    "3 роки backend-розробник у FinTech",
    "Tech lead на проєкті платіжного шлюзу"
  ],
  "skills": {
    "strong": ["TypeScript", "PostgreSQL", "REST API"],
    "growth": ["публічні виступи", "people management"]
  },
  "goals": [
    "перейти на senior-роль",
    "працювати з продуктовою командою"
  ],
  "summary": "Backend-розробник з 3 роками досвіду в fintech, фокус на надійних API та PostgreSQL."
}
```

### Правила валідації (`parseCandidateProfileExtraction`)

- `experience`, `goals` — непорожні масиви рядків; якщо в діалозі немає даних → `["не вказано"]`.
- `skills.strong`, `skills.growth` — непорожні масиви рядків; аналогічно `["не вказано"]` за відсутності даних.
- `summary` — непорожній рядок українською (1–3 речення).
- Не вигадувати фактів, яких немає в стенограмі.
- Невалідний JSON від LLM → `ProfileExtractionError` → HTTP `502`.

TypeScript-тип:

```ts
export type ExtractedCandidateProfile = {
  experience: string[];
  skills: { strong: string[]; growth: string[] };
  goals: string[];
  summary: string;
};
```

---

## Backend

### Нові модулі

| Файл | Призначення |
|------|-------------|
| `backend/src/agents/prompts/candidate-profile-extraction.uk.ts` | System prompt для LLM extraction |
| `backend/src/agents/candidate-agent.ts` | + `parseCandidateProfileExtraction`, `buildCandidateProfileExtractionMessages` |
| `backend/src/agents/candidate-agent.test.ts` | Тести парсера extraction |

Промпт extraction описує цільовий JSON-формат і правила (аналог `company-profile-extraction.uk.ts`). Стенограма формується як:

```
Кандидат: ...
Агент: ...
```

### `POST /api/candidate-prep/:interviewId/finish`

**Auth:** Bearer token, `role: CANDIDATE`

**Body:** порожнє

**Обробка:**

1. `Interview` за `:interviewId` → `404 { error: "Interview not found" }`.
2. `PrepSessionCandidate` → `404 { error: "Prep session not found" }` якщо сесії немає.
3. `session.isClosed` → `409 { error: "Prep session closed" }`.
4. Завантажити історію `PrepMessageCandidate`, побудувати LLM messages, викликати provider.
5. `parseCandidateProfileExtraction(rawReply)`.
6. `CandidateProfile.upsert` + `PrepSessionCandidate.update({ isClosed: true })`.
7. Відповідь `200`:

```json
{
  "profile": {
    "experience": ["..."],
    "skills": { "strong": ["..."], "growth": ["..."] },
    "goals": ["..."],
    "summary": "...",
    "confirmedAt": null
  }
}
```

**Помилки LLM:** ідентично `prep.ts` — `503` unavailable, `502` empty/invalid JSON. При `502` профіль не зберігається, сесія лишається відкритою.

### `POST /api/candidate-prep/:interviewId/confirm`

**Auth:** Bearer token, `role: CANDIDATE`

**Body:** порожнє

**Обробка:**

1. `Interview` → `404` якщо не знайдено.
2. `CandidateProfile` → `404 { error: "Profile not found" }` якщо `finish` не викликано.
3. `profile.confirmedAt !== null` → `409 { error: "Profile already confirmed" }`.
4. `candidateProfile.update({ confirmedAt: new Date() })` — **без** зміни `Interview.status`.
5. Відповідь `200`:

```json
{
  "profile": {
    "experience": ["..."],
    "skills": { "strong": ["..."], "growth": ["..."] },
    "goals": ["..."],
    "summary": "...",
    "confirmedAt": "2026-07-09T11:00:00.000Z"
  },
  "interviewStatus": "AWAITING_CANDIDATE"
}
```

`interviewStatus` повертається для консистентності API (як у HR confirm); на Дні 13 значення не змінюється confirm-ом.

### Існуючі ендпоінти — без змін поведінки

- `GET /candidate-prep/:interviewId` — profile вже повертається коли `isClosed && CandidateProfile` існує (Day 11).
- `DELETE /candidate-prep/:interviewId` — вже блокує reset після `confirmedAt` (Day 11).
- `POST /candidate-prep/:interviewId/message` — `409` коли `isClosed` (Day 11).

---

## Frontend

### API-клієнт (`frontend/src/api/candidate-prep.ts`)

Уточнити типи:

```ts
export type CandidateSkills = {
  strong: string[];
  growth: string[];
};

export type CandidateProfile = {
  experience: string[];
  skills: CandidateSkills;
  goals: string[];
  summary: string;
  confirmedAt: string | null;
};
```

Нові функції:

```ts
export async function finishCandidatePrepChat(
  interviewId: string
): Promise<{ profile: CandidateProfile }>;

export async function confirmCandidatePrepProfile(
  interviewId: string
): Promise<{ profile: CandidateProfile; interviewStatus: string }>;
```

### UI (`CandidatePrepView.vue`)

Розширити за патерном `VacancyPrepView.vue`:

**Нові refs:** `profile`, `viewingHistory`, `confirming`

**Стани view:**

| Умова | Екран |
|-------|-------|
| `!isClosed` | Чат + composer + «Завершити чат» + «Видалити чат» |
| `isClosed && profile && !viewingHistory` | Екран профілю (read-only) |
| `isClosed && viewingHistory` | Read-only історія чату + «Показати профіль» |

**Екран профілю:**

- Заголовок: «Зібраний профіль кандидата»
- `<dl>` секції: Досвід, Сильні сторони, Зони росту, Цілі, Короткий опис
- `experience` / `goals` — `<ul><li>`
- `skills.strong` / `skills.growth` — окремі `<dt>` + `<ul>`
- `summary` — `<dd>` з абзацом

**Actions:**

- «← Назад до чату» → `viewingHistory = true`
- «Видалити чат» — disabled якщо `profile.confirmedAt`, title з підказкою
- «Підтвердити профіль» — `btn-primary`, лише якщо `!profile.confirmedAt`
- Після confirm: «✓ Підтверджено {дата, uk-UA}»

**`onFinishChat`:** як у HR — попередження якщо `!lastReadyForConfirmation`, потім `finishCandidatePrepChat`, `isClosed = true`, показ профілю.

**`onConfirmProfile`:** `window.confirm("Профіль буде зафіксовано. Подальше редагування стане неможливим. Підтвердити?")` → `confirmCandidatePrepProfile`.

**`loadPrepState`:** при reload після finish — завантажити `profile` з GET, показати profile-view якщо `isClosed && profile`.

Scoped CSS для `.profile-view` — копія з `VacancyPrepView.vue`.

---

## Обробка помилок

| HTTP | Умова | UI |
|------|-------|-----|
| `401` | Немає/невалідний JWT | Router guard → login |
| `403` | HR-токен на candidate endpoint | Banner «Доступ заборонено» |
| `404` | Interview / session / profile not found | Banner з текстом помилки |
| `409` | Session closed, profile already confirmed, delete after confirm | Banner |
| `502` | LLM invalid JSON на finish | Banner «Не вдалося завершити чат» |
| `503` | LLM unavailable | Banner «Агент тимчасово недоступний» |

---

## Файлова структура

### Create

- `backend/src/agents/prompts/candidate-profile-extraction.uk.ts`

### Modify

- `backend/src/agents/candidate-agent.ts` — extraction helpers
- `backend/src/agents/candidate-agent.test.ts` — тести парсера
- `backend/src/routes/candidate-prep.ts` — `POST /finish`, `POST /confirm`
- `backend/src/routes/candidate-prep.test.ts` — нові кейси
- `frontend/src/api/candidate-prep.ts` — типи + finish/confirm
- `frontend/src/views/CandidatePrepView.vue` — profile view + finish/confirm
- `README.md` — Day 13 Quick Start, JSON-структура, curl для finish/confirm

### Без змін

- Prisma schema
- `VacancyPrepView.vue`
- Candidate Agent chat prompt (окремий від extraction prompt)

---

## Тестування і верифікація

### Backend (`candidate-prep.test.ts`)

- `POST /finish` після кількох повідомлень → 200, profile з усіма полями, `confirmedAt: null`, `isClosed: true`.
- `POST /finish` без сесії → 404.
- `POST /finish` на закритій сесії → 409.
- `POST /finish` з invalid JSON від LLM → 502, profile не створено, session відкрита.
- `POST /confirm` після finish → 200, `confirmedAt` не null.
- `POST /confirm` без profile → 404.
- Повторний `POST /confirm` → 409.
- `GET` після finish повертає profile; після confirm — `confirmedAt` заповнено.
- `DELETE` після confirm → 409.

### Backend (`candidate-agent.test.ts`)

- `parseCandidateProfileExtraction` — valid JSON, markdown fences, missing fields, invalid JSON.

### Ручний сценарій (Day 13 DoD)

1. Логін кандидата → `/candidate/prep/:interviewId`.
2. Пройти чат (3+ обміни) до `readyForConfirmation: true` (або форсувати finish з попередженням).
3. «Завершити чат» → екран профілю з `experience`, `skills`, `goals`, `summary`.
4. «Підтвердити профіль» → «✓ Підтверджено {дата}».
5. Reload — профіль на місці, чат read-only, «Видалити чат» disabled.
6. Перевірка в БД: `CandidateProfile.confirmedAt` заповнено, `PrepSessionCandidate.isClosed = true`.

**Build:** `npm run build` у корені без помилок.

---

## Definition of Done

- [ ] Демонстрація: кандидат бачить свій профіль і підтверджує його
- [ ] Сценарій: JSON містить `experience`, `skills`, `goals`, `summary`; після підтвердження `confirmedAt` заповнено, prep закритий
- [ ] Збірка: `npm run build` проходить
- [ ] README: структура `CandidateProfile` JSON, curl для finish/confirm

---

## Ризики та мітигації

| Ризик | Мітигація |
|-------|-----------|
| LLM повертає невалідний JSON | `502`, сесія відкрита — повтор finish |
| LLM плутає `strong`/`growth` | Чіткий prompt + приклад у extraction prompt |
| Дублювання UI-логіки з HR | Прийнятне для Дня 13; shared refactor — опційно пізніше |
| `skills` як flat array від LLM | Строга валідація → 502, не зберігати частковий профіль |

---

## Наступний крок

Після review цього spec → implementation plan (writing-plans) для Дня 13.

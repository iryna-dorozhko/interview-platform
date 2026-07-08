# Candidate Agent Prep Chat Design (Day 11)

## Context

Проєкт уже має повний HR prep-флоу:

- `backend/src/agents/company-agent.ts` — побудова повідомлень для LLM, парсинг `READY:true/false`
- `backend/src/routes/prep.ts` — `GET`, `POST /message`, `POST /finish`, `POST /confirm`, `DELETE` для `/api/prep/:vacancyId`
- Prisma-моделі `PrepSessionHr` / `PrepMessageHr` + `CompanyProfile`

День 10 додає candidate auth (`requireCandidate` ще не існує, але JWT з `role: CANDIDATE` уже підтримується). Схема БД для candidate prep уже готова:

- `PrepSessionCandidate` (прив'язка до `interviewId`)
- `PrepMessageCandidate` (`HUMAN_CANDIDATE` | `AGENT_CANDIDATE`)
- `CandidateProfile` (використовується на Дні 13)

Завдання Day 11: серверна частина candidate prep-чату — промпт, API повідомлень, збереження в БД. Без UI, без profile extraction/confirm, без join-by-code.

## Goals

1. Candidate Agent веде структурований діалог українською про досвід, сильні/слабкі сторони та цілі.
2. API приймає повідомлення кандидата і повертає відповідь агента з `readyForConfirmation`.
3. Історія чату зберігається в `PrepSessionCandidate` / `PrepMessageCandidate`.
4. Демонстрація через curl/API: мінімум 3 обміни повідомленнями.

## Non-goals

- Frontend UI (День 12)
- `POST /finish`, `POST /confirm`, profile extraction (День 13)
- `POST /interviews/join`, перевірка `candidateUserId` (День 14)
- Зміни Prisma-схеми
- Стрімінг LLM

## Decisions (validated)

### Prep scope

- Prep-сесія прив'язана до `interviewId` (як у схемі БД).
- На Дні 11: `requireAuth` + `requireCandidate` + interview існує.
- Перевірку `interview.candidateUserId === req.user.id` відкладаємо на День 14.

### API surface

Базовий шлях: `/api/candidate-prep/:interviewId`

| Метод | Шлях | Опис |
|-------|------|------|
| `GET` | `/candidate-prep/:interviewId` | Історія повідомлень, `isClosed`, `profile` |
| `POST` | `/candidate-prep/:interviewId/message` | Повідомлення кандидата → відповідь агента |
| `DELETE` | `/candidate-prep/:interviewId` | Скинути чат і непідтверджений профіль |

`finish` / `confirm` не входять у scope Дня 11.

### READY marker

Як у Company Agent: агент завершує кожну відповідь рядком `READY:true` або `READY:false`. API повертає `{ message, readyForConfirmation }`. Маркер не зберігається в `content` повідомлення агента.

### Terminology (README)

- **COMPANY_PREP** — HR prep: `PrepSessionHr`, автори `HUMAN_HR` / `AGENT_COMPANY`
- **CANDIDATE_PREP** — candidate prep: `PrepSessionCandidate`, автори `HUMAN_CANDIDATE` / `AGENT_CANDIDATE`

## Architecture

Окремий модуль за патерном Company Agent (не розширювати `prep.ts`):

```
backend/src/
  agents/
    agent-reply.ts              # shared parseAgentReply (винести з company-agent)
    candidate-agent.ts          # buildCandidateAgentMessages
    prompts/
      candidate-agent.uk.ts     # system prompt
  routes/
    candidate-prep.ts           # GET, POST /message, DELETE
    candidate-prep.test.ts
  auth/
    middleware.ts               # + requireCandidate
```

Монтування в `server.ts`:

```ts
app.use("/api", requireAuth, requireCandidate, createCandidatePrepRouter(...));
```

HR-маршрути лишаються під `requireHr`; candidate prep — під `requireCandidate`.

### Data flow (POST /message)

1. Валідувати `interviewId` → `404` якщо interview не існує.
2. Upsert `PrepSessionCandidate` для `interviewId`.
3. Якщо `session.isClosed` → `409`.
4. Якщо `message` не порожнє — зберегти `PrepMessageCandidate` з `authorType: HUMAN_CANDIDATE`.
5. Завантажити історію, побудувати `buildCandidateAgentMessages(history)`.
6. Викликати `LlmProvider.complete()`.
7. `parseAgentReply(rawReply)` → `{ message, readyForConfirmation }`.
8. Зберегти `AGENT_CANDIDATE` повідомлення (без маркера READY).
9. Повернути `{ message, readyForConfirmation }`.

### Empty message greeting

Як у HR prep: `POST { "message": "" }` запускає LLM-виклик. `buildCandidateAgentMessages` додає placeholder user turn `(порожнє повідомлення)`, якщо останнє повідомлення не від кандидата — агент привітається і ставить перше питання.

## Candidate Agent Prompt

Файл: `backend/src/agents/prompts/candidate-agent.uk.ts`

Агент — AI-асистент кандидата, який збирає інформацію для профілю перед співбесідою.

**Теми (одне питання за раз):**

1. **Досвід** — попередні ролі, роки, ключові проєкти, технології.
2. **Сильні сторони** — конкретні навички та досягнення.
3. **Слабі сторони** — зони росту (конструктивно, без токсичної самокритики).
4. **Цілі** — кар'єрні цілі, очікування від нової ролі.

**Правила:**

- Усі повідомлення кандидату — виключно українською.
- Одне питання за раз; природний діалог, без показу всього списку тем одразу.
- Не вигадувати факти за кандидата.
- Якщо відповідь розпливчаста — одне уточнювальне питання перед переходом далі.
- Останній рядок відповіді: `READY:true` або `READY:false` (без дужок/крапок навколо).
- `READY:true` лише коли одночасно: ≥3 змістовних обмінів і зібрано конкретну інформацію по всіх чотирьох темах.

## API Contract

### GET /api/candidate-prep/:interviewId

**Auth:** Bearer token, `role: CANDIDATE`

**Response 200:**

```json
{
  "messages": [
    {
      "id": "clx...",
      "authorType": "AGENT_CANDIDATE",
      "content": "Вітаю! ...",
      "createdAt": "2026-07-08T10:00:00.000Z"
    }
  ],
  "isClosed": false,
  "profile": null
}
```

- Якщо сесії немає: `{ "messages": [], "isClosed": false, "profile": null }`.
- `profile` повертається лише коли `session.isClosed === true` і `CandidateProfile` існує (на Дні 11 завжди `null`).

### POST /api/candidate-prep/:interviewId/message

**Request:**

```json
{ "message": "Працював 3 роки як backend-розробник..." }
```

**Response 200:**

```json
{
  "message": "Дякую! Розкажіть про ваші найсильніші технічні навички.",
  "readyForConfirmation": false
}
```

### DELETE /api/candidate-prep/:interviewId

**Response 200:** `{ "ok": true }`

Видаляє `PrepMessageCandidate`, `PrepSessionCandidate` і непідтверджений `CandidateProfile` для цього `interviewId`.

## Error Handling

| Код | Умова |
|-----|-------|
| `401` | Відсутній або невалідний JWT |
| `403` | `role !== CANDIDATE` (HR-токен на candidate endpoint) |
| `404` | Interview не знайдено |
| `409` | Prep-сесія закрита (`isClosed`) |
| `409` | `CandidateProfile.confirmedAt` вже заповнено (DELETE) |
| `502` | LLM повернув порожню відповідь |
| `503` | LLM недоступний |

Поведінка LLM-помилок — ідентична `prep.ts` (логування з префіксом `[candidate-prep]`).

## Shared Code Refactor

Винести `parseAgentReply` і `READY_MARKER_PATTERN` з `company-agent.ts` у `agent-reply.ts`. Оновити імпорти в `company-agent.ts` і тестах. `candidate-agent.ts` імпортує з того ж модуля.

`buildCandidateAgentMessages` залишається в `candidate-agent.ts` (окремий system prompt і author types).

## Testing Strategy

### candidate-agent.test.ts

- `buildCandidateAgentMessages` мапить `HUMAN_CANDIDATE` → `user`, `AGENT_CANDIDATE` → `assistant`
- placeholder user turn на порожній/агентській історії
- system prompt містить ключові теми

### candidate-prep.test.ts (fake Prisma + fake LLM, як prep.test.ts)

1. `GET` без сесії → порожній масив повідомлень
2. `POST /message` зберігає human + agent повідомлення, повертає `readyForConfirmation`
3. `POST` з LLM-відповіддю `READY:true` → `readyForConfirmation: true`, маркер не в `content`
4. `POST` на закриту сесію → `409`
5. `DELETE` скидає messages і session
6. `DELETE` з підтвердженим профілем → `409`
7. HR-токен на candidate endpoint → `403`
8. Неіснуючий `interviewId` → `404`

## Demo Scenario (curl)

```bash
# 1. Зареєструвати/залогінити кандидата
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/candidate/login \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}' | jq -r .token)

# 2. interviewId з seed (joinCode=TEST01)
INTERVIEW_ID="<interviewId-from-seed>"

# 3. Привітання агента
curl -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":""}'

# 4–6. Ще 2+ обміни
curl -X POST "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"3 роки backend, Node.js, PostgreSQL"}'

# 7. Перевірити історію
curl "http://localhost:3000/api/candidate-prep/$INTERVIEW_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## Incremental Plan (implementation order)

1. Винести `parseAgentReply` → `agent-reply.ts`, оновити company-agent імпорти
2. `requireCandidate` middleware + тест
3. `candidate-agent.uk.ts` + `candidate-agent.ts` + unit-тести
4. `candidate-prep.ts` router + integration-тести
5. Монтування в `server.ts`
6. README: Day 11 quick-start, відмінність COMPANY_PREP vs CANDIDATE_PREP, curl-приклад

## Acceptance Criteria (Day 11 DoD)

1. Демо: через API кандидат веде діалог з Candidate Agent (мінімум 3 обміни).
2. Сценарій: повідомлення зберігаються в `PrepSessionCandidate` / `PrepMessageCandidate`; відповіді стосуються досвіду та навичок.
3. Build: `npm run build` проходить.
4. README оновлено: термінологія, endpoint-и, curl-приклад.

## Risks & Mitigations

- **Ризик:** HR і candidate prep плутаються в документації або URL.
  - **Мітигація:** окремий prefix `/candidate-prep/` і явна термінологія в README.
- **Ризик:** дублювання LLM error-handling між `prep.ts` і `candidate-prep.ts`.
  - **Мітигація:** прийнятне на День 11; shared helper — лише якщо з'явиться третій router.
- **Ризик:** кандидат може писати в чужу співбесіду до Дня 14.
  - **Мітигація:** задокументовано як тимчасове обмеження; ownership check на День 14.

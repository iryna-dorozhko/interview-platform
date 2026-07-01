# AI-платформа для співбесід — Design Spec (MVP Skeleton)

**Дата:** 2026-07-01  
**Статус:** Затверджено в brainstorming  
**Репозиторій:** `/Users/iruna/interview-platform`  
**Мова:** Українська (UI, промпти агентів, звіти)

---

## Мета

Створити новий репозиторій з нуля («скелет») для локального MVP AI-платформи співбесід. Чистий старт без копіювання коду з `agent`; архітектурні ідеї успадковуються, scope свідомо звужений.

**Перший MVP включає:**

- Candidate Agent, Company Agent, Arbiter
- Повний prep-цикл (анкети кандидата та компанії)
- Спільний live-чат (2 людини + 3 агенти)
- Генерацію фінального звіту
- Docker Compose розгортання
- Ollama (локально) + LiteLLM (зовнішня модель), перемикання через `.env`

---

## Узгоджені рішення (brainstorming)

| Тема | Рішення |
|------|---------|
| Репозиторій | `/Users/iruna/interview-platform`, чистий старт |
| Відношення до `agent` | Лише архітектурні ідеї, без копіювання коду |
| Prep | Повний цикл: AI-діалог → підтвердження профілю → кімната |
| Scope | Мінімум: login → prep → код → кімната → звіт |
| Виключено | Issues, бібліотека анкет, історія, відмовні листи, HR control rail, oMLX, стрімінг |
| Стек | npm workspaces monorepo: Vue 3 + Vite, Express + TypeScript, PostgreSQL + Prisma, Socket.IO, JWT |
| LLM | `LLM_PROVIDER=ollama \| litellm`; Ollama на хості, не в Docker |
| Підхід до скелета | Vertical slice + модульна структура (рекомендований hybrid) |

---

## Учасники

| Учасник | Тип | Роль |
|---------|-----|------|
| Candidate | Людина | Кандидат |
| HR | Людина | Представник компанії |
| Candidate Agent | AI | Prep: збір профілю кандидата; Room: інтереси кандидата |
| Company Agent | AI | Prep: збір профілю компанії; Room: інтереси компанії |
| Arbiter | AI | Room: модерація дискусії, пропозиція завершення, фінальний звіт |

У live-кімнаті одночасно **5 учасників**: 2 людини + 3 агенти.

---

## Архітектура

```
┌─────────────┐     HTTP/WS      ┌──────────────────────────────────┐
│  Vue 3 SPA  │ ◄──────────────► │  Express + Socket.IO             │
│  (frontend) │                  │  ┌────────┐ ┌──────┐ ┌────────┐ │
└─────────────┘                  │  │  Auth  │ │ Prep │ │  Room  │ │
                                 │  └────────┘ └──────┘ └────────┘ │
                                 │         ┌──────────────┐         │
                                 │         │ Agent Layer  │         │
                                 │         │ C / Co / Arb │         │
                                 │         └──────┬───────┘         │
                                 │                ▼                 │
                                 │         ┌──────────────┐         │
                                 │         │  LLM Router  │         │
                                 │         │ Ollama│LiteLLM│         │
                                 │         └──────────────┘         │
                                 └──────────────┬───────────────────┘
                                                ▼
                                         PostgreSQL
```

### Agent pipeline (room)

```
Human message → save → Candidate Agent → Company Agent → Arbiter → save 0–n messages → socket batch
```

Prep використовує HTTP (синхронно). Room — Socket.IO з async orchestrator на backend.

---

## Структура проєкту

```text
interview-platform/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── package.json                 # npm workspaces
├── apps/
│   ├── backend/
│   │   ├── package.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── app.ts
│   │       ├── config/
│   │       ├── middleware/      # JWT
│   │       ├── routes/          # auth, interviews, prep, reports
│   │       ├── socket/          # room events
│   │       ├── services/
│   │       │   ├── llm/
│   │       │   │   ├── llm.provider.ts
│   │       │   │   ├── ollama.provider.ts
│   │       │   │   ├── litellm.provider.ts
│   │       │   │   └── llm.router.ts
│   │       │   ├── interview.service.ts
│   │       │   ├── profile.service.ts
│   │       │   ├── report.service.ts
│   │       │   └── agents/
│   │       │       ├── prompts/           # *.uk.md
│   │       │       ├── candidate.agent.ts
│   │       │       ├── company.agent.ts
│   │       │       ├── arbiter.agent.ts
│   │       │       └── orchestrator.ts
│   │       └── types/
│   └── frontend/
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.ts
│           ├── router/
│           ├── stores/          # auth, interview, chat
│           ├── api/
│           ├── socket/
│           ├── views/
│           │   ├── LoginView.vue
│           │   ├── HrDashboardView.vue
│           │   ├── CandidateDashboardView.vue
│           │   ├── PrepChatView.vue
│           │   ├── InterviewRoomView.vue
│           │   └── ReportView.vue
│           └── components/
│               └── chat/
│                   └── ChatPanel.vue
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-07-01-interview-platform-mvp-design.md
```

---

## Модель даних (Prisma)

### User

- `id`, `email`, `passwordHash`, `role`: `CANDIDATE` | `HR`

### Interview

- `id`, `code` (6 символів, унікальний), `status`:
  - `DRAFT` — створено HR
  - `PREP` — хтось приєднався / йде анкетування
  - `READY` — обидва профілі підтверджені
  - `LIVE` — хтось увійшов у кімнату
  - `ENDED` — завершено, є звіт
- `createdById` (HR)

### InterviewParticipant

- `interviewId`, `userId` — унікальна пара

### ChatSession

- `interviewId`, `type`: `CANDIDATE_PREP` | `COMPANY_PREP` | `ROOM`
- `isClosed` — після підтвердження профілю prep закривається

### Message

- `sessionId`, `authorType`: `HUMAN` | `CANDIDATE_AGENT` | `COMPANY_AGENT` | `ARBITER`
- `authorUserId` (nullable, для HUMAN)
- `content`, `createdAt`

### Profile

- `interviewId`, `type`: `CANDIDATE` | `COMPANY`
- `data` (Json), `confirmedAt`
- Профілі прив'язані до interview (без окремої бібліотеки збережених анкет)

### FinalReport

- `interviewId`, `data` (Json), `markdown`, `createdAt`

### Profile JSON schemas

**CandidateProfile:**

```json
{
  "experience": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "goals": ["string"],
  "skills": ["string"],
  "summary": "string"
}
```

**CompanyProfile:**

```json
{
  "role": "string",
  "requirements": ["string"],
  "culture": "string",
  "expectations": ["string"],
  "risks": ["string"],
  "summary": "string"
}
```

---

## Життєвий цикл

```
1. HR login
2. HR → POST /interviews → отримує code (DRAFT)
3. HR → prep з Company Agent → підтверджує профіль (PREP)
4. Candidate login → POST /interviews/join { code }
5. Candidate → prep з Candidate Agent → підтверджує профіль
6. Обидва профілі є → READY
7. Відкриття кімнати → LIVE
8. Повідомлення людей → orchestrator (Candidate → Company → Arbiter)
9. HR → POST /interviews/:id/end → Arbiter генерує звіт → ENDED
10. HR → GET /reports/:interviewId
```

**Обмеження MVP:** одна активна співбесіда на HR і одна на кандидата.

### Prep-логіка

- Агент веде діалог до достатнього збору даних
- Коли готовий — `readyForConfirmation: true` у відповіді API
- Користувач підтверджує → LLM генерує JSON-профіль → prep `isClosed = true`

### Room-логіка

- Arbiter модерує дискусію без Issues (немає списку тем)
- Arbiter може запропонувати завершення; HR підтверджує або завершує примусово

---

## REST API

```
POST   /auth/login                 # → { token, user }
GET    /auth/me                    # Bearer token required

POST   /interviews              # HR: створити → { code }
POST   /interviews/join         # Candidate: { code }
GET    /interviews/:id
POST   /interviews/:id/end      # HR: завершити → тригер звіту

POST   /prep/:interviewId/message
POST   /prep/:interviewId/confirm

GET    /reports/:interviewId
```

---

## Socket.IO (кімната)

| Event (client → server) | Дія |
|------------------------|-----|
| `room:join` | Увійти в кімнату (перевірка READY/LIVE) |
| `room:message` | Повідомлення людини → orchestrator |

| Event (server → client) | Дія |
|------------------------|-----|
| `room:messages` | Batch нових повідомлень |
| `room:status` | Зміна статусу interview |
| `room:error` | Помилка (LLM недоступна тощо) |

---

## LLM-шар

```typescript
interface LlmProvider {
  complete(messages: ChatMessage[], options?: LlmOptions): Promise<string>;
}
```

| Змінна | Опис |
|--------|------|
| `LLM_PROVIDER` | `ollama` (default) або `litellm` |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` у Docker |
| `OLLAMA_MODEL` | напр. `qwen2.5:7b` |
| `LITELLM_BASE_URL` | напр. `https://llm.7n.ai` |
| `LITELLM_API_KEY` | обов'язково для `litellm` |
| `LITELLM_MODEL` | напр. `gemini-3-flash-[crd]` |
| `JWT_SECRET` | мін. 8 символів |

Ollama не в Docker. API keys не комітити.

---

## Frontend views

| View | Роль | Призначення |
|------|------|-------------|
| `LoginView` | всі | Вхід |
| `HrDashboardView` | HR | Створити співбесіду, код, перехід до prep/room |
| `CandidateDashboardView` | Кандидат | Ввести код, перехід до prep/room |
| `PrepChatView` | обидва | Чат з агентом, «Підтвердити профіль» |
| `InterviewRoomView` | обидва | Спільний чат |
| `ReportView` | HR | Markdown-звіт |

Спільний `ChatPanel` для prep і room.

---

## Docker Compose

```yaml
services:
  postgres:    # PostgreSQL 16, порт 5432
  backend:     # Node 22, порт 3000
  frontend:    # порт 5173
```

### Seed-користувачі

```
candidate@test.com / 123456  (CANDIDATE)
hr@test.com / 123456         (HR)
```

---

## Обробка помилок

| Ситуація | Відповідь |
|----------|-----------|
| LLM недоступна | HTTP 503 / socket `room:error`, текст українською |
| Невалідний код join | 404 |
| Prep закритий | 409 при новому повідомленні |
| Співбесіда завершена | room read-only |

---

## Критерії готовності скелета

1. `docker compose up --build` піднімає postgres + backend + frontend
2. Login для обох seed-користувачів
3. HR створює співбесіду, отримує код
4. Кандидат приєднується за кодом
5. Prep-чат відповідає через Ollama або LiteLLM
6. Підтвердження профілю зберігає JSON
7. Після обох профілів — кімната доступна
8. Повідомлення в кімнаті запускають agent pipeline
9. HR завершує → markdown-звіт
10. README з швидким стартом і сценарієм перевірки

---

## Свідомо поза scope

- Issues / теми обговорення
- Бібліотека збережених анкет (`SavedProfile`)
- Історія співбесід
- Відмовні листи
- HR control rail
- oMLX-провайдер
- Стрімінг відповідей LLM
- Автоматизовані тести (окрім build + ручний сценарій)

---

## Технологічний стек

| Шар | Технології |
|-----|------------|
| Monorepo | npm workspaces |
| Frontend | Vue 3, Vite, Pinia, Vue Router, TypeScript |
| Backend | Node.js 22+, Express, TypeScript |
| База даних | PostgreSQL 16, Prisma ORM |
| Realtime | Socket.IO |
| AI | Ollama + LiteLLM (плагінований шар) |
| Auth | JWT (Bearer token у `Authorization` header) |
| Deploy | Docker Compose |

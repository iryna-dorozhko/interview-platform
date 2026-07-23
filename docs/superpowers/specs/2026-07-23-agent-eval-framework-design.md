# Agent Evaluation Framework — Design Spec

**Дата:** 2026-07-23  
**Статус:** Затверджено в brainstorming  
**Контекст:** Потрібен спосіб вимірювати ефективність змін агентів (промпти, retry, оркестратор) шляхом порівняння метрик співбесід за періодами часу  
**Передумови:** Live orchestrator, prep sessions, `FinalReport`, `InterviewDecision`, `withLlmRetry` / manual agent-retry  
**Мова:** Українська (документація); технічні ідентифікатори англійською

---

## Проблема

Після змін у агентах немає стабільного per-interview набору метрик для порівняння «до/після». Частина сигналів уже є в БД (`LiveSession`, messages, `FinalReport`, `InterviewDecision`), але:

- retry (auto/manual) і control-дії HR не персистяться як лічильники;
- «уточнюючі питання» не марковані в відповідях агентів;
- немає єдиного snapshot і зручного eng-доступу (API + CLI) для агрегатів за датами.

## Мета

1. Автоматично зберігати eval-snapshot на кожне інтерв’ю з ключовими метриками ефективності агентів.
2. Двофазно доповнювати snapshot після звіту і після HR decision.
3. Дати eng-only API і CLI для порівняння періодів (без UI для HR).

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Призначення | Аналіз ефективності змін агентів (не HR-фіча) |
| Прив’язка до змін | Лише за часом (`reportCreatedAt` / періоди) — без git SHA / eval labels |
| Етапи (тривалість) | Prep candidate + prep vacancy + live (цілком); без внутрішніх фаз live |
| Втручання HR | Усі `HUMAN_HR` у live + окремо control-дії (retry, end-session тощо) |
| Уточнюючі питання | Явний `kind: "clarifying"` у JSON відповіді агента |
| Фіналізація | Двофаза: partial після `FinalReport` → update після `InterviewDecision` |
| Споживач | Internal REST (`EVAL_API_TOKEN`) + CLI `eval:report` |
| Архітектура | Snapshot-таблиця + точкове інструментування (підхід 1) |

## Поза scope (MVP)

- Фронтенд-дашборд / екран у кабінеті HR
- Event-log (`AgentEvalEvent`) і довільна post-hoc аналітика з сирих подій
- Git SHA / `agentBundleVersion` / experiment labels
- Внутрішні фази live (intro / Q&A / wrap-up)
- Company-global prep (`PrepSessionCompany`) — у snapshot лише vacancy prep + candidate prep
- Надійний backfill auto/manual retry для інтерв’ю, що завершились до деплою
- Email / зовнішні observability-системи (Datadog тощо)

---

## Підходи (розглянуті)

### 1. Snapshot-таблиця + точкове інструментування (обрано)

`InterviewEvalSnapshot` 1:1 з `Interview`; runtime-лічильники для того, чого немає в історії; durations / HR messages / report / decision — з персистентних таблиць.

**Плюси:** простий аналіз «один рядок = одне інтерв’ю»; відповідає двофазі; CLI/API тривіальні.  
**Мінуси:** retry до деплою = 0; потрібні хуки в retry/orchestrator/agents.

### 2. Event log + агрегація (відхилено)

**Плюси:** гнучкість. **Мінуси:** overkill для MVP.

### 3. Лише post-hoc з існуючих таблиць (відхилено)

**Плюси:** мінімум схеми. **Мінуси:** немає retry і надійного `clarifying`.

---

## Модель даних

### `InterviewEvalSnapshot`

| Поле | Тип | Примітки |
|------|-----|----------|
| `id` | cuid | PK |
| `interviewId` | String @unique | FK → `Interview` |
| `prepCandidateDurationMs` | Int? | з `PrepSessionCandidate` |
| `prepVacancyDurationMs` | Int? | з `PrepSessionHr` вакансії інтерв’ю |
| `liveDurationMs` | Int? | `endedAt - startedAt`; null якщо live не завершено |
| `autoRetryCount` | Int @default(0) | кожна повторна спроба `withLlmRetry` (attempt > 1) у candidate prep + live |
| `manualRetryCount` | Int @default(0) | `room:agent-retry` + candidate prep UI retry (не vacancy prep) |
| `hrMessageCount` | Int @default(0) | `LiveMessage` з `HUMAN_HR` |
| `hrControlActionCount` | Int @default(0) | control-дії (не звичайний чат) |
| `clarifyingQuestionCount` | Int @default(0) | agent posts з `kind: "clarifying"` |
| `agentMessageCount` | Int @default(0) | опубліковані agent messages (знаменник) |
| `finalMatchScore` | Int? | з `FinalReport` |
| `arbiterRecommendation` | Recommendation? | з `FinalReport` |
| `hrDecisionType` | InterviewDecisionType? | останнє decision; null до фази 2 |
| `hrAgreedWithArbiter` | Boolean? | null до фази 2 |
| `reportCreatedAt` | DateTime? | для фільтра періодів |
| `decisionUpdatedAt` | DateTime? | час останнього оновлення decision-полів |
| `createdAt` / `updatedAt` | DateTime | службові |

Індекс: `(reportCreatedAt)` для діапазонних запитів.

### Правила тривалості prep

- **Candidate:** `PrepSessionCandidate` інтерв’ю: якщо `isClosed` — `updatedAt - createdAt` (момент close оновлює `updatedAt`); якщо не closed — null на фазі 1 (або ms до `now` лише якщо явно потрібно — **MVP: null якщо не closed**).
- **Vacancy:** те саме для `PrepSessionHr` вакансії (`interview.vacancyId`).
- **Live:** `LiveSession.endedAt - startedAt`; null якщо `endedAt` відсутній.

### Derived metric (не окреме поле)

`avgClarifyingRate` у summary = `sum(clarifyingQuestionCount) / sum(agentMessageCount)` (0, якщо знаменник 0). Per-interview rate = `clarifyingQuestionCount / agentMessageCount`.

---

## Інструментування і двофаза

### Runtime accumulator

Легкий per-`interviewId` стан (in-memory на процесі backend, з flush у БД):

- інкремент `autoRetryCount` коли `withLlmRetry` виконує **повторну** спробу (attempt > 1) у контексті `interviewId` (candidate prep + live);
- інкремент `manualRetryCount` на прийом manual retry: live `onAgentRetry`, candidate prep retry (не vacancy prep);
- інкремент `hrControlActionCount` на control-події: як мінімум `room:agent-retry` і end live session ініційований HR (окремо від `hrMessageCount`);
- при persist agent live message з `kind: "clarifying"` — `clarifyingQuestionCount++`; будь-яке опубліковане live agent message — `agentMessageCount++`.

Якщо snapshot-рядка ще немає — тримати лічильники в memory і влити їх у фазі 1 (або створювати soft row раніше — на розсуд plan; **контракт:** після фази 1 лічильники не втрачаються при рестарті лише якщо вже записані в snapshot; до фази 1 рестарт процесу може обнулити in-memory — прийнятно для MVP, зафіксувати в тестах як known limitation).

**Уточнення MVP для autoRetry у prep без interviewId (vacancy prep):** рахувати в snapshot інтерв’ю лише retries, прив’язані до `interviewId` (candidate prep + live). Vacancy-prep auto/manual retries **не** входять у per-interview snapshot (vacancy shared). Лише duration vacancy prep входить у рядок.

### Розширення схеми відповіді агентів (live)

Для Company / Candidate live (і Arbiter public messages, якщо публікує текст):

```json
{ "post": true, "message": "...", "kind": "clarifying" }
```

або `"kind": "normal"` / omit → `normal`. Парсери приймають опційне поле; промпти просять ставити `clarifying`, коли агент ставить уточнююче питання.

Prep-агенти: у MVP `kind` **опційний** (можна додати в тому ж PR, якщо формат відповіді дозволяє без ламання extract); якщо prep не маркує — clarifying рахується лише з live.

### Фаза 1 — після створення `FinalReport`

Upsert `InterviewEvalSnapshot`:

1. Зчитати durations з prep/live.
2. Злити runtime counters (+ перерахунок `hrMessageCount` з `LiveMessage`).
3. Записати `finalMatchScore`, `arbiterRecommendation`, `reportCreatedAt`.
4. Залишити `hrDecisionType` / `hrAgreedWithArbiter` / `decisionUpdatedAt` = null (або не чіпати, якщо вже були — не очікується).

### Фаза 2 — після create `InterviewDecision`

Оновити snapshot (останнє decision по `interviewId` за `createdAt`):

- `hrDecisionType`
- `hrAgreedWithArbiter` за таблицею agreement
- `decisionUpdatedAt = now()`

### Ізоляція помилок

Збій upsert/update eval **не** змінює HTTP/socket результат report/decision: log error, best-effort.

---

## Agreement HR ↔ арбітр

`hrAgreedWithArbiter = true` лише для пар:

| `arbiterRecommendation` | `hrDecisionType` |
|-------------------------|------------------|
| `HIRE` | `ACCEPT` |
| `REJECT` | `REJECT` |
| `MAYBE` | `ADDITIONAL_MEETING` |

Інші пари → `false`. Немає decision → `null`.

---

## API і CLI

### Env

- `EVAL_API_TOKEN` — обов’язковий для API; якщо не задано, eval routes відповідають **503** (не відкривати анонімно).

### Endpoints

`Authorization: Bearer <EVAL_API_TOKEN>` (невірний/відсутній токен → 401)

- `GET /api/eval/snapshots?from=<ISO>&to=<ISO>`  
  Фільтр по `reportCreatedAt`: **`from` inclusive, `to` exclusive**.  
  Відповідь: масив snapshot (+ `interviewId`).

- `GET /api/eval/summary?from=&to=`  
  Агрегати по тому ж фільтру:
  - count snapshots
  - count with decision
  - avg `prepCandidateDurationMs`, `prepVacancyDurationMs`, `liveDurationMs` (ігнорувати null)
  - avg / sum `autoRetryCount`, `manualRetryCount`, `hrMessageCount`, `hrControlActionCount`
  - clarifying rate (`sum clarifying / sum agent messages`)
  - avg `finalMatchScore`
  - agreement rate (`count agreed / count with non-null hrAgreedWithArbiter`)

Не використовує HR JWT; не в кабінеті кандидата/HR.

### CLI

`npm run eval:report -- --from=ISO --to=ISO [--json]`

- Читає Postgres через Prisma (скрипт у `scripts/` або `backend/scripts/`).
- Друкує summary; без `--json` — читабельна таблиця/текст; з `--json` — той самий payload що summary (+ опційно snapshots).

---

## Тестування

- Unit: `hrAgreedWithArbiter` mapping (усі 3×3 пари + null).
- Unit: duration helpers (closed/unclosed prep, live with/without `endedAt`).
- Unit: parse optional `kind` (`clarifying` / `normal` / omit).
- Unit/integration: фаза 1 upsert після report; фаза 2 після decision; повторне decision оновлює snapshot.
- Unit: помилка eval writer не прокидається з report/decision handler.
- CLI/API: фільтр `from`/`to` (за наявності легкого test harness).

Без обов’язкового Playwright e2e (немає UI).

---

## Файли (орієнтовно)

| Зона | Зміни |
|------|--------|
| `backend/prisma/schema.prisma` | модель `InterviewEvalSnapshot` |
| `backend/src/services/interview-eval.ts` (або подібне) | upsert фаза 1/2, agreement, durations, summary |
| Orchestrator / `withLlmRetry` / room | інкременти counters |
| Live agent parsers + prompts | опційний `kind` |
| Report + decision routes | хуки фаз |
| `backend/src/routes/eval.ts` | snapshots + summary |
| `scripts/eval-report.mjs` (або ts) + `package.json` | CLI |

---

## Успіх MVP

Після кількох завершених співбесід можна за період A vs B порівняти: тривалості prep/live, retries, HR messages/controls, clarifying rate, match, agreement rate — без ручного розбору чатів.

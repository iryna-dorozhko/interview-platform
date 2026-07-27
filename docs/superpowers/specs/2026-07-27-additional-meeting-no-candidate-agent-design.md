# Додаткова зустріч без Candidate Agent — Design Spec

**Дата:** 2026-07-27  
**Статус:** Затверджено в brainstorming  
**Передумови:** `docs/superpowers/specs/2026-07-27-additional-meeting-followup-live-agent-design.md` (`Interview.kind`, follow-up Company Agent)

## Контекст і мета

У додатковій зустрічі (`Interview.kind = ADDITIONAL_MEETING`) Candidate Agent майже не виконує ролі: відповіді з анкети вже недостатні для follow-up по ризиках, а `unknown` лише відкладає відповідь живій людині.

**Мета:** у live-кімнаті додаткової зустрічі залишити Company Agent, Arbiter, HR і живого кандидата; Candidate Agent не викликати і не показувати в UI статусів.

**Поза scope:**

- Вимкнення Candidate Agent у STANDARD live
- Зміни prep / questionnaire Candidate Agent
- Зміни логіки follow-up питань Company Agent (вже в попередньому spec)

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Scope | Лише `ADDITIONAL_MEETING` |
| Підхід | Arbiter nudge + orchestrator hard skip + UI hide |

## Поведінка live

Учасники, що публікують у чат: `AGENT_COMPANY`, `AGENT_ARBITER` (якщо publicMessage), `HUMAN_HR`, `HUMAN_CANDIDATE`.

Candidate Agent:

- не викликається (`runCandidateLiveTurn` не виконується);
- не публікує повідомлення;
- не з’являється в панелі «AI-процеси».

Потік після питання Company: Arbiter → `WAIT` (чекаємо `HUMAN_CANDIDATE` або HR). Дії `ANSWER` / `CANDIDATE_QUESTIONS` у follow-up режимі не використовуються.

## Backend

### Arbiter

У `runArbiterTurn` читати `interview.kind`. Якщо `ADDITIONAL_MEETING`, додати follow-up nudge до messages:

- немає Candidate Agent;
- після відкритого питання Company — `WAIT` на живу людину / HR;
- не видавати `ANSWER` / `CANDIDATE_QUESTIONS`.

Для `STANDARD` — поточний prompt без змін.

### Orchestrator (hard guardrail)

Перед гілкою `runCandidateActions`: якщо interview `ADDITIONAL_MEETING` і action `ANSWER` або `CANDIDATE_QUESTIONS` — пропустити виклик Candidate Agent, зберегти `pendingQuestion = true` для `ANSWER` (чекати людину), без `room:agent-error`.

Потрібно завантажити `kind` разом із room state / на початку conductor loop (один lookup на turn достатньо).

## Frontend

- Interview detail / room уже може мати `kind` з DTO.
- `AgentStatusPanel`: якщо `kind === ADDITIONAL_MEETING`, не рендерити рядок «Кандидат (AI)».
- Історичні стилі `AGENT_CANDIDATE` лишаються (на випадок старих повідомлень); у нових additional-кімнатах їх не буде.

## Тестування

**Backend**

- Orchestrator: `ADDITIONAL_MEETING` + `ANSWER` → Candidate mock не викликається; `pendingQuestion` лишається true.
- Arbiter `buildArbiterMessages` / turn context: follow-up nudge лише для additional.
- STANDARD: поведінка Candidate Agent без регресії (існуючі тести).

**Frontend**

- `npm run build`
- Панель агентів без «Кандидат (AI)» для additional (ручна / візуальна перевірка).

## Звʼязок із кодом

- `backend/src/socket/orchestrator.ts`
- `backend/src/agents/arbiter-agent.ts`, `prompts/arbiter-agent.uk.ts`
- `frontend/src/components/AgentStatusPanel.vue`
- `frontend/src/composables/useInterviewRoom.ts` / room views (прокинути `kind`)

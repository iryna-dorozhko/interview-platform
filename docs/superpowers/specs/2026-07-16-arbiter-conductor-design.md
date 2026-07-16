# Arbiter Conductor — Design Spec

**Дата:** 2026-07-16  
**Статус:** Затверджено в brainstorming  
**Контекст:** Live-чат мовчить після старту; потрібна модель «Arbiter-диригент»  
**Передумови:** Дні 15–18 (live-чат, orchestrator, Arbiter, Company/Candidate live agents)  
**Мова:** Українська (публічні повідомлення, `summaryUk`, промпти)

---

## Проблема

Поточний pipeline `Human → debounce → Arbiter → Company → Candidate` дає кожному агенту самостійно вирішувати `post:true/false`. Часто всі обирають мовчання. Крім того, Arbiter біжить **до** відповіді Candidate і не може в тому ж ході оцінити відповідь і дати сигнал на наступне питання.

## Мета

Arbiter аналізує хід і диригує Company/Candidate через **приховані структуровані команди**. HR бачить коротку стрічку процесів; кандидат — лише статус «AI думає…». Після питання одразу йде відповідь; після відповіді — наступне питання або уточнення — у межах одного conductor-loop.

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Підхід | **1** — структуровані команди Arbiter + selective run + легкий `pendingQuestion` |
| Формат сигналу | Прихований; HR бачить `summaryUk` у панелі |
| Видимість панелі | HR — повністю; кандидат — лише thinking |
| Хто відповідає | Candidate Agent з профілю; інакше просить живу людину |
| Черга | Спочатку закрити відкрите питання (`ANSWER`) |
| Після відповіді | `NEXT_QUESTION` або `CLARIFY`; теми вичерпано → `CANDIDATE_QUESTIONS` |

## Архітектура

### Conductor-loop

Після human message / `onLiveStart` (debounce):

1. Arbiter повертає команду.
2. Emit `room:arbiter-process` (`action`, `summaryUk`).
3. Якщо є `publicMessage` — зберегти як `AGENT_ARBITER` у чат.
4. Запустити лише цільового агента (Company або Candidate) з `turnContext`.
5. Повторити з кроку 1, доки `WAIT` / `SUGGEST_END`, скасування `generation`, або `MAX_CONDUCTOR_STEPS = 6`.

Кожен LLM-виклик (Arbiter або live-агент) рахується як крок.

### Контракт Arbiter

```ts
type ArbiterAction =
  | "START" | "ANSWER" | "NEXT_QUESTION" | "CLARIFY"
  | "CANDIDATE_QUESTIONS" | "WAIT" | "SUGGEST_END";

type ParsedArbiterCommand = {
  action: ArbiterAction;
  summaryUk: string;
  briefUk?: string;
  publicMessage?: string; // START / SUGGEST_END
};
```

| action | Публічно Arbiter? | Далі |
|--------|-------------------|------|
| `START` | так (`publicMessage`) | Company (`NEXT_QUESTION`) |
| `ANSWER` | ні | Candidate |
| `NEXT_QUESTION` / `CLARIFY` | ні | Company |
| `CANDIDATE_QUESTIONS` | ні | Candidate (режим питань) |
| `WAIT` | ні | стоп |
| `SUGGEST_END` | так | стоп |

### `pendingQuestion` (in-memory `RoomState`)

- `true` після збереженого публічного повідомлення Company.
- `false` перед запуском Company на `NEXT_QUESTION` / `START` / при `CANDIDATE_QUESTIONS` / `SUGGEST_END` (оцінка закрила попередню відповідь).
- `CLARIFY`: після поста Company знову `true` (чекаємо відповідь на уточнення).
- Передається в Arbiter як nudge; без Prisma-міграцій.

### Company / Candidate

Викликаються лише з командою Arbiter. Очікування: майже завжди одне публічне повідомлення (`post:true`). `post:false` — аварійний випадок.

- Company: `NEXT_QUESTION` / `CLARIFY` (+ після `START`).
- Candidate: `ANSWER` (профіль або defer to human); `CANDIDATE_QUESTIONS`.

### UI / сокети

- Нова подія: `room:arbiter-process` `{ at, action, summaryUk }`.
- HR: стрічка в `AgentStatusPanel` (останні ~8 записів).
- Кандидат: без деталей; лишається `room:agent-thinking`.

### Помилки

- Невалідна команда Arbiter → `room:agent-error`; цільовий агент не запускається.
- Падіння Company/Candidate → error для агента; `pendingQuestion` не ламаємо безпідставно.
- Нове human message → `generation++`, loop обривається.

## Поза scope

- Кнопки HR override
- Prisma fields / повна FSM у БД
- Зміна Final Report
- Стрімінг LLM

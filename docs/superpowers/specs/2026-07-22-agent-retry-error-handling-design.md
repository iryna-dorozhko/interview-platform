# Agent Retry & Error Handling — Design Spec

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming  
**Контекст:** Агенти епізодично «падають» посеред розмови (Day 14); чат зависає на «Думаю…» або показує сиру/незрозумілу помилку  
**Передумови:** LLM providers, prep routes, live orchestrator (`room:agent-error` / `room:agent-thinking`)  
**Мова:** Українська (повідомлення для людини в UI)

---

## Проблема

У довгих prep- і live-діалогах LLM-виклики інколи падають (таймаут, 429, мережева помилка, порожня або невалідна відповідь). Зараз:

- автоматичний retry є лише для Gemini rate-limit (429);
- OpenAI / OMLX / Cursor ACP не повторюють transient збої;
- parse/JSON помилки агентів не повторюються;
- після збою людина часто бачить зависання thinking або загальний банер без явного «повторити саме цей крок».

Для продуктової надійності потрібні контрольовані повтори й зрозуміла помилка з можливістю ручного retry.

## Мета

1. Автоматично повторити агентний запит при тимчасових збоях і поганій відповіді моделі.
2. Якщо спроби вичерпано — зняти thinking і показати короткий український текст помилки.
3. Дати кнопку «Спробувати ще раз», яка повторює **останній невдалий** запит/turn (не нове людське повідомлення).

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Скоуп першої ітерації | Prep (Candidate + Company/Vacancy) **і** live |
| Що retry | Transient LLM + empty/parse + кнопка після вичерпання |
| Хто бачить кнопку | Candidate Prep → кандидат; Company/Vacancy Prep і live → лише HR |
| Live retry | Повторити саме останній failed agent turn (`A`) |
| Підхід | Спільний шар retry + `lastFailedTurn` у live (`підхід 3`) |

## Поза scope (перша ітерація)

- Vacancy match, final report та інші one-shot агентні пайплайни
- Автозміна `LLM_PROVIDER` / fallback на інший провайдер
- Окремий UI-стан «Повторюємо спробу…» (під час авто-retry лишається «Думаю…»)
- Persist `lastFailedTurn` у БД (достатньо in-memory `RoomState`)

---

## Архітектура

### Шар A — `withLlmRetry` (backend)

Спільний helper навколо виклику, що може впасти через LLM або парсинг відповіді агента.

**Повторювати (до 3 спроб, короткий backoff):**

- мережа / таймаут;
- HTTP 429, 5xx;
- `LlmUnavailableError`;
- `LlmEmptyResponseError`;
- parse / JSON помилки відповіді агента (`*ReplyParseError`, `*ExtractionError` тощо, де відповідь моделі невалідна).

**Не повторювати:**

- 401 / 403 / валідація вводу;
- відсутній бізнес-контекст (напр. немає company profile);
- сесія закрита / interview `ENDED` / інші бізнес-конфлікти.

**Після вичерпання:** кидати помилку з **safe** українським повідомленням для клієнта; технічний detail — лише в логах.

**Єдина точка лічильника спроб:** `withLlmRetry` володіє max 3 attempts. Внутрішній цикл retry у Gemini provider прибираємо (один `complete()` = один HTTP-виклик). Парсер `Please retry in Xs` експортуємо/використовуємо в `withLlmRetry` як delay для 429, щоб не було «retry × retry».

### Шар B — Prep (HTTP)

Маршрути Candidate Prep, Company Prep, Vacancy Prep:

1. User message (якщо є) зберігається як зараз.
2. LLM + parse обгортаються в `withLlmRetry`.
3. Успіх → agent reply у БД + 200.
4. Фінальна помилка → 502/503 + `{ error: "<safe uk>" }` (без stack / raw provider body у `error` для UI; `detail` опційно лише для логів/dev, не показувати в банері).

**Ручний retry (контракт):** фронт зберігає `lastFailedAction` (`send` | `finish` | інший агентний POST, що впав). Кнопка **не** робить новий `POST` з тим самим текстом повідомлення (це задублювало б user message в БД). Натомість:

- для `send` після збереженого user message без agent reply — окремий idempotent retry endpoint (або узгоджений існуючий «regenerate last agent reply»), який лише повторює LLM + запис agent message;
- для `finish` / extract — повтор того самого finish/extract без нового chat message.

Фронт:

- знімає `sending` / «Думаю…»;
- показує банер + кнопку «Спробувати ще раз» (роль — див. вище);
- кнопка викликає retry за `lastFailedAction`;
- під час retry кнопка `disabled`, знову «Думаю…».

### Шар C — Live (socket + orchestrator)

Розширити in-memory `RoomState`:

```ts
type LastFailedTurn = {
  agentType: "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";
  generation: number;
  pendingQuestion: boolean;
  /** Обов’язково для COMPANY/CANDIDATE — команда Arbiter на момент падіння */
  command?: ParsedArbiterCommand;
};
```

Потік при падінні turn:

1. Авто-retry через шар A.
2. Якщо все одно fail → `emitThinking(false)` → `room:agent-error` (safe uk) → зберегти `lastFailedTurn`.
3. Нова подія `room:agent-retry` (авторизація: лише HR у цій кімнаті):
   - якщо немає `lastFailedTurn` або вже йде виконання → ігнор / помилка;
   - інакше повторити саме цей agent turn (без нового human message);
   - увімкнути thinking; при успіху очистити error + `lastFailedTurn`.
4. Кандидат отримує той самий `room:agent-error`, але UI без кнопки.
5. Нове human message / успішний turn очищає помилку й `lastFailedTurn` (як і зараз thinking скидається на agent messages).

Захист від подвійного кліку: перевірка «turn уже виконується» + `generation`, як у поточному orchestrator.

---

## UX

| Стан | Поведінка |
|------|-----------|
| Авто-retry | Лишається «Думаю…» / agent thinking |
| Fail після спроб | Thinking off + банер українською |
| Банер (типовий) | «AI тимчасово не відповів. Можна спробувати ще раз.» |
| Rate limit | Допустимий більш конкретний safe-текст (як існуючий про ліміт) |
| Кнопка | Candidate Prep → кандидат; Company/Vacancy + live → HR |
| Live кандидат | Банер без кнопки |
| Успіх / нове human message | Банер і failed-turn скидаються |

---

## Логування

- Кожна невдала спроба: `warn` з provider, route/agent, `attempt`.
- Фінальна помилка: `error` з detail (не на клієнт у банері).

---

## Тестування

1. **Unit `withLlmRetry`:** retry на transient/empty/parse; no-retry на auth/validation/context; max attempts; backoff.
2. **Prep routes:** 2 fail + 1 success → 200; 3 fail → 503 + safe `error`; повтор не дублює user message.
3. **Orchestrator:** fail → `agent-error` + `lastFailedTurn`; HR `room:agent-retry` → повтор turn; candidate emit ігнорується / без права; подвійний retry не запускає два паралельні turn.
4. **Frontend (smoke/компонент за потреби):** банер + кнопка за роллю; thinking скидається на error.

---

## Success criteria

- Епізодичні transient/parse збої в prep і live здебільшого самовідновлюються без дії людини.
- Після вичерпання спроб UI ніколи не лишається у вічному «Думаю…».
- HR у live може одним кліком повторити саме зірваний agent turn.
- Кандидат у Candidate Prep має кнопку retry; у live — лише зрозумілий банер.
- Клієнт не бачить сирих provider/stack повідомлень у банері.

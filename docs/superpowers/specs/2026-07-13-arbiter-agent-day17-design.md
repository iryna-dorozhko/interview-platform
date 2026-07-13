# Arbiter Agent — Day 17 Design Spec

**Дата:** 2026-07-13  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 17 плану розробки (README) — «Arbiter керує розмовою»  
**Передумови:** Дні 15–16 (live-чат, orchestrator з stub Arbiter)  
**Мова:** Українська (повідомлення Arbiter, промпт)

---

## Контекст і мета

MVP уже має:

- Live-кімнату HR ↔ кандидат через Socket.IO (`backend/src/socket/room.ts`)
- `LiveSession` / `LiveMessage` з `LiveAuthorType` (`HUMAN_HR`, `HUMAN_CANDIDATE`, `AGENT_ARBITER`, …)
- `RoomOrchestrator` з debounce 2.5 с, generation counter, `room:agent-thinking` (`backend/src/socket/orchestrator.ts`)
- Stub Arbiter (`backend/src/agents/stub-arbiter.ts`) — echo-відповідь після debounce
- Підтверджені профілі: `CompanyProfile` (via `Vacancy`) і `CandidateProfile` (via `Interview`)
- Патерн prep-агентів: `company-agent.ts`, `candidate-agent.ts`, `prompts/*.uk.ts`, LLM через `createLlmProvider()`

**Мета Дня 17:** замінити stub на справжній LLM-Arbiter, який модерує live-розмову — стежить за темою, не дає зациклитись, пропонує рух далі.

**Поза scope:**

- Company / Candidate agents у live-чаті (День 18)
- Завершення співбесіди / фінальний звіт Arbiter (пізніші дні)
- Зміни Prisma-схеми
- Зміни frontend (UI вже підтримує Arbiter)
- Стрімінг LLM

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Коли публікувати | **B** — аналізує завжди, публікує лише коли є що сказати (офтоп, зациклення, підсумок, напрямок) |
| Контекст профілів | **A** — обидва підтверджені профілі (Company + Candidate) у system prompt |
| Формат відповіді LLM | **B** — строгий JSON: `{ "post": false }` або `{ "post": true, "message": "..." }` |
| Історія чату | **A** — вся історія live-сесії від початку |
| Архітектура | **1** — окремий `arbiter-agent.ts` + мінімальна зміна orchestrator |

---

## Підходи (розглянуті)

### 1. Окремий `arbiter-agent.ts` + мінімальна зміна orchestrator (обрано)

Новий модуль за патерном prep-агентів. Orchestrator замінює `runStubArbiter` на `runArbiterTurn()`.

**Плюси:** відповідає існуючій архітектурі; тестовано окремо; готовність до Day 18 (ланцюжок агентів).  
**Мінуси:** orchestrator трохи розшириться (завантаження контексту).

### 2. Inline LLM-виклик у orchestrator (відхилено)

**Плюси:** менше файлів.  
**Мінуси:** orchestrator роздується; важко тестувати; Day 18 додасть ще два агенти.

### 3. Окремий `ArbiterService`-клас (відхилено)

**Плюси:** чисте розділення.  
**Мінуси:** over-engineering; відрізняється від патерну prep-агентів у проєкті.

---

## Архітектура і потік даних

```
Human message (room.ts)
  → orchestrator.onHumanMessage()
  → debounce 2.5s (generation counter — без змін)
  → runArbiterTurn():
      1. Завантажити interview → vacancy → CompanyProfile (confirmed)
      2. Завантажити CandidateProfile (confirmed)
      3. Завантажити всю історію LiveMessage сесії
      4. buildArbiterMessages(profiles, history)
      5. LLM → parseArbiterReply(raw)
      6. post=true  → зберегти AGENT_ARBITER + room:messages
         post=false → нічого не публікувати (thinking зникає)
```

**Обмеження «макс. 1 публічне повідомлення за хід»:** orchestrator викликає лише Arbiter (Day 17); один LLM-виклик → 0 або 1 `LiveMessage`. Day 18 додасть Company і Candidate послідовно — кожен max 1.

**Stub:** `stub-arbiter.ts` залишається для unit-тестів orchestrator (injectable `runAgent`); production-шлях використовує LLM.

---

## Файли

```
backend/src/agents/
  arbiter-agent.ts              # buildArbiterMessages, parseArbiterReply, runArbiterTurn
  arbiter-agent.test.ts
  prompts/
    arbiter-agent.uk.ts         # system prompt
  stub-arbiter.ts               # без змін — для тестів orchestrator

backend/src/socket/
  orchestrator.ts               # замінити runStubArbiter на runArbiterTurn
  orchestrator.test.ts          # + тест post:false
```

---

## System prompt (`arbiter-agent.uk.ts`)

Arbiter — **нейтральний модератор співбесіди**, не учасник дискусії.

**Роль:**

- Стежить за темою співбесіди (на основі профілів компанії та кандидата)
- Помічає зациклення та офтоп
- Пропонує рух далі (підсумок, напрямок)

**Обмеження:**

- Усі публічні повідомлення — виключно українською
- Не ставить питання замість HR чи кандидата
- Не оцінює кандидата
- Не вигадує факти

**Коли `post: true`:**

- Розмова пішла в офтоп
- Учасники повторюють одне й те саме (зациклення)
- Корисний підсумок або пропозиція наступного кроку

**Коли `post: false`:**

- Розмова рухається природно по темі співбесіди

**Контекст у system prompt (JSON-текстом):**

- `CompanyProfile`: role, requirements, culture, expectations
- `CandidateProfile`: summary, experience, skills, goals

---

## Формат відповіді LLM

Строгий JSON, без markdown-обгортки:

```json
{ "post": false }
```

```json
{ "post": true, "message": "Короткий коментар українською..." }
```

### `parseArbiterReply(rawText)`

- Знімає markdown code fences якщо є (як у profile extraction)
- Валідує: `post` — обов'язковий boolean
- Якщо `post: true` — `message` обов'язковий непорожній рядок
- Якщо `post: false` — `message` ігнорується
- При невалідному JSON — кидає `ArbiterReplyParseError`

Повертає:

```typescript
interface ParsedArbiterReply {
  post: boolean;
  message?: string;
}
```

---

## Історія чату в LLM

Уся `LiveMessage` сесії хронологічно, з мітками автора:

| `LiveAuthorType` | role в LLM | prefix |
|------------------|------------|--------|
| `HUMAN_HR` | user | `[HR]` |
| `HUMAN_CANDIDATE` | user | `[Кандидат]` |
| `AGENT_ARBITER` | assistant | — |
| `AGENT_COMPANY` | assistant | — |
| `AGENT_CANDIDATE` | assistant | — |

Останнє повідомлення — завжди від людини (тригер ходу). Agent-повідомлення (Arbiter, Day 18+) включаються в історію як assistant.

---

## Зміни в orchestrator

- `RoomOrchestratorOptions.runAgent` замінюється на injectable `runArbiterTurn` (для тестів)
- Production: `runArbiterTurn(prisma, interviewId, sessionId, llmProvider)`
- Якщо `post: false` — не створювати `LiveMessage`, лише `room:agent-thinking → active: false`
- Якщо `post: true` — зберегти `AGENT_ARBITER` з `message`, emit `room:messages`
- Debounce, generation counter, перевірка `LIVE` — без змін
- `room:agent-thinking` — без змін (`agentType: "AGENT_ARBITER"`)

---

## Обробка помилок

| Ситуація | Поведінка |
|----------|-----------|
| LLM повернув невалідний JSON | `console.error`; не публікувати; thinking → false |
| LLM timeout / мережева помилка | Те саме — мовчки |
| Профілі відсутні | Не має статися при `LIVE`; якщо все ж — log + skip turn |
| Generation counter скасував хід | Discard результат (як зараз) |
| `post: true` але порожній `message` | Parse error → не публікувати |

Arbiter **ніколи не ламає чат** — worst case просто мовчить.

---

## UI

**Без змін у Day 17.** `LiveChatPanel` вже показує Arbiter і «Arbiter думає…». Якщо `post: false`, індикатор зникає без нового повідомлення.

---

## Тести

### `arbiter-agent.test.ts`

- `parseArbiterReply`: валідний `{ post: false }`, `{ post: true, message: "..." }`
- JSON у code fence
- невалідний JSON → throw
- `post: true` без message → throw
- `buildArbiterMessages`: system prompt містить профілі; history з правильними prefix/role

### `orchestrator.test.ts` (оновити)

- `post: true` → 1 `AGENT_ARBITER` message
- `post: false` → 0 agent messages, thinking вимикається
- generation cancel — без змін (існуючий тест)

---

## Definition of Done (README Day 17)

- [ ] Демонстрація: Arbiter пише осмислені коментарі (підсумки, напрямки) коли `post: true`
- [ ] Сценарій: після повідомлення людини Arbiter відповідає не більше одного разу (або 0); коментарі модерують тему
- [ ] Збірка: `npm run build` проходить
- [ ] README: роль Arbiter у кімнаті, промпт-файл, JSON-формат, оновлений pipeline

---

## Підготовка до Day 18

Orchestrator має бути готовий до розширення ланцюжка:

`Human → Arbiter → Company → Candidate`

Day 17 закладає:

- `runArbiterTurn` як перший крок у майбутньому `executeAgentChain()`
- Історія live-чату вже включає типи `AGENT_COMPANY` / `AGENT_CANDIDATE`
- Кожен агент — окремий модуль з власним промптом і парсером

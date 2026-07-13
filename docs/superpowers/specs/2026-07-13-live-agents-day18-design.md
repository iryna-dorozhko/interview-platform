# Company і Candidate Agent у live-чаті — Day 18 Design Spec

**Дата:** 2026-07-13  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 18 плану розробки (README) — «Усі три агенти відповідають у live-чаті»  
**Передумови:** Дні 15–17 (live-чат, orchestrator, LLM Arbiter)  
**Мова:** Українська (повідомлення агентів, промпти)

---

## Контекст і мета

MVP уже має:

- Live-кімнату HR ↔ кандидат через Socket.IO (`backend/src/socket/room.ts`)
- `LiveSession` / `LiveMessage` з `LiveAuthorType` (`HUMAN_HR`, `HUMAN_CANDIDATE`, `AGENT_ARBITER`, `AGENT_COMPANY`, `AGENT_CANDIDATE`)
- `RoomOrchestrator` з debounce 2.5 с, generation counter, `room:agent-thinking` (`backend/src/socket/orchestrator.ts`)
- LLM Arbiter з JSON `{ post, message }` (`backend/src/agents/arbiter-agent.ts`)
- Підтверджені профілі: `CompanyProfile` (via `Vacancy`) і `CandidateProfile` (via `Interview`)
- Prep-агенти (`company-agent.ts`, `candidate-agent.ts`) — збір профілів через HTTP, не в live
- UI: `LiveChatPanel` вже підтримує всі `authorType` і стилі `.agent`

**Мета Дня 18:** після повідомлення людини запускати повний ланцюжок агентів — Arbiter модерує, Company ставить питання з профілю компанії, Candidate відповідає від імені кандидата лише з його профілю.

**Концепція співбесіди:**

1. Люди заходять і вітаються.
2. Arbiter дає сигнал початку інтерв'ю.
3. Company Agent стає основним інтерв'юером — питає з профілю компанії.
4. Candidate Agent відповідає від імені кандидата з профілю; якщо відповіді немає — просить живого кандидата (природна мова).
5. HR може також ставити питання; Candidate відповідає і на них, якщо знає відповідь з профілю.
6. Arbiter стежить за зацикленням, аналізує розмову (для майбутнього звіту), може запропонувати завершення текстом у чаті.
7. Реальне завершення (`ENDED`) — кнопка HR (День 19) + endpoint і звіт (День 20).

**Поза scope:**

- Кнопка HR «Завершити співбесіду» (День 19)
- `POST /interviews/:id/end`, генерація `FinalReport` (День 20)
- Зміни Prisma-схеми
- Блокування composer під час роботи агентів
- Стрімінг LLM
- Окремий `authorType` для defer-to-human (використовується природна мова в `AGENT_CANDIDATE`)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Завершення співбесіди | **C** — Arbiter пропонує в чаті; HR підтверджує кнопкою (Дні 19–20) |
| Defer to human (немає відповіді в профілі) | **A** — природна мова в тому ж повідомленні |
| Поведінка під час вітання | **C** — Arbiter керує переходом; Company чекає сигналу старту |
| Формат відповіді LLM | **A** — JSON `{ post, message }` для всіх трьох агентів |
| Candidate відповідає на питання HR | Так — якщо відповідь є в профілі |
| Архітектура | **1** — окремі live-модулі + ланцюжок в orchestrator |

---

## Підходи (розглянуті)

### 1. Окремі live-модулі + ланцюжок в orchestrator (обрано)

Нові `company-live-agent.ts`, `candidate-live-agent.ts` за зразком `arbiter-agent.ts`. Orchestrator розширюється до послідовного `executeAgentChain()`.

**Плюси:** відповідає Day 17; окремі промпти; легко тестувати; prep-агенти не чіпаємо.  
**Мінуси:** спільний JSON-парсер виноситься в утиліту.

### 2. Розширити існуючі prep-агенти (відхилено)

**Плюси:** менше файлів.  
**Мінуси:** prep (збір профілю) і live (інтерв'ю) — різні ролі; файли роздуваються.

### 3. Один `live-agents.ts` з параметром ролі (відхилено)

**Плюси:** один файл.  
**Мінуси:** погана межа відповідальності; три різні промпти в одному модулі.

---

## Архітектура і pipeline

```
Людина пише → debounce 2.5s
  → Arbiter  (0 або 1 msg)  — модерація, сигнал старту, пропозиція завершення
  → Company  (0 або 1 msg)  — питання з профілю (лише після сигналу Arbiter)
  → Candidate (0 або 1 msg) — відповідь з профілю
```

**Порядок:** `Human → Arbiter → Company → Candidate`

### Правила ланцюжка

- Кожен агент — max 1 публічне повідомлення за хід
- `post: false` → крок пропускається; наступний агент бачить оновлену історію
- Нове людське повідомлення → generation counter скасовує весь ланцюжок (як зараз)
- `room:agent-thinking` показує поточного агента послідовно
- Помилка одного кроку не зупиняє ланцюжок — наступні агенти все одно запускаються

### Arbiter

- Аналізує завжди; публікує лише коли є що сказати (`post: true`)
- Після вітання — сигнал старту співбесіди (текст у чаті, напр. «Давайте почнемо співбесіду»)
- Стежить за зацикленням і офтопом
- Може запропонувати завершення текстом у чаті (без зміни статусу interview)
- Промпт оновлюється мінімально (додати сигнал старту і пропозицію завершення)

### Company Live

- Публікує **одне** питання за хід з профілю компанії
- `post: false`, поки в історії немає сигналу старту від Arbiter
- Не дублює питання, яке HR щойно поставив
- Може `post: false`, якщо HR уже веде діалог питанням
- Не вигадує факти поза профілем

### Candidate Live

- Відповідає **від імені кандидата** (перша особа) **лише** з `CandidateProfile`
- Публікує (`post: true`), коли:
  1. Company задала питання в цьому ході → відповідь з профілю
  2. HR задав питання (тригерне `HUMAN_HR` повідомлення) → відповідь з профілю, якщо знає
- Якщо питання є, але даних у профілі немає → `post: true` з проханням до живого кандидата (природна мова)
- Якщо питання немає → `post: false`
- **Заборонено** вигадувати досвід, навички, проєкти

**Пріоритет питань** (якщо в одному ході є обидва):

1. Питання Company (щойно опубліковане в цьому ході)
2. Останнє питання HR (тригерне людське повідомлення)

---

## Файли

```
backend/src/agents/
  agent-post-reply.ts              # спільний parsePostReply (винесено з arbiter-agent)
  agent-post-reply.test.ts
  arbiter-agent.ts                  # використовує parsePostReply; промпт оновлюється
  company-live-agent.ts             # buildCompanyLiveMessages, runCompanyLiveTurn
  company-live-agent.test.ts
  candidate-live-agent.ts           # buildCandidateLiveMessages, runCandidateLiveTurn
  candidate-live-agent.test.ts
  prompts/
    arbiter-agent.uk.ts             # + сигнал старту, пропозиція завершення
    company-live-agent.uk.ts        # інтерв'юер з профілю компанії
    candidate-live-agent.uk.ts      # відповідає від імені кандидата

backend/src/socket/
  orchestrator.ts                   # executeAgentChain: Arbiter → Company → Candidate
  orchestrator.test.ts            # + тести ланцюжка
  types.ts                          # RoomAgentThinkingEvent + AGENT_COMPANY/CANDIDATE

frontend/src/components/
  LiveChatPanel.vue                 # thinkingLabel для Company і Candidate
```

Prep-агенти (`company-agent.ts`, `candidate-agent.ts`, `prompts/company-agent.uk.ts`, `prompts/candidate-agent.uk.ts`) **не змінюються**.

---

## Формат відповіді LLM (спільний для всіх агентів)

Строгий JSON, без markdown-обгортки:

```json
{ "post": false }
```

```json
{ "post": true, "message": "Текст повідомлення українською..." }
```

### `parsePostReply(rawText)` (`agent-post-reply.ts`)

- Знімає markdown code fences якщо є
- Валідує: `post` — обов'язковий boolean
- Якщо `post: true` — `message` обов'язковий непорожній рядок
- Якщо `post: false` — `message` ігнорується
- При невалідному JSON — кидає `AgentPostReplyParseError`

```typescript
interface ParsedPostReply {
  post: boolean;
  message?: string;
}
```

`arbiter-agent.ts` реекспортує `parseArbiterReply` як alias або використовує `parsePostReply` напряму.

---

## Промпти

### Company Live (`company-live-agent.uk.ts`)

- AI-представник компанії на співбесіді
- Контекст: `CompanyProfile` (role, requirements, culture, expectations) у system prompt
- Ставить **одне** питання за хід на основі профілю
- Не публікує, поки Arbiter не дав сигнал старту в історії чату
- Не повторює питання HR
- Усі повідомлення — виключно українською
- Формат відповіді: JSON `{ post, message }`

### Candidate Live (`candidate-live-agent.uk.ts`)

- Відповідає від імені кандидата (перша особа)
- Контекст: `CandidateProfile` (summary, experience, skills, goals) у system prompt
- Відповідає на питання Company або HR, якщо відповідь є в профілі
- Якщо питання є, але даних немає — просить живого кандидата відповісти самому (природна мова)
- Ніколи не вигадує факти
- Усі повідомлення — виключно українською
- Формат відповіді: JSON `{ post, message }`

### Arbiter (оновлення `arbiter-agent.uk.ts`)

Додати до існуючого промпту:

- Після вітання — дати сигнал початку співбесіди
- Коли теми вичерпано — запропонувати завершення (лише текст, без зміни статусу)
- Стежити, щоб Company/Candidate не повторювали одне питання/відповідь

---

## Історія чату в LLM

Уся `LiveMessage` сесії хронологічно (як у Arbiter Day 17):

| `LiveAuthorType` | role в LLM | prefix |
|------------------|------------|--------|
| `HUMAN_HR` | user | `[HR]` |
| `HUMAN_CANDIDATE` | user | `[Кандидат]` |
| `AGENT_ARBITER` | assistant | — |
| `AGENT_COMPANY` | assistant | — |
| `AGENT_CANDIDATE` | assistant | — |

Повідомлення агентів, опубліковані в поточному ході, включаються в історію для наступних кроків ланцюжка.

---

## Зміни в orchestrator

### `executeTurn()` → ланцюжок

```typescript
type AgentStep = {
  agentType: LiveAuthorType;
  run: () => Promise<ParsedPostReply>;
};

const steps: AgentStep[] = [
  { agentType: "AGENT_ARBITER", run: () => runArbiterTurn(...) },
  { agentType: "AGENT_COMPANY", run: () => runCompanyLiveTurn(...) },
  { agentType: "AGENT_CANDIDATE", run: () => runCandidateLiveTurn(...) },
];
```

**Алгоритм кожного кроку:**

1. Перевірити `generation === capturedGeneration` — інакше abort
2. `emit room:agent-thinking { active: true, agentType }`
3. Виклик LLM → `parsePostReply`
4. `post: true` → `liveMessage.create` + `room:messages`
5. `post: false` → нічого не публікувати
6. Помилка → `console.error`, перейти до наступного кроку
7. Після всіх кроків → `room:agent-thinking { active: false }`

### Injectable options (для тестів)

```typescript
type RoomOrchestratorOptions = {
  debounceMs?: number;
  getLlmProvider?: () => LlmProvider;
  runArbiterTurn?: RunArbiterTurnFn;
  runCompanyLiveTurn?: RunCompanyLiveTurnFn;
  runCandidateLiveTurn?: RunCandidateLiveTurnFn;
};
```

Debounce, generation counter, перевірка `LIVE` — без змін.

---

## UI

### `LiveChatPanel.vue`

Розширити `thinkingLabel`:

| `agentType` | Label |
|-------------|-------|
| `AGENT_ARBITER` | «Arbiter» |
| `AGENT_COMPANY` | «Компанія» |
| `AGENT_CANDIDATE` | «Кандидат (AI)» |

Підписи повідомлень уже налаштовані. Кольори, кнопка «Завершити» — День 19.

### `types.ts`

```typescript
export type RoomAgentThinkingEvent = {
  active: boolean;
  agentType?: "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";
};
```

---

## Обробка помилок

| Ситуація | Поведінка |
|----------|-----------|
| LLM невалідний JSON | `console.error`; крок пропускається; ланцюжок продовжується |
| LLM timeout / мережева помилка | Те саме |
| Профілі відсутні | log; увесь ланцюжок skip |
| Generation counter скасував хід | Discard усі незбережені результати |
| Company `post:false`, HR питав | Candidate все одно запускається |
| Усі три `post:false` | Thinking зникає; чат людей працює |
| `post: true` але порожній `message` | Parse error → крок пропускається |

Агенти **ніколи не ламають чат** — worst case мовчать.

---

## Тести

### `agent-post-reply.test.ts`

- Валідний `{ post: false }`, `{ post: true, message: "..." }`
- JSON у code fence
- Невалідний JSON → throw
- `post: true` без message → throw

### `company-live-agent.test.ts`

- `buildCompanyLiveMessages`: system prompt містить профіль; history з prefix
- `runCompanyLiveTurn`: injectable prisma + llm

### `candidate-live-agent.test.ts`

- `buildCandidateLiveMessages`: system prompt містить профіль
- Промпт містить інструкцію відповідати на HR і Company

### `orchestrator.test.ts` (оновити)

- Повний ланцюжок: 3 agent messages у порядку Arbiter → Company → Candidate
- Arbiter `post:false` → Company/Candidate все одно запускаються
- Company `post:false` + HR питання → Candidate може опублікувати
- Усі `post:false` → 0 agent messages
- Generation cancel під час ланцюжка → 0 agent messages
- Injectable stubs для кожного агента

---

## Definition of Done (README Day 18)

- [ ] Демонстрація: повний ланцюжок агентів після кожного повідомлення людини
- [ ] Сценарій: Company посилається на профіль компанії; Candidate — лише на профіль кандидата (без вигаданих фактів)
- [ ] Сценарій: Candidate відповідає на питання HR, якщо знає відповідь
- [ ] Сценарій: порядок відповідей `Human → Arbiter → Company → Candidate` дотримується
- [ ] Збірка: `npm run build` проходить
- [ ] README: повний agent pipeline `Human → Arbiter → Company → Candidate`

---

## Ручна перевірка

1. Відкрити live-кімнату з підтвердженими профілями (як Day 15).
2. HR і кандидат вітаються → Arbiter дає сигнал старту.
3. Company ставить питання з профілю → Candidate відповідає з профілю.
4. HR ставить питання напряму → Candidate відповідає, якщо знає.
5. HR ставить питання поза профілем кандидата → Candidate просить відповісти живого кандидата.
6. Швидко надіслати 3 повідомлення → ланцюжок спрацьовує один раз (debounce).
7. Arbiter пропонує завершення → текст у чаті, статус лишається `LIVE`.

---

## Підготовка до Днів 19–20

- Arbiter вже аналізує розмову — історія live-чату готова для звіту (День 20)
- Завершення співбесіди: кнопка HR (День 19) → `POST /interviews/:id/end` (День 20)
- Orchestrator не потребує змін для завершення — достатньо перевірки `ENDED` (вже є)

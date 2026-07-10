# Agent orchestrator після людського повідомлення — Day 16 Design Spec

**Дата:** 2026-07-10  
**Статус:** Затверджено в brainstorming  
**Контекст:** День 16 плану розробки (README) — «Запуск агентів після повідомлення»  
**Передумови:** День 15 (Socket.IO live-чат між HR і кандидатом)  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

MVP уже має:

- Socket.IO кімната `interview:${interviewId}` з подіями `room:join`, `room:message`, `room:messages`
- `LiveSession` / `LiveMessage` з `LiveAuthorType` (люди + `AGENT_ARBITER`, `AGENT_COMPANY`, `AGENT_CANDIDATE`)
- Фронт: `useInterviewRoom` + `LiveChatPanel` — лише `HUMAN_HR` / `HUMAN_CANDIDATE`
- Prep-агенти (Company, Candidate) працюють через HTTP, не в live-кімнаті

**Мета Дня 16:** після повідомлення людини система чекає (debounce), запускає чергу агентів (поки один stub Arbiter), показує індикатор «агент думає» в UI.

**Поза scope:**

- Справжній LLM Arbiter (День 17)
- Company і Candidate agents у live-чаті (День 18)
- Зміни Prisma-схеми (enum уже готовий)
- Блокування composer під час роботи агента
- Персистентна черга ходів у БД

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Затримка перед агентами | **A** — debounce: агенти стартують після паузи без нових людських повідомлень |
| Нове повідомлення під час ходу | **A** — скасувати поточний хід, debounce відлічує заново |
| Тип заглушки | **A** — `AGENT_ARBITER` (місце в pipeline для Дня 17) |
| Індикатор «думає» | **A** — socket-подія `room:agent-thinking` від сервера |

---

## Підходи (розглянуті)

### 1. In-process orchestrator у `backend/src/socket/` (обрано)

Окремий модуль `orchestrator.ts` зі станом на кімнату. `room.ts` після збереження людського повідомлення викликає `orchestrator.onHumanMessage()`.

**Плюси:** мінімальний diff, готовність до Днів 17–18, debounce і скасування в одному місці, unit-тести без socket.  
**Мінуси:** стан у пам’яті процесу — при рестарті сервера активні ходи губляться (прийнятно для MVP).

### 2. Inline у `room.ts` (відхилено)

Уся логіка debounce/агента прямо в обробнику `room:message`.

**Плюси:** швидко написати.  
**Мінуси:** `room.ts` роздується, важко тестувати і розширювати до 3 агентів.

### 3. Черга в БД + worker (відхилено)

Кожен хід — запис у таблицю, окремий worker обробляє.

**Плюси:** переживає рестарт.  
**Мінуси:** over-engineering для одного stub-агента.

---

## Pipeline

```
Людина пише → room:message → зберегти LiveMessage (HUMAN_*)
                                    ↓
                         orchestrator.onHumanMessage()
                                    ↓
                    debounce 2500 ms (скасовується новим msg)
                                    ↓
                    room:agent-thinking { active: true, agentType: AGENT_ARBITER }
                                    ↓
                    stub Arbiter (~1500 ms + фіксована відповідь)
                                    ↓
                    зберегти LiveMessage (AGENT_ARBITER) → room:messages
                                    ↓
                    room:agent-thinking { active: false }
```

### Правила

- Тригер **лише** на `HUMAN_HR` / `HUMAN_CANDIDATE` — повідомлення агентів не запускають новий хід
- Нове людське повідомлення під час debounce або виконання stub → скасувати поточний хід, debounce відлічує заново
- Скасування через `generation` counter: якщо generation змінилась під час виконання stub — відповідь не зберігається і не емітиться
- При скасуванні емітити `room:agent-thinking { active: false }`
- Якщо interview у статусі `ENDED` — orchestrator не планує нові ходи

### Константи

| Константа | Значення | Призначення |
|-----------|----------|-------------|
| `AGENT_DEBOUNCE_MS` | `2500` | Пауза після останнього людського msg |
| `STUB_AGENT_DELAY_MS` | `1500` | Імітація «думає» всередині stub |

Обидві — hardcode у `orchestrator.ts` / `stub-arbiter.ts` (без env на День 16).

---

## Бекенд

### Нові / змінені файли

| Файл | Відповідальність |
|------|------------------|
| `backend/src/socket/orchestrator.ts` | Debounce, generation, черга агентів, emit подій |
| `backend/src/agents/stub-arbiter.ts` | Заглушка Arbiter без LLM |
| `backend/src/socket/room.ts` | Виклик orchestrator після людського msg; `toDto` для всіх `LiveAuthorType` |
| `backend/src/socket/types.ts` | Розширений `LiveMessageDto`, `RoomAgentThinkingEvent` |
| `backend/src/server.ts` | Створити singleton orchestrator, передати в `registerRoomHandlers` |

### Stub Arbiter

```typescript
export async function runStubArbiter(lastHumanContent: string): Promise<string>;
```

- Затримка `STUB_AGENT_DELAY_MS`
- Відповідь українською: `[Arbiter stub] Почув вас. Продовжуйте розмову. (Останнє: «…»)`
- Цитата обрізається до 80 символів

### Orchestrator API

```typescript
export function createRoomOrchestrator(getPrisma: () => PrismaClient): RoomOrchestrator;

interface RoomOrchestrator {
  onHumanMessage(io: Server, interviewId: string, sessionId: string): void;
}
```

Внутрішній стан на `interviewId`:

```typescript
{
  debounceTimer: NodeJS.Timeout | null;
  generation: number;
}
```

Алгоритм `onHumanMessage`:

1. `generation++`, clear попередній `debounceTimer`
2. emit `room:agent-thinking { active: false }` (скинути попередній індикатор)
3. Запустити новий `debounceTimer` на `AGENT_DEBOUNCE_MS`
4. По таймеру: зберегти `capturedGeneration = generation`
5. emit `room:agent-thinking { active: true, agentType: "AGENT_ARBITER" }`
6. Завантажити останнє людське повідомлення з сесії
7. `content = await runStubArbiter(lastHumanContent)`
8. Якщо `generation !== capturedGeneration` → abort (без save, без emit messages)
9. `prisma.liveMessage.create({ authorType: AGENT_ARBITER, content })`
10. `io.to(room).emit("room:messages", { messages: [dto] })`
11. emit `room:agent-thinking { active: false }`

### Зміни в `room.ts`

Після `liveMessage.create` для людини:

```typescript
if (saved.authorType === "HUMAN_HR" || saved.authorType === "HUMAN_CANDIDATE") {
  orchestrator.onHumanMessage(io, interviewId, session.id);
}
```

`toDto()` — приймає всі значення `LiveAuthorType`, без throw.

### `room:join`

Історія включає agent messages (якщо є). Подія `room:agent-thinking` **не** відправляється при join — індикатор лише для активного ходу.

---

## Socket.IO протокол (доповнення до Day 15)

### Нова подія server → client

| Подія | Payload | Коли |
|-------|---------|------|
| `room:agent-thinking` | `{ active: boolean; agentType?: "AGENT_ARBITER" }` | Початок/кінець ходу агента або скасування |

### Розширений `LiveMessageDto`

```typescript
type LiveMessageDto = {
  id: string;
  authorType:
    | "HUMAN_HR"
    | "HUMAN_CANDIDATE"
    | "AGENT_ARBITER"
    | "AGENT_COMPANY"
    | "AGENT_CANDIDATE";
  content: string;
  createdAt: string;
};
```

---

## Фронтенд

### `useInterviewRoom.ts`

- Розширити `LiveMessage.authorType` — усі типи з DTO
- Новий стан: `agentThinking: Ref<{ active: boolean; agentType?: string } | null>`
- Listener `room:agent-thinking` → оновлює `agentThinking`
- У `onMessages`: якщо вхідне повідомлення має `authorType` з префіксом `AGENT_` — скинути `agentThinking` до `{ active: false }`

### `LiveChatPanel.vue`

**Підписи:**

| `authorType` | Label |
|--------------|-------|
| `HUMAN_HR` | «HR» |
| `HUMAN_CANDIDATE` | «Кандидат» |
| `AGENT_ARBITER` | «Arbiter» |
| `AGENT_COMPANY` | «Компанія» |
| `AGENT_CANDIDATE` | «Кандидат (AI)» |

**Стилі:** агентські повідомлення — клас `.agent` (нейтральний фон, не `.own`).

**Індикатор:**

```html
<p v-if="agentThinking?.active" class="thinking">
  {{ thinkingLabel }} думає…
</p>
```

`thinkingLabel` = «Arbiter» для `AGENT_ARBITER`.

**Composer:** залишається активним під час debounce/думає.

### `InterviewRoomContent.vue`

Прокинути `agentThinking` з composable у `LiveChatPanel`.

---

## Обробка помилок

| Ситуація | Поведінка |
|----------|-----------|
| Stub падає / timeout | `room:agent-thinking { active: false }`, `console.error`, чат людей працює |
| Скасування ходу | `active: false` без нового повідомлення |
| `ENDED` interview | Orchestrator не планує ходи (перевірка в `onHumanMessage` або в `room.ts` до виклику) |
| Рестарт сервера | Активний debounce губиться — прийнятно для MVP |
| Socket disconnect клієнта | Індикатор зникне при reconnect; активний хід на сервері продовжується |

---

## Definition of Done (README Day 16)

- [ ] Демонстрація: написав повідомлення → через ~4 с з’являється відповідь Arbiter-stub
- [ ] Сценарій: індикатор «думає» з’являється після debounce і зникає після відповіді; агент не відповідає на власні повідомлення
- [ ] Збірка: `npm run build` проходить
- [ ] README: опис orchestrator pipeline (`Human → [debounce] → Arbiter stub`)

---

## Тестування

### Ручний сценарій

1. Дві вкладки: HR і кандидат у live-кімнаті (`READY`/`LIVE`)
2. HR пише повідомлення → через ~2.5 с з’являється «Arbiter думає…» → через ~1.5 с відповідь stub
3. Відповідь видна в обох вкладках
4. HR швидко пише 3 повідомлення підряд → stub відповідає лише один раз (на останнє)
5. Під час «думає» HR пише ще одне → індикатор скидається, debounce починається заново
6. Reload — історія з agent message на місці, індикатор не зависає

### Автотести

| Файл | Перевірки |
|------|-----------|
| `backend/src/agents/stub-arbiter.test.ts` | Формат відповіді, обрізання цитати |
| `backend/src/socket/orchestrator.test.ts` | Debounce викликає stub; generation скасовує save; agent msg не тригерить |

### Build

```bash
npm run build
```

---

## Еволюція (Дні 17–18)

Orchestrator розширюється до черги агентів:

```
Human → [debounce] → Arbiter → Company → Candidate
```

Stub Arbiter замінюється на `runArbiterAgent()` з LLM. Інтерфейс `onHumanMessage` і `room:agent-thinking` залишаються без змін.

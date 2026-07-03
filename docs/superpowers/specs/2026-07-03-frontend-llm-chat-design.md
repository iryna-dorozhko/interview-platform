# Дизайн: Простий LLM-чат на фронтенді (Day 2)

## Контекст

Day 2 додав backend LLM-шар (`POST /api/llm/complete`) з провайдерами omlx і Gemini. Фронтенд поки що показує лише статус Day 1 (`App.vue`).

Потрібен простий UI для живого спілкування з моделлю — демонстрація DoD Дня 2 і основа для майбутнього prep-чату.

## Мета

1. Чат з повною історією діалогу на головній сторінці
2. Зберегти блок статусу Day 1 зверху
3. Кнопка «Новий чат» для скидання історії
4. Без нових залежностей (Vue 3 + існуючий API)

## Рішення користувача

| Питання | Відповідь |
|---------|-----------|
| Розміщення | Health зверху + чат знизу на одній сторінці |
| Діалог | Повна історія (`messages[]` на кожен запит) |
| Новий чат | Так, кнопка очищення |

## Архітектура

**Підхід:** окремий компонент `ChatPanel` + API-клієнт `api/llm.ts`. Стан чату локально в компоненті (`ref`), без Pinia і без БД.

**Сторінка** (`App.vue`):
1. Блок статусу Day 1 (без змін у логіці)
2. Розділювач
3. `ChatPanel`

**Потік даних:**

```
Користувач → Enter/«Надіслати»
  → messages.push({ role: "user", content })
  → POST /api/llm/complete { messages }
  → messages.push({ role: "assistant", content: text })
  → показ provider під відповіддю
```

**Типи (frontend):**

```typescript
type ChatRole = "user" | "assistant";
type UiMessage = { role: ChatRole; content: string };
```

## Компоненти

### `frontend/src/api/llm.ts`

```typescript
export type LlmCompleteResponse = { text: string; provider: string };

export async function sendChat(
  messages: UiMessage[]
): Promise<LlmCompleteResponse>
```

- `POST /api/llm/complete` з тілом `{ messages }`
- При `!response.ok` — parse JSON `{ error?, detail? }`, throw `Error` з зрозумілим текстом

### `frontend/src/components/ChatPanel.vue`

**Стан:**
- `messages: Ref<UiMessage[]>`
- `input: Ref<string>`
- `loading: Ref<boolean>`
- `error: Ref<string | null>`
- `lastProvider: Ref<string | null>`

**Дії:**
- `sendMessage()` — валідація, push user, fetch, push assistant, скрол
- `clearChat()` — очистити messages, input, error, lastProvider
- `onKeydown` — Enter надсилає, Shift+Enter — новий рядок

**UI:**
- Заголовок «Чат з AI»
- Кнопка «Новий чат» (disabled під час loading)
- Список повідомлень: user праворуч (синій), assistant ліворуч (сірий)
- Під останньою відповіддю assistant — `({{ lastProvider }})` дрібним шрифтом
- Textarea + кнопка «Надіслати» (disabled якщо loading або порожній input)
- Під час loading — текст «Думаю…» замість кнопки або поруч
- Червоний банер помилки над полем вводу
- `ref` на контейнер повідомлень — `scrollTop = scrollHeight` після кожного повідомлення

### `frontend/src/App.vue`

- Зберегти існуючий health-блок
- Додати `<ChatPanel />` нижче
- Збільшити `max-width` до `40rem` для комфортного чату

## Обробка помилок

| Ситуація | UI |
|----------|-----|
| HTTP 503 | «Модель недоступна. Запусти `omlx serve`.» |
| Інша помилка | «Не вдалося отримати відповідь.» + detail якщо є |
| Порожній ввід | кнопка disabled |
| Помилка під час запиту | user-повідомлення залишається в історії; assistant не додається |

Помилки не потрапляють у `messages[]` — лише в `error` банер.

## Стилізація

- `system-ui`, кольори як у поточному `App.vue`
- Без Tailwind, без UI-бібліотек
- Мінімальні scoped styles в `ChatPanel.vue`

## Файли

| Файл | Дія |
|------|-----|
| `frontend/src/api/llm.ts` | створити |
| `frontend/src/components/ChatPanel.vue` | створити |
| `frontend/src/App.vue` | модифікувати |

Backend без змін — існуючий endpoint вже підтримує `messages[]`.

## Поза scope

- Стрімінг відповідей
- Збереження чату (localStorage, БД)
- Vue Router, Pinia
- Перемикач провайдера в UI
- System prompt / role selector
- Markdown-рендеринг відповідей

## Тестування

**Ручна перевірка:**
1. `omlx serve --port 8000` + backend dev
2. Відкрити http://localhost:5173
3. Надіслати 2–3 повідомлення — модель пам’ятає контекст
4. «Новий чат» — історія очищується
5. Зупинити omlx — помилка 503 у банері
6. `npm run build` проходить

**Автотести:** не в scope Day 2 (немає frontend test runner).

## Обґрунтування

**Чому не Pinia:** один компонент, локальний стан достатній.

**Чому не Router:** чат на головній — демо DoD; router додамо з HR-кабінетом (День 3+).

**Чому повна історія:** backend вже приймає `messages[]`; single-message втрачає контекст діалогу.

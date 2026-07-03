# Дизайн: LLM-інтеграція (Day 2)

## Контекст

Day 1 закрив bootstrap monorepo, PostgreSQL і health endpoint. Day 2 додає перший робочий шар AI: «надіслати текст → отримати відповідь».

Початковий MVP-дизайн (PD-010) передбачав Ollama + LiteLLM. Після уточнення з користувачем:

- **Локально:** oMLX (вже встановлений, модель `Qwen2.5-7B-Instruct-4bit` у `~/.omlx/models`)
- **Зовнішньо:** Google Gemini через офіційний SDK `@google/generative-ai` (не LiteLLM)

## Мета

1. Плагінований `LlmProvider` з перемиканням `LLM_PROVIDER=omlx|gemini`
2. Тестовий HTTP endpoint `POST /api/llm/complete`
3. CLI-скрипт `npm run llm:test` для перевірки без HTTP
4. Документація в README для DoD Дня 2

## Архітектура

```typescript
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmProvider {
  complete(messages: ChatMessage[]): Promise<string>;
}
```

**Factory** (`createLlmProvider()`) читає `LLM_PROVIDER` і повертає відповідну реалізацію.

### Змінні середовища

| Змінна | Default | Опис |
|--------|---------|------|
| `LLM_PROVIDER` | `omlx` | `omlx` або `gemini` |
| `OMLX_BASE_URL` | `http://127.0.0.1:8000` | URL omlx OpenAI-compatible сервера |
| `OMLX_MODEL` | `Qwen2.5-7B-Instruct-4bit` | model_id у omlx |
| `GEMINI_API_KEY` | — | обов'язково при `LLM_PROVIDER=gemini` |
| `GEMINI_MODEL` | `gemini-2.0-flash` | модель Google |

omlx запускається окремим процесом на хості (`omlx serve`), не в Docker. API keys не комітити.

### Потік даних

```
curl / llm:test script
       ↓
createLlmProvider()
       ↓
  omlx.provider  →  POST /v1/chat/completions
  gemini.provider → @google/generative-ai
       ↓
     string (відповідь)
```

## Структура файлів

```
backend/src/llm/
  types.ts              — ChatMessage, LlmProvider
  omlx.provider.ts      — fetch → OpenAI-compatible API
  gemini.provider.ts    — Google Generative AI SDK
  factory.ts            — createLlmProvider()
  omlx.provider.test.ts — unit-тести (mock fetch)
  factory.test.ts       — unit-тести factory
backend/src/routes/
  llm.ts                — POST /api/llm/complete
backend/scripts/
  llm-test.ts           — CLI перевірка
```

## Компоненти

### `omlx.provider.ts`

- `POST {OMLX_BASE_URL}/v1/chat/completions`
- Тіло: `{ model: OMLX_MODEL, messages, stream: false }`
- Повертає `choices[0].message.content`
- Timeout: 120 с (перший запуск моделі може бути повільним)

### `gemini.provider.ts`

- Залежність: `@google/generative-ai`
- `system` повідомлення → `systemInstruction`
- `user`/`assistant` → `history` + останнє повідомлення
- Повертає `response.text()`

### `factory.ts`

- `LLM_PROVIDER=omlx` → `OmlxProvider`
- `LLM_PROVIDER=gemini` → `GeminiProvider` (помилка якщо немає `GEMINI_API_KEY`)
- Невідомий provider → помилка з переліком допустимих значень

### `routes/llm.ts`

```
POST /api/llm/complete

Request:
  { "message": "Привіт!" }
  або
  { "messages": [{ "role": "user", "content": "..." }] }

Response 200:
  { "text": "...", "provider": "omlx" }

Response 400:
  { "error": "message or messages required" }

Response 503:
  { "error": "LLM unavailable", "detail": "..." }
```

Якщо передано лише `message`, обгортається в `[{ role: "user", content: message }]`.

### `scripts/llm-test.ts`

- Команда: `npm run llm:test` (workspace `backend`)
- Аргумент: `--message "..."` (default: `"Скажи одне речення українською."`)
- Викликає `createLlmProvider().complete()` напряму
- Exit 0 + stdout при успіху; exit 1 + stderr при помилці

## Обробка помилок

| Ситуація | Поведінка |
|----------|-----------|
| omlx не запущений (ECONNREFUSED) | HTTP 503, `"omlx server not reachable at ..."` |
| `gemini` без `GEMINI_API_KEY` | Помилка в factory / HTTP 503 |
| Timeout (>120 с) | HTTP 503, `"LLM request timed out"` |
| Порожня відповідь моделі | HTTP 502, `"empty response from LLM"` |

Логування: `console.error` з іменем провайдера і detail (без API keys).

## Тестування

### Unit (node:test, у CI)

- `omlx.provider.test.ts` — mock `fetch`, перевірка парсингу відповіді та помилок
- `factory.test.ts` — правильний провайдер за env, помилка без ключа

### Integration (ручна, не в CI)

Потребує живий omlx або Gemini API key.

```bash
# 1. Запустити omlx
omlx serve --port 8000

# 2. Backend
npm run dev

# 3. Endpoint
curl -X POST http://localhost:3000/api/llm/complete \
  -H "Content-Type: application/json" \
  -d '{"message":"Привіт!"}'

# 4. CLI
npm run llm:test --workspace backend

# 5. Gemini (опційно)
LLM_PROVIDER=gemini GEMINI_API_KEY=... npm run llm:test --workspace backend
```

## Зміни в існуючих файлах

- `backend/src/server.ts` — підключити LLM router
- `backend/package.json` — залежність `@google/generative-ai`, скрипт `llm:test`
- `backend/.env.example` — LLM-змінні
- `README.md` — оновити секцію Дня 2 (omlx замість Ollama, env, curl)

## Поза scope (Day 2)

- Стрімінг відповідей
- LiteLLM як третій провайдер
- Інтеграція LLM у prep-чат / агентів (наступні дні)
- LLM health check у `/api/health`
- Ollama як провайдер

## Обґрунтування

**Чому omlx, а не Ollama:** користувач має omlx з готовою моделлю на Apple Silicon; OpenAI-compatible API спрощує клієнтський код.

**Чому Gemini напряму, а не LiteLLM:** менше залежностей для Day 2; LiteLLM можна додати пізніше як третій провайдер без зміни інтерфейсу `LlmProvider`.

**Чому endpoint + скрипт:** endpoint для демонстрації DoD; скрипт для швидкої локальної перевірки провайдера без піднятого backend.

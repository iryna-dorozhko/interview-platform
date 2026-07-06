# Company Agent — Day 4 Design Spec

**Дата:** 2026-07-06
**Статус:** Затверджено в brainstorming
**Контекст:** День 4 плану розробки (README) — «Company Agent (серверна частина)»
**Мова:** Українська (промпт, повідомлення про помилки)

---

## Контекст і мета

MVP вже має готову інфраструктуру з попередніх днів:

- Auth (JWT, `requireAuth`/`requireHr`) — День 3.
- Плагінований `LlmProvider` (`omlx` / `gemini`) з методом `complete(messages): Promise<string>` — День 2.
- Схема БД вже містить таблиці саме під цю задачу: `PrepSessionHr` (`isClosed`) і `PrepMessageHr` (`authorType`: `HUMAN_HR` | `AGENT_COMPANY`), прив'язані до `Interview`.

Мета Дня 4: AI-агент компанії (Company Agent) веде структуровану анкету з HR у чаті — питає про вакансію, вимоги й культуру компанії, зберігає повну історію в БД. Профіль (`CompanyProfile`) і його підтвердження — поза scope (Дні 6–7).

**Важливий нюанс scope:** ендпоінт створення співбесіди (`POST /interviews`) з'явиться лише в День 8. Для демонстрації й тестування Дня 4 потрібен тестовий `Interview`, тому seed розширюється тестовою співбесідою (див. нижче).

---

## API-контракт

```
POST /api/prep/:interviewId/message
Headers: Authorization: Bearer <HR JWT>
Body:    { "message"?: string }
```

`message` необов'язковий: порожній виклик = перший запуск чату, агент сам вітається і ставить перше питання.

### Обробка запиту

1. `requireAuth` + `requireHr` (як у `/api/llm/*`).
2. Знайти `Interview` за `:interviewId`:
   - не знайдено → `404`;
   - `interview.hrUserId !== req.user.id` → `403`.
3. Знайти або автостворити `PrepSessionHr` для цього `interviewId` (`isClosed: false` за замовчуванням).
4. Якщо `session.isClosed === true` → `409 { "error": "Prep session closed" }`.
5. Якщо `message` — непорожній рядок, зберегти `PrepMessageHr { authorType: HUMAN_HR, content }`.
6. Зібрати контекст для LLM: `[{ role: "system", content: <company-agent prompt> }, ...history]`, де історія — всі `PrepMessageHr` сесії в хронологічному порядку, змасковані як `user` (HUMAN_HR) / `assistant` (AGENT_COMPANY).
7. Викликати `provider.complete(messages)`.
8. Розпарсити відповідь через `parseAgentReply()` (див. нижче) → `{ message, readyForConfirmation }`.
9. Зберегти чистий текст (без маркера) як `PrepMessageHr { authorType: AGENT_COMPANY, content: message }`.
10. Відповісти:

```json
{ "message": "Розкажіть, будь ласка, про вакансію — яка це посада?", "readyForConfirmation": false }
```

### Помилки

| Ситуація | Код | Тіло |
|---|---|---|
| Немає токена / не HR | 401 / 403 | `{ error }` |
| `Interview` не знайдено | 404 | `{ error: "Interview not found" }` |
| `Interview` належить іншому HR | 403 | `{ error: "Forbidden" }` |
| `PrepSessionHr.isClosed` | 409 | `{ error: "Prep session closed" }` |
| LLM недоступна / порожня відповідь | 503 | `{ error: "LLM unavailable", detail }` (як у `routes/llm.ts`) |

---

## Промпт і сигнал готовності

### Теми анкети

Company Agent веде діалог, поки не зібере достатньо конкретики по всіх чотирьох темах (відповідають полям `CompanyProfile`):

1. **Посада** (`role`) — назва, рівень.
2. **Вимоги** (`requirements`) — навички, досвід, обов'язкові/бажані.
3. **Культура** (`culture`) — цінності, стиль роботи команди.
4. **Очікування** (`expectations`) — що компанія очікує від кандидата на цій ролі.

Стиль: одне зрозуміле питання за раз, українською, дружньо-професійно; не видавати весь список питань одразу; не вигадувати відповіді за HR.

### Сигнал `readyForConfirmation`

Оскільки `LlmProvider.complete()` повертає лише plain text (без JSON mode / function calling), а локальна модель (`omlx`, `Qwen2.5-7B-Instruct-4bit`) не завжди надійно генерує валідний JSON на кириличному тексті, обрано підхід **текстового маркера**:

- Системний промпт інструктує модель завжди закінчувати відповідь окремим останнім рядком: рівно `READY:true` або `READY:false`.
- `READY:true` дозволено виставляти не раніше 2–3 змістовних обмінів і лише коли по всіх чотирьох темах зібрано достатньо конкретики.
- Backend (`parseAgentReply`) відрізає останній рядок за регуляркою `/^READY:(true|false)\s*$/im`, повертає:
  - `message` — текст без маркера (те, що бачить і зберігає користувач);
  - `readyForConfirmation` — `true` лише при точному збігу `READY:true`.
- **Безпечний fallback:** якщо маркер відсутній або пошкоджений — `readyForConfirmation: false`, а весь сирий текст іде в `message`. Ніколи не сигналізуємо готовність помилково через збій парсингу.

Розглянуті й відхилені альтернативи:
- **Строгий JSON-об'єкт у відповіді LLM** — чистіший контракт, але висока крихкість парсингу з малою локальною моделлю на українському тексті (ризик втратити все повідомлення при невалідному JSON).
- **Два окремі виклики LLM** (відповідь + класифікатор готовності) — надійніший сигнал ціною подвоєння латентності й вартості на кожен обмін.

---

## Структура файлів (backend)

```
backend/src/agents/
  company-agent.ts          # buildSystemPrompt(), parseAgentReply(), runCompanyAgentTurn()
  company-agent.test.ts
  prompts/
    company-agent.uk.md     # system prompt українською
backend/src/routes/
  prep.ts                   # createPrepRouter(getPrisma, getProvider)
  prep.test.ts
backend/src/seed/
  hr-interview.js           # seed тестового Interview (DRAFT) для hr@test.com
  hr-interview.test.js
```

`server.ts`: додати
```ts
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, () => createLlmProvider()));
```

`company-agent.ts` тримає чисту, тестовану логіку (побудова промпту, парсинг маркера, збирання `ChatMessage[]` з історії) окремо від `prep.ts`, який відповідає лише за HTTP/Prisma-обв'язку — за аналогією з поділом `llm/` і `routes/llm.ts`.

---

## Розширення seed

`db:seed` додатково створює (upsert) один тестовий `Interview`:

- `hrUserId` = seed HR (`hr@test.com`);
- `status: DRAFT`;
- `joinCode`: фіксований, напр. `TEST01`;
- лог після сіду виводить `id` і `joinCode` цієї співбесіди для використання в curl-прикладах README.

Це тимчасове рішення на період до Дня 8: коли з'явиться повноцінний `POST /interviews`, seed-інтерв'ю лишається як зручний фікстур для ручного тестування prep-флоу, не заважаючи новому ендпоінту.

---

## Тестування і верифікація

**Unit:**
- `parseAgentReply`: коректний маркер `true`/`false`, відсутній маркер (fallback `false`), маркер з зайвими пробілами/регістром.
- `prep.ts` роут з мокнутим `LlmProvider` і мокнутим/тестовим Prisma (за патерном `auth.test.ts`, `llm.test.ts`): автостворення сесії, 403/404/409-сценарії, збереження двох повідомлень (HUMAN_HR + AGENT_COMPANY) на один запит.

**Ручний сценарій (Day 4 DoD):**
1. Логін HR → отримати токен.
2. `POST /api/prep/:interviewId/message` без `message` → перше вітання агента.
3. Мінімум 3 обміни повідомленнями по темах вакансії/вимог/культури.
4. Перевірити в БД: `PrepSessionHr` + `PrepMessageHr` містять всю історію в правильному порядку.
5. Дочекатись `readyForConfirmation: true` після достатньої кількості обмінів.

**Build:** `npm run build` у корені без помилок.

**README:** оновити прикладом curl-запиту/відповіді з реальним `interviewId` із seed-виводу.

---

## Поза scope (Day 4)

- Генерація `CompanyProfile` JSON (День 6).
- Ендпоінт підтвердження профілю `POST /prep/:interviewId/confirm` (День 7).
- UI чату (День 5).
- `GET /prep/:interviewId/messages` для відновлення історії у фронтенді (додається в межах Дня 5, коли з'явиться UI, що це потребує).
- Повноцінний `POST /interviews` (День 8) — замінить тимчасове seed-інтерв'ю.

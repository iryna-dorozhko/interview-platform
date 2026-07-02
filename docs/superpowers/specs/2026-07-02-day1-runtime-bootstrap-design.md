# Дизайн: Day 1 Runtime Bootstrap (Vite + Vue 3 + Express + TypeScript)

**Дата:** 2026-07-02  
**Статус:** Затверджено в brainstorming  
**Мета:** Закрити прогалини Definition of Done Дня 1 — реальні dev-сервери, перевірка PostgreSQL і seed у браузері, справжня збірка.

---

## Контекст

Поточний стан репозиторію:

- Monorepo `npm workspaces` (`frontend`, `backend`) — готово
- Prisma schema, міграції, seed (`hr@test.com` / `123456`) — готово
- Docker Compose PostgreSQL — готово
- `backend/src/db/healthcheck.js` — модуль перевірки БД без HTTP-експозиції
- `frontend` і `backend` `dev`/`build` — placeholder `echo`, без реальних серверів

**Прогалини DoD:**

1. `npm run dev` не піднімає HTTP-сервери
2. Неможливо відкрити обидва сервіси в браузері та перевірити підключення до PostgreSQL
3. `npm run build` не компілює код
4. README вже містить DB-кроки, але не описує runtime-порти та сценарій перевірки в UI

**Узгоджені рішення (brainstorming):**

| Тема | Рішення |
|------|---------|
| Рівень scaffold | B — цільовий стек одразу: Vite + Vue 3 + Express + TypeScript |
| UI Day 1 | Статус API + підтвердження seed (`hr@test.com` існує в БД) |
| API контракт | Один endpoint `GET /api/health` (підхід A) |
| Порти | Frontend `5173`, Backend `3000` (згідно MVP design) |

---

## Мета

Після реалізації розробник може:

1. Запустити `npm run dev` і отримати два працюючих HTTP-сервіси
2. Відкрити `http://localhost:5173` і побачити статуси Backend, PostgreSQL і Seed HR
3. Відкрити `http://localhost:3000/api/health` і отримати JSON з тими ж перевірками
4. Запустити `npm run build` і отримати скомпільовані артефакти в обох workspace

---

## Архітектура

```
┌─────────────────────┐     /api/* proxy      ┌──────────────────────────┐
│  Vite + Vue 3 SPA   │ ────────────────────► │  Express + TypeScript    │
│  localhost:5173     │                       │  localhost:3000          │
└─────────────────────┘                       └────────────┬─────────────┘
                                                           │
                                                           ▼
                                                  ┌─────────────────┐
                                                  │  PostgreSQL 16  │
                                                  │  (Docker)       │
                                                  └─────────────────┘
```

**Оркестрація:**

- Кореневий `npm run dev` делегує паралельно `dev` у `frontend` і `backend`
- Vite dev server проксує `/api` → `http://localhost:3000`
- Існуючі JS-модулі (`healthcheck.js`, `hr-user.js`, `seed.js`) залишаються; backend TypeScript імпортує їх через `allowJs`

---

## Компоненти

### Backend (`backend/`)

| Файл | Відповідальність |
|------|------------------|
| `src/server.ts` | Express app, CORS, підключення маршрутів, listen на `PORT` |
| `src/routes/health.ts` | `GET /api/health` — агрегує перевірки |
| `src/db/prisma.ts` | Спільний PrismaClient з `@prisma/adapter-pg` (як у `seed.js`) |
| `src/db/seed-check.ts` | `checkHrSeedUser(prisma)` — чи існує `hr@test.com` з роллю HR |
| `tsconfig.json` | `allowJs: true`, `outDir: dist`, CommonJS |

**Існуючі модулі (без змін логіки):**

- `src/db/healthcheck.js` — `checkDatabaseHealth(client)`
- `src/seed/hr-user.js` — константа `SEED_HR_USER.email = "hr@test.com"`

**`GET /api/health` — контракт:**

```json
{
  "ok": true,
  "database": { "ok": true },
  "seed": { "ok": true, "email": "hr@test.com" }
}
```

**Правила `ok`:**

- `database.ok` — результат `checkDatabaseHealth(prisma)`
- `seed.ok` — `true` якщо `User` з `email = "hr@test.com"` і `role = HR` існує
- Кореневий `ok` — `database.ok && seed.ok`
- HTTP статус завжди `200` (для Day 1 UI зручніше показувати FAIL у body, ніж обробляти 503)

**Скрипти `backend/package.json`:**

| Скрипт | Команда |
|--------|---------|
| `dev` | `tsx watch src/server.ts` |
| `build` | `tsc` |
| `start` | `node dist/server.js` |
| `lint` | `tsc --noEmit` |

**Залежності (додати):** `express`, `cors`, `dotenv`; dev: `tsx`, `typescript`, `@types/express`, `@types/cors`, `@types/node`

**`backend/.env.example` (додати):**

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public"
PORT=3000
```

### Frontend (`frontend/`)

| Файл | Відповідальність |
|------|------------------|
| `index.html` | Entry HTML |
| `vite.config.ts` | Dev server port 5173, proxy `/api` → backend |
| `tsconfig.json`, `tsconfig.node.json` | TypeScript для Vue |
| `src/main.ts` | `createApp(App).mount('#app')` |
| `src/App.vue` | Статус-сторінка Day 1 |
| `src/api/health.ts` | `fetchHealth(): Promise<HealthResponse>` |

**UI (мінімальний, без router/Pinia):**

- Заголовок «Interview Platform»
- Рядки статусу: Backend API, PostgreSQL, Seed HR (`hr@test.com`)
- Значення: OK (зелений) / FAIL (червоний) / Loading
- Помилка мережі: «Не вдалося підключитися до API»

**Скрипти `frontend/package.json`:**

| Скрипт | Команда |
|--------|---------|
| `dev` | `vite` |
| `build` | `vue-tsc -b && vite build` |
| `lint` | `vue-tsc --noEmit` |

**Залежності (додати):** `vue`; dev: `vite`, `@vitejs/plugin-vue`, `typescript`, `vue-tsc`, `@vue/tsconfig`

---

## Потік даних

1. Користувач відкриває `http://localhost:5173`
2. `App.vue` on mount викликає `fetch('/api/health')`
3. Vite proxy перенаправляє на `http://localhost:3000/api/health`
4. Express route:
   - `checkDatabaseHealth(prisma)` → `database`
   - `checkHrSeedUser(prisma)` → `seed`
   - формує JSON, відповідає `200`
5. Vue рендерить статуси

**Альтернативна перевірка (curl):**

```bash
curl http://localhost:3000/api/health
```

---

## Обробка помилок

| Ситуація | Backend | Frontend |
|----------|---------|----------|
| PostgreSQL недоступний | `database.ok: false`, `ok: false` | PostgreSQL: FAIL |
| Seed не виконано | `seed.ok: false`, `ok: false` | Seed HR: FAIL |
| Backend не запущений | — | «Не вдалося підключитися до API» |
| Невідома помилка Prisma | `database.ok: false`, `error` у внутрішній логіці | PostgreSQL: FAIL |

**CORS:** `cors({ origin: 'http://localhost:5173' })` — на випадок прямих запитів без proxy.

---

## Тестування

| Тест | Тип | Що перевіряє |
|------|-----|--------------|
| `seed-check.test.ts` | Unit | `checkHrSeedUser` з mock Prisma |
| `health.route.test.ts` | Unit | Route handler з mock checks |
| `healthcheck.test.js` | Unit (існуючий) | `checkDatabaseHealth` |
| `hr-user.test.js` | Unit (існуючий) | Seed helpers |

**Ручний чекліст DoD:**

```bash
cp .env.example .env
cp backend/.env.example backend/.env
docker compose up -d postgres
npm install
npm --workspace backend run db:migrate
npm --workspace backend run db:seed
npm run dev
# Відкрити http://localhost:5173 — усі статуси OK
# Відкрити http://localhost:3000/api/health — JSON ok: true
npm run build
```

---

## Збірка

- `backend build` → `backend/dist/` (JS з TypeScript)
- `frontend build` → `frontend/dist/` (статичні assets)
- Кореневий `npm run build` — обидва workspace послідовно
- `ci:bootstrap` — `lint && build` у корені (без змін логіки)

---

## Документація (README)

Додати до секції Day 1:

- Порти: frontend `5173`, backend `3000`
- Після `npm run dev`: відкрити `http://localhost:5173`
- Очікуваний UI: Backend OK, PostgreSQL OK, Seed HR OK
- `curl http://localhost:3000/api/health` — альтернативна перевірка
- Залежність від попередніх кроків: Docker Postgres + migrate + seed

---

## Поза scope

- Pinia, Vue Router, компонентна бібліотека
- JWT, auth routes
- Backend віддає `frontend/dist` (production single-port) — Day 22
- Socket.IO
- ESLint конфігурація (лише `tsc`/`vue-tsc` typecheck як lint)
- Міграція існуючих JS-модулів на TypeScript

---

## Обґрунтування

- **Один `/api/health`** — мінімальний контракт для Day 1 UI і curl; внутрішньо модульний
- **Збереження JS-модулів** — не переписуємо працюючий healthcheck/seed; `allowJs` знижує ризик регресії
- **Vue 3 + Express + TS одразу** — відповідає MVP design, без throwaway scaffold
- **HTTP 200 з `ok: false`** — frontend показує детальні FAIL без обробки error status codes

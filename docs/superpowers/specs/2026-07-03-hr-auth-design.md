# Дизайн: HR-автентифікація (День 3)

## Контекст

Day 3 MVP: HR може зайти на сайт під своїм акаунтом. У базі вже є модель `User` з `passwordHash` (SHA-256) і seed `hr@test.com` / `123456`. Backend — Express без auth; frontend — Vue 3 без router і Pinia.

За PD-013 і MVP-дизайном: JWT у заголовку `Authorization: Bearer`; окремі флоу для HR і кандидата (кандидат — пізніше).

## Мета

- Сторінка логіну для HR (email + пароль).
- Видача JWT-сесії після успішної перевірки.
- Захист HR-сторінок і API: без логіну — редірект на `/login` (frontend) або `401` (backend).

## Прийняті рішення (brainstorming)

| Питання | Рішення |
|---------|---------|
| Куди після логіну | `/` — поточна головна зі статусом і чатом |
| Захист `/` | Так, без JWT → редірект на `/login` |
| Зберігання JWT | `localStorage`, ключ `auth_token` |
| Захист backend API | Так, включно з `POST /api/llm/complete` |
| Термін дії JWT | 24 години |
| Хто може логінитись у Дні 3 | Лише HR |

## Обраний підхід

**vue-router + Pinia + Express middleware** — відповідає MVP-стеку, зручно розширювати для кабінету кандидата та майбутніх HR-маршрутів.

Альтернативи відхилені:
- Composable без Pinia — Pinia знадобиться для interview/chat; зайва міграція пізніше.
- Захист лише на backend без router guard — немає URL `/login`, гірше для DoD.

---

## Backend

### Залежності

- `jsonwebtoken` + `@types/jsonwebtoken`

### Env

```
JWT_SECRET=...        # обов'язково, мін. 8 символів; без нього сервер не стартує
JWT_EXPIRES_IN=24h    # опційно, default 24h
```

Додати в `backend/.env.example`.

### Пароль

Перевірка через існуючий `hashPassword` (SHA-256) з `backend/src/seed/hr-user.js` — той самий алгоритм, що в seed. Заміна на bcrypt — поза scope Дня 3.

### Ендпоінти

**`POST /api/auth/login`** (публічний)

```json
// Request
{ "email": "hr@test.com", "password": "123456" }

// 200
{ "token": "<jwt>", "user": { "id": "...", "email": "hr@test.com", "role": "HR" } }

// 401 — невірний email/пароль
{ "error": "Invalid credentials" }

// 403 — користувач не HR
{ "error": "HR access only" }
```

**`GET /api/auth/me`** (`requireAuth`)

```json
// 200
{ "user": { "id": "...", "email": "hr@test.com", "role": "HR" } }

// 401
{ "error": "Unauthorized" }
```

### JWT payload

```json
{ "sub": "<userId>", "email": "hr@test.com", "role": "HR", "iat": ..., "exp": ... }
```

### Middleware

| Middleware | Дія |
|----------|-----|
| `requireAuth` | Читає `Authorization: Bearer <token>`, верифікує JWT, кладе `req.user` |
| `requireHr` | Після `requireAuth` — `req.user.role === HR` |

### Захист маршрутів

| Маршрут | Доступ |
|---------|--------|
| `GET /api/health` | Публічний |
| `POST /api/auth/login` | Публічний |
| `GET /api/auth/me` | `requireAuth` |
| `POST /api/llm/complete` | `requireAuth` + `requireHr` |
| Майбутні HR-ендпоінти | `requireAuth` + `requireHr` |

### Структура файлів

```
backend/src/
  auth/
    password.ts      # hashPassword (спільна логіка з seed)
    jwt.ts           # signToken, verifyToken
    middleware.ts    # requireAuth, requireHr
  routes/
    auth.ts          # login, me
```

### Тести backend

- login: вірні credentials → 200 + token
- login: невірний пароль → 401
- login: CANDIDATE → 403
- `/api/auth/me`: з/без токена
- `/api/llm/complete`: без токена → 401

---

## Frontend

### Залежності

- `vue-router`
- `pinia`

### Маршрути

| Шлях | Компонент | Доступ |
|------|-----------|--------|
| `/login` | `LoginView.vue` | Публічний; якщо вже залогінений → `/` |
| `/` | `HomeView.vue` | `meta.requiresAuth: true` |

`HomeView` — вміст поточної `App.vue` (статус системи + `ChatPanel`) плюс шапка з email і кнопкою «Вийти».

### Pinia store `auth`

```typescript
// state
token: string | null     // синхронізовано з localStorage (ключ auth_token)
user: { id, email, role } | null

// actions
login(email, password)
logout()
restoreSession()         // token з localStorage → GET /api/auth/me
```

### Router guard

```
beforeEach:
  if meta.requiresAuth && !token → /login?redirect=<path>
  if path === '/login' && token → /
```

При старті: `await auth.restoreSession()` — 401 від `me` очищає сесію.

### LoginView

- Поля email, password; кнопка «Увійти»
- Помилки: невірні дані, не HR, мережа
- Після успіху → `redirect` query або `/`

### API-клієнт

`frontend/src/api/client.ts` — `fetch` з `Authorization: Bearer <token>`.

`api/llm.ts` і `api/auth.ts` використовують цей клієнт.

### Структура файлів

```
frontend/src/
  api/
    auth.ts
    client.ts
  stores/
    auth.ts
  views/
    LoginView.vue
    HomeView.vue
  router/
    index.ts
  App.vue            # <RouterView />
  main.ts            # pinia + router
```

---

## Обробка помилок

### Backend

| Ситуація | Код | Тіло |
|----------|-----|------|
| Немає / невалідний Bearer | 401 | `{ "error": "Unauthorized" }` |
| JWT прострочений / зіпсований | 401 | `{ "error": "Unauthorized" }` |
| Роль не HR на захищеному маршруті | 403 | `{ "error": "Forbidden" }` |
| Невірний email/пароль при login | 401 | `{ "error": "Invalid credentials" }` |
| CANDIDATE на login | 403 | `{ "error": "HR access only" }` |

### Frontend

| Ситуація | Поведінка |
|----------|-----------|
| 401 від `/api/auth/me` при restore | Очистити токен, `/login` |
| 401 від API під час роботи | logout + `/login` |
| 401 від login | «Невірний email або пароль» |
| 403 від login | «Доступ лише для HR» |
| Мережа | «Не вдалося підключитися до сервера» |

---

## Ручний чекліст (DoD Дня 3)

1. `/` без логіну → редірект на `/login`
2. `hr@test.com` / `123456` → `/`, чат видимий
3. Повідомлення в чат → відповідь LLM
4. Перезавантаження → сесія з `localStorage`
5. «Вийти» → `/login`, `/` знову закрита
6. `curl POST /api/llm/complete` без токена → 401
7. `curl POST /api/auth/login` → `{ token, user }`
8. `npm run build` у корені — без помилок

## Документація (README)

- Тестовий акаунт HR
- `JWT_SECRET` у env
- Приклад curl з `Authorization: Bearer`
- Сценарій входу через UI

## Поза scope Дня 3

- Реєстрація / вхід кандидата
- Refresh token
- bcrypt
- «Забули пароль»
- Rate limiting на login

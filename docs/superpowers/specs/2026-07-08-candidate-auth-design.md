# Candidate Auth & Empty Cabinet Design (Day 10)

## Context

Проєкт уже має HR-only auth flow:

- frontend login сторінка: `/login`
- backend login endpoint: `POST /api/auth/login` (пускає лише `HR`)
- role-aware JWT payload (`HR` / `CANDIDATE`) вже підтримується
- HR-кабінет працює під маршрутом `/`

Завдання Day 10: додати окремий candidate auth flow без змішування з HR-флоу.

## Goals

1. Кандидат може зареєструватись.
2. Кандидат може залогінитись.
3. Після входу кандидат потрапляє в порожній кабінет `/candidate`.
4. HR і Candidate ізольовані: кожен бачить лише "свою" зону.

## Non-goals

- Candidate prep-chat
- Candidate profile extraction/confirm
- Join interview by code
- Live interview room

Ці задачі лишаються на наступні дні плану.

## Decisions (validated)

### Routing (frontend)

- Candidate register: `/candidate/register`
- Candidate login: `/candidate/login`
- Candidate cabinet (empty): `/candidate`
- HR login лишається `/login`
- HR cabinet лишається `/`

### Auth API (backend)

- `POST /api/auth/hr/login`
- `POST /api/auth/candidate/register`
- `POST /api/auth/candidate/login`
- `GET /api/auth/me` (shared, без змін по контракту)

### Cross-role navigation behavior

Для вже авторизованих користувачів:

- `HR` при спробі відкрити candidate-зону редіректиться на `/`
- `CANDIDATE` при спробі відкрити HR-зону редіректиться на `/candidate`

Показ окремої 403-сторінки для цього кроку не вводимо.

## Architecture

## Backend changes

1. Розділити login endpoint-и за роллю:
   - HR-login endpoint використовує поточну HR-логіку валідації.
   - Candidate-login endpoint має таку саму схему перевірки credentials, але вимагає роль `CANDIDATE`.
2. Додати register endpoint для кандидата:
   - створює нового `User` з `role: CANDIDATE`
   - хешує пароль чинним механізмом (`hashPassword`)
   - повертає JWT одразу після успішної реєстрації.
3. `auth/me` лишається спільним, бо роль уже міститься в токені й повертається клієнту.

## Frontend changes

1. Додати нові view:
   - `CandidateRegisterView`
   - `CandidateLoginView`
   - `CandidateHomeView` (порожній кабінет)
2. Розширити router:
   - публічні маршрути candidate auth
   - protected candidate маршрут `/candidate`
3. Оновити auth/navigation guard-и:
   - guard має враховувати `requiredRole` мета-поле маршруту
   - у випадку рольового mismatch робити редірект у "свій" кабінет
4. Оновити frontend auth API:
   - окремі методи для HR login, candidate register, candidate login
   - єдиний shape `AuthUser` лишається спільним.

## Data Flow

### Candidate register

1. Користувач відкриває `/candidate/register`.
2. Надсилає `email` + `password`.
3. Backend:
   - валідує payload
   - нормалізує email
   - перевіряє унікальність
   - створює `User(role=CANDIDATE)`
   - підписує JWT
4. Frontend зберігає токен, оновлює auth store, редіректить на `/candidate`.

### Candidate login

1. Користувач відкриває `/candidate/login`.
2. Надсилає `email` + `password`.
3. Backend перевіряє credentials і роль `CANDIDATE`.
4. При success frontend переходить на `/candidate`.

### HR login

1. HR використовує `/login`.
2. Frontend викликає `POST /api/auth/hr/login`.
3. При success редірект на `/`.

## Error Handling

## API status codes

- `400` — invalid payload (порожні/некоректні поля)
- `401` — invalid credentials
- `403` — role mismatch for endpoint
- `409` — email already exists (register)

## UI messages

- `401`: "Невірний email або пароль"
- `403`: "Доступ лише для HR" або "Доступ лише для кандидата"
- `409`: "Користувач з таким email вже існує"
- network error: "Не вдалося підключитися до сервера"

## Testing Strategy

## Backend tests

1. `candidate/register`:
   - створює `User` із `role=CANDIDATE`
   - повертає token + user
2. `candidate/register` duplicate email -> `409`
3. `candidate/login` success for candidate
4. `candidate/login` with HR user -> `403`
5. `hr/login` with candidate user -> `403`
6. invalid password -> `401`

## Frontend verification

1. Register candidate via UI -> `/candidate`
2. Login candidate via UI -> `/candidate`
3. Candidate відкриває HR route -> редірект `/candidate`
4. HR відкриває candidate route -> редірект `/`
5. Logout із `/candidate` очищає сесію і веде на `/candidate/login`

## Incremental Plan (implementation order)

1. Backend auth routes (new endpoints, tests green)
2. Frontend auth API client updates
3. New candidate views + router updates
4. Role-aware guard updates
5. Empty candidate cabinet page + logout
6. README updates (routes/endpoints/manual check)

## Acceptance Criteria (Day 10 DoD)

1. Демо: кандидат реєструється, логіниться, бачить `/candidate`.
2. Сценарій: реєстрація створює `User.role = CANDIDATE`.
3. Role isolation: HR і Candidate не заходять у чужий кабінет; отримують редірект у свій.
4. Build: `npm run build` проходить.
5. README оновлено новими маршрутами й endpoint-ами.

## Risks & Mitigations

- Ризик: регресія поточного HR login flow.
  - Мітигація: залишити HR logic ізольованою і покрити тестом `hr/login success`.
- Ризик: помилки guard-ів через неініціалізовану сесію.
  - Мітигація: зберегти поточний `restoreSession()` перед перевіркою meta-правил.
- Ризик: нечітка UX-поведінка при role mismatch.
  - Мітигація: єдине правило редіректа на "свій" home для всіх protected route-ів.


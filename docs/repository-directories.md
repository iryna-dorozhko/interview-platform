# Структура директорій репозиторію

Опис топ-рівневих директорій `interview-platform`. Кожен розділ зібрано окремим explore-субагентом.

Пропущено: `node_modules`, `.git`, `.playwright-mcp` (залежності / VCS / тимчасові дампи Playwright MCP).

---

## `.cursor`

**Призначення:** Каталог конфігурації Cursor IDE для репозиторію interview-platform. Тут лежать проєктні правила для агента, підключення MCP і локальні артефакти debug-сесій — не runtime-код застосунку.

**Вміст:**
- `rules/` — проєктні Cursor Rules
  - `ukrainian-language.mdc` — правило з `alwaysApply: true`: відповідати українською; ідентифікатори/код залишати англійською; коміти/PR можуть бути англійською
- `mcp.json` — конфіг MCP-серверів: один сервер `playwright` на `http://localhost:8931/mcp` (браузерна автоматизація)
- `debug-*.log` (8 файлів: `3b9855`, `549084`, `66c73a`, `7732b7`, `a5331c`, `b00508`, `c96f8b`, `e030db`) — NDJSON-логи інструментації агента (`sessionId`, `hypothesisId`, `runId`, `location`, `message`, `data`); теми: vacancy match / LLM ranking, PATCH invitation, HR create-interview, router/auth на фронті

**Роль у проєкті:** Задає поведінку Cursor-агента в цьому репо (мова відповідей) і дає доступ до Playwright MCP для UI-перевірок. Debug-логи — сліди минулих debug-сесій по фічах платформи (матчинг вакансій, інвайти, сесії), не частина бізнес-логіки.

**Важливі деталі:**
- Правило української мови реально застосовується як workspace rule (`alwaysApply: true`).
- Playwright MCP очікує локальний сервер на порту `8931`; без нього MCP недоступний.
- У `.gitignore` немає згадки `.cursor` — логи й конфіг можуть потрапляти в git, якщо їх додати.
- Інших типових файлів Cursor (`settings.json`, `AGENTS.md`, hooks) у цій директорії немає.

---

## `.superpowers`

**Призначення:** Локальний робочий кеш плагіна Cursor Superpowers — артефакти brainstorming (візуальні мокапи) і SDD (subagent-driven development: брифи, прогрес, рев’ю). Це не частина runtime продукту; у корені репо вже в `.gitignore` (рядок `.superpowers/`).

**Вміст:**
- **`brainstorm/`** — 7 сесій виду `<pid>-<timestamp>/`, кожна з:
  - **`content/`** — статичні HTML-екрани (мокапи UI: live-кімната, layout звітів, design data model/API/UI/testing, waiting-екрани тощо; українською, наприклад `demo-live-room.html` з акцентом Calm Slate + Teal).
  - **`state/`** — `server.pid`, `server.log` (JSON-події локального preview-сервера: `server-started`, `screen-added`, кліки користувача), маркер `server-stopped`.
- **`sdd/`** — робочі файли виконання планів (у `.gitignore` всередині: `*`):
  - `progress.md`, `progress-application-status-hr-letters.md` — статус задач, гілка, worktree, BASE-коміт, посилання на план у `docs/superpowers/plans/`.
  - `task-*-brief.md` — покрокові брифи для імплементер-агента (файли, інтерфейси, чекбокси кроків).
  - `task-*-report.md`, `task-*-review.md`, `final-review.md` — звіти й рев’ю після задач.
  - `review-<base>..<head>.diff` — пакети diff для рев’ю.

**Роль у проєкті:** Проміжне сховище агентського workflow: brainstorming пише мокапи сюди під час дизайну (до специфікацій у `docs/superpowers/specs/`); SDD пише сюди брифи/прогрес під час імплементації планів з `docs/superpowers/plans/` (наприклад candidate prep chat history, application status з HR letters, company-agent neutral seniority). Плани явно кажуть писати report у `.superpowers/sdd/` і не комітити.

**Важливі деталі:**
- Відрізняти від **`docs/superpowers/`** — там канонічні specs/plans у git; `.superpowers/` — ефемерний локальний стан.
- Brainstorm-сервер слухає localhost (у логах порти на кшталт `55468`) і роздає HTML з `content/`.
- `sdd/.gitignore` з `*` підкреслює: весь вміст SDD навмисно поза версіонуванням.

---

## `.vscode`

**Призначення:** Workspace-настройки редактора Cursor/VS Code для цього репозиторію. Застосовуються автоматично при відкритті проєкту й перевизначають/доповнюють особисті user settings.

**Вміст:**
- `settings.json` — єдиний файл у директорії; піддиректорій немає. Містить налаштування розширення **Vetur** (класичний Vue tooling для VS Code):
  - `vetur.validation.template` / `script` / `style` → `false` — вимкнена валідація шаблонів, скриптів і стилів
  - `vetur.ignoreProjectWarning` → `true` — приховує попередження Vetur про проєкт (типово про несумісність із Vue 3 / відсутність очікуваної структури)

**Роль у проєкті:** Забезпечує спільне IDE-середовище для команди: менше шуму від Vetur у Vue-фронтенді (`frontend/` з `.vue` файлами). Немає `launch.json`, `tasks.json`, `extensions.json` — лише ці workspace settings.

**Важливі деталі:** Директорія мінімальна (1 файл, ~150 байт). Конфіг виглядає як «приглушення» Vetur, а не повноцінна Vue-інтеграція; для Vue 3 зазвичай використовують Volar (`Vue - Official`), тож ці флаги ймовірно лишилися для сумісності або щоб уникнути конфліктів, якщо Vetur ще встановлений.

---

## `.worktrees`

**Призначення:** Локальний контейнер для ізольованих Git worktree (окремі checkout гілок поруч із основним репо), щоб агенти/розробники могли працювати над фічами без змішування змін у головному робочому дереві. Зараз директорія порожня — лише «полиця» під майбутні/тимчасові worktree.

**Вміст:**
- сама `.worktrees/` — порожня директорія (створена ~22–23 липня 2026; `ls` показує лише `.` і `..`, файлів і піддиректорій немає)
- активних підшляхів на кшталт `vacancy-match-application` зараз немає

**Роль у проєкті:**
- у `.gitignore` (рядки 67–68) явно: `# Git worktrees (isolated feature branches)` → `.worktrees/` — вміст не комітиться
- `git worktree list` показує лише основний checkout: `/Users/iruna/interview-platform-1` на `main`
- у плані `docs/superpowers/plans/2026-07-20-candidate-matches-top5.md` зафіксовано очікуване використання: реалізація в `.worktrees/vacancy-match-application` (гілка `feat/vacancy-match-application`), тоді як spec/plan лишаються в корені
- відповідає конвенції skill `using-git-worktrees`: пріоритетний шлях `.worktrees/` у корені проєкту для ізольованої роботи

**Важливі деталі:**
- директорія **ігнорується git** (`git check-ignore` → `.gitignore:68:.worktrees/`)
- згадка в docs про `.worktrees/vacancy-match-application` — історичний/плановий шлях; на диску цього worktree зараз немає (ймовірно вже прибраний після роботи)
- порожній стан нормальний: worktree додають під задачу і прибирають після merge/cleanup

---

## `backend`

**Призначення:** Node.js/TypeScript сервер платформи AI-інтерв’ю: REST API (`/api`), реалтайм через Socket.IO (live-кімнати й діалоги), Prisma/PostgreSQL і шар LLM-агентів для prep, live-сесії, матчингу вакансій і HR-рішень.

**Вміст:**
- `package.json` — скрипти `dev`/`build`/`start`/`test`, Prisma (`db:migrate`, `db:seed`), `llm:test`
- `src/server.ts` — головний entry: Express + HTTP + Socket.IO, маршрути, graceful shutdown
- `src/server-lifecycle.ts` — коректне завершення (HTTP, IO, orchestrator, LLM, Prisma)
- `src/routes/` — REST: `auth`, `health`, `prep`, `company-prep`, `candidate-prep`, `interviews`, `vacancies`, `dialogs`, `reports`, `hr-applications`, `candidate-*`, `llm`
- `src/socket/` — кімнати інтерв’ю (`room`, `orchestrator`), діалоги, presence/access, live-сесія
- `src/agents/` + `prompts/` — агенти (company/candidate/arbiter live, prep, final-report, vacancy-match, decision/decline letters)
- `src/llm/` — провайдери: `omlx`, `gemini`, `openai`, `cursor-acp` через `factory.ts`
- `src/auth/` — JWT, паролі, middleware `requireAuth` / `requireHr` / `requireCandidate`
- `src/db/` — Prisma-клієнт, healthcheck
- `src/services/` — бізнес-логіка: vacancy match, match-score, HR-рішення по заявках
- `src/utils/` — join codes, invitations, readiness, vacancy requirements/conditions
- `src/seed/` — тестові/допоміжні seed-хелпери (HR user/vacancy/interview)
- `prisma/` — `schema.prisma`, міграції, `seed.js`
- `scripts/llm-test.ts` — ручна перевірка LLM
- `prisma.config.ts`, `tsconfig.json`, `.env.example` — конфіг БД/JWT/LLM
- `dist/` — зібраний вивід `tsc`

**Роль у проєкті:** Єдиний backend для frontend (CORS на `localhost:5173`). Обслуговує HR і кандидатів: реєстрація/логін, профілі й prep-чати, вакансії/заявки/запрошення, live-інтерв’ю з агентами, фінальні звіти, діалоги HR↔кандидат, матчинг і листи рішень. Дані в PostgreSQL; LLM підключається через env `LLM_PROVIDER`.

**Важливі деталі:**
- **Стек:** Express 4, Socket.IO 4, Prisma 7 + `pg`, JWT, TypeScript/`tsx`, Node test runner
- **Entry points:** `npm run dev` → `tsx watch src/server.ts`; prod → `node dist/server.js`; порт за замовчуванням `3000`
- **Доменні сутності (Prisma):** User (HR/CANDIDATE), Vacancy, Interview, prep-сесії (HR/company/candidate), LiveSession/LiveMessage, Invitation, FinalReport, VacancyApplication, Dialog, VacancyMatchScore тощо
- **Live-оркестрація:** `createRoomOrchestrator` керує ходами arbiter → company/candidate агентів (debounce, ліміт кроків)
- **Тести:** щільне покриття поруч із модулями (`*.test.ts` / `*.test.js`) — майже всі routes, agents, llm, socket

---

## `docs`

**Призначення:** Зберігає проєктну документацію для розробки interview-platform: затверджені дизайн-специфікації, покрокові плани реалізації (workflow Superpowers) і готовий український скрипт для ручної перевірки агентних діалогів. Це не runtime-код і не публічна user-facing документація продукту.

**Вміст:**
- `manual-test-dialogues.uk.md` — скрипт відповідей для ручного тестування (вакансія Middle Backend Developer); секції: HR-анкета компанії (`/vacancies/:id/prep`), анкета кандидата, live-чат, шпаргалка, альтернативний набір; акаунти `hr@test.com` / `candidate@test.com`, код `TEST01`.
- `superpowers/` — артефакти агентного циклу brainstorming → design → plan → implement:
  - `specs/` (~59 файлів `YYYY-MM-DD-*-design.md`) — дизайн: контекст, рішення з brainstorming, архітектура, scope/out-of-scope; теми від Day 1 bootstrap і схеми БД до Arbiter Conductor, HR-чатів, фінальних звітів, eval-framework.
  - `plans/` (~59 файлів `YYYY-MM-DD-*.md`) — implementation plans з чекбоксами (`- [ ]`), посиланням на відповідний spec, списком файлів і TDD-кроками для agentic workers (`subagent-driven-development` / `executing-plans`).

**Роль у проєкті:** Джерело правди для фіч під час імплементації агентами й людьми. Плани посилаються на specs; `Product-Decisions.md` цитує specs як реалізацію рішень (наприклад, vacancy/interview split, Arbiter Conductor, invitation dual-channel). `manual-test-dialogues.uk.md` оновлюється разом зі змінами промптів/flow (наприклад, deep-interview prep) і використовується для end-to-end перевірки чатів.

**Важливі деталі:**
- Іменування датоване (`2026-07-02` … `2026-07-23`); багато пар «день N» (Day 1 bootstrap, Day 10–18 auth/agents/live).
- Specs часто зі статусом «Затверджено в brainstorming»; публічні тексти/промпти — українською.
- Покриття широке: bootstrap (Vite/Vue/Express), LLM, HR/candidate auth і prep, live-оркестратор і агенти, звіти/рішення HR, вакансії/матчі, UI (calm-slate-teal), eng-only agent eval.

---

## `frontend`

**Призначення:** Vue 3 SPA для interview-platform — UI для HR і кандидатів: вакансії, prep-чат з агентами, live-кімнати інтерв’ю, діалоги, матчі та звіти. Спілкується з backend через REST `/api` і Socket.IO.

**Вміст:**
- `package.json` — скрипти `dev`/`build`/`lint`/`test`, залежності Vue 3, Pinia, vue-router, socket.io-client, marked, dompurify
- `index.html` — HTML-оболонка (`lang="uk"`), монтує `#app`, підключає `src/main.ts`
- `vite.config.ts` — Vite + Vue plugin; порт `5173`; proxy `/api` і `/socket.io` → `localhost:3000`
- `tsconfig*.json` — TypeScript для app і Vite-конфігу
- `public/` — статичні файли (`company-profile-ui-demo.html`)
- `dist/` — зібраний білд
- `src/` — увесь застосунок:
  - `main.ts` — bootstrap (Pinia, router, CSS)
  - `App.vue` — лише `<RouterView />`
  - `router/` — маршрути HR (`/`) і кандидата (`/candidate`), auth-guards за роллю
  - `api/` — REST-клієнти + `socket.ts` (auth, vacancies, interviews, prep, dialogs, reports тощо)
  - `views/` — сторінки (логін, вакансії, кімнати інтерв’ю, звіти, діалоги…)
  - `components/` — chat-панелі, сайдбари, модалки створення вакансій/інтерв’ю
  - `composables/` — `usePrepChat`, `useInterviewRoom`, `useDialogThread` (+ тести)
  - `layouts/` — `HrLayout`, `CandidateLayout`
  - `stores/` — Pinia `auth` (сесія HR/CANDIDATE)
  - `styles/` — `tokens.css`, `base.css`
  - `utils/` — typing indicator, invite/join helpers

**Роль у проєкті:** Єдиний клієнтський шар: HR керує компанією, вакансіями, заявками й інтерв’ю; кандидат — профіль, матчі, join за посиланням (`/join`), live-кімната. Realtime (чат, статус агентів) іде через Socket.IO; у dev Vite проксує запити на backend.

**Важливі деталі:**
- Стек: Vue 3 + TypeScript + Vite 6 + Pinia + vue-router 5 + Socket.IO client
- Entry: `index.html` → `src/main.ts` → `App.vue` → router
- Два UX: HR (`HrLayout`, `/login`) і Candidate (`CandidateLayout`, `/candidate/login|register`)
- Auth: Bearer-токен у `localStorage`, `fetchWithAuth` у `api/client.ts`, guards у router
- Ключові фічі UI: prep-чат (`PrepChatPanel`, `usePrepChat`), live room (`LiveChatPanel`, `useInterviewRoom`), діалоги, звіти після інтерв’ю
- Markdown у чаті: `marked` + `dompurify`

---

## `reports`

**Призначення:** Архів денних звітів розробки MVP AI-платформи співбесід (план на ~22 дні) плюс артефакти ручної/E2E верифікації. Це не runtime API «фінальних звітів інтерв’ю» (`/api/reports`), а документація прогресу команди.

**Вміст:**
- `Day 1.txt` … `Day 16.txt` (16 файлів) — детальні щоденні звіти українською: підсумок дня, що зроблено, коміти, відкриті питання, плани на далі (напр. Day 1 — bootstrap monorepo/БД; Day 14 — ручний повний сценарій; Day 16 — realtime діалоги, статуси заявок).
- `e2e-full-scenario-result.json` + `e2e-full-scenario.log` (14 липня) — прогін повного сценарію (HR login → prep вакансії → інтерв’ю → агенти → фінальний звіт); у JSON є `steps`, `checks`, `report` (recommendation/matchScore), `durationMs` ~584 с.
- `e2e-hr-applications-live-result.json` + `e2e-hr-applications-live.log` (20 липня) — прогін заявок HR через live до звіту (`ok: true`, кілька applications зі статусами CONVERTED/ENDED).
- `screenshots/` (~59 PNG) — знімки UI за днями (`day7-…`, `day12-…`, `day19-…`, `day21-…`, також `prep-chat.png`, `prep-profile.png`): логін, prep, matches, live room, reports list тощо.

**Роль у проєкті:** Журнал прогресу та evidence для DoD/ручних перевірок. У планах (`docs/superpowers/plans/…`) файли з `reports/` згадуються як unrelated WIP («не чіпати»). У `.gitignore` директорія не виключена — артефакти лежать у репо. До продуктового `FinalReport` / `ReportView` не підключена.

**Важливі деталі:**
- Нумерація днів у назвах скріншотів інколи випереджає наявні `Day N.txt` (є `day19`/`day21` PNG при звітах лише до Day 16).
- Звіти фіксують факти (коміти, час сценаріїв, проблеми агентів), а не лише чекліст задач.
- E2E JSON показує реальні відповіді LLM і fallbacks (напр. `"final-report-seed"`, коли модель не згенерувала JSON звіту).

---

## `scripts`

**Призначення:** Коренева директорія ad-hoc утиліт для локальної розробки interview-platform: наповнення демо-даних через API, повні E2E-сценарії (API + Socket.IO) і Playwright-скрипти для скріншотів UI за «днями» фіч. Піддиректорій немає — лише 14 плоских `.mjs` файлів.

**Вміст:**

### Seed (демо-дані)
- **`seed-hr-vacancies.mjs`** — логін HR (`hr@test.com`), очищення interviews/vacancies через API+Prisma, створення 5 вакансій (Backend, Frontend, QA, DevOps, PM) з повним HR prep-чатом → finish → confirm.
- **`seed-candidates-deep-prep.mjs`** — створення 5 кандидатів (`backend@`, `frontend@`, `qa@`, `devops@`, `pm@test.com`) з різними профілями через register → `/candidate/interview/start` → deep candidate-prep → finish/confirm.

### E2E (без UI / API + сокети)
- **`e2e-full-scenario.mjs`** — повний сценарій з `docs/manual-test-dialogues.uk.md`: HR prep → confirm → interview → candidate prep → join → LIVE-чат агентів → end → report; результат у `reports/e2e-full-scenario-result.json`; є Prisma-fallback для профілів/звіту при збоях LLM.
- **`e2e-hr-applications-live.mjs`** — для кожної заявки в HR inbox без звіту: створити interview (якщо PENDING) → LIVE → end → report; результат у `reports/e2e-hr-applications-live-result.json`.

### Playwright walkthrough / скріншоти
- **`live-browser-walkthrough.mjs`** — headed Chromium (slowMo), видимий прохід HR login → inbox/vacancies → candidate login/register; браузер лишається ~2 хв для спостереження.
- **`screenshot-prep.mjs`** — API-чат HR prep + скріншоти профілю до/після confirm і чату (`day7-*`, `prep-*.png`); перевіряє українські відповіді агента.
- **`screenshot-create-interview.mjs`** — UI «Створити співбесіду», унікальність join-коду, перехід до prep (`day8-*`).
- **`screenshot-day9-day10.mjs`** — HR dashboard/vacancies/interviews + candidate register/login + блокування HR на candidate-login.
- **`screenshot-day11.mjs`** — company profile, vacancy prep gate/snapshot, arbiter process feed, candidate contacts.
- **`screenshot-day12.mjs`** — vacancy-match UI (worktree `:5174` + main `:5173`): matches, HR applications inbox; mock-дані через route interception.
- **`screenshot-day12-day14.mjs`** — candidate dashboard, join за кодом `TEST01`, prep-чат, confirm профілю, READY.
- **`screenshot-day15-day16.mjs`** — Prisma-підготовка READY-інтерв’ю; HR list/modal/room; LIVE з Arbiter (thinking + agent messages).
- **`screenshot-day19-day20.mjs`** — кнопки «Увійти», кольорові повідомлення в LIVE, «Завершити», success-banner, рекомендація в списку звітів.
- **`screenshot-day21-invitation.mjs`** — створення зустрічі з email/датою, копіювання запрошення, detail invitation, reports list/detail, candidate invitations.

**Роль у проєкті:** Ручні інструменти для seed демо-середовища, регресії повного user-flow і документування UI скріншотами в `reports/screenshots`. Не підключені як npm-скрипти в root `package.json` — запускаються напряму (`node scripts/...`) при піднятих `localhost:3000` (API) і `localhost:5173` (UI). Окремо від `backend/scripts/` (llm-test тощо).

**Важливі деталі:**
- Тестові креденшали захардкоджені: `hr@test.com` / `123456`, кандидати з `@test.com`.
- Багато screenshot-скриптів мають абсолютний шлях до локального Chromium Playwright — прив’язка до машини розробника.
- E2E і seed мають retry на LLM rate-limit (429 / «ліміт» / `RESOURCE_EXHAUSTED`).
- Скріншоти іменуються за «днями» розробки (day7–day21); спільний вихід — `reports/screenshots`.
- Деякі скрипти пишуть напряму в Postgres через Prisma (`seed-hr-vacancies`, day15/16/19), коли API недостатньо для підготовки стану.

---

## `wrote`

**Призначення:** Це не функціональна частина interview-platform. Фактична назва — `wrote ` (з пробілом у кінці); усередині лише порожнє вкладене дерево шляхів. Схоже на артефакт помилкового `mkdir`/`makedirs` зі рядка на кшталт `wrote /Users/iruna/interview-platform-1/.superpowers/sdd` (слово `wrote` + абсолютний шлях потрапили в відносний path).

**Вміст:**
- `wrote /` — корінь з пробілом у імені; файлів немає
- `Users/iruna/interview-platform-1/.superpowers/sdd/` — порожні вкладені директорії (дзеркало абсолютного шляху)
- жодного файлу у всьому дереві

**Роль у проєкті:** Не використовується кодом, збіркою чи runtime. У репозиторії немає посилань на `wrote`. Це «сміття» від tooling Superpowers SDD; робочі артефакти лежать у справжньому `/Users/iruna/interview-platform-1/.superpowers/sdd/` (`task-*-brief.md`, `progress.md`, diffs тощо; каталог у `.gitignore`).

**Важливі деталі:**
- Шлях `…/wrote` без пробілу **не існує** — через це звичайний `ls wrote` падає з «No such file»
- Вкладений `.superpowers/` підпадає під ігнор `.gitignore` (рядок `.superpowers/`)
- Створювати/комітити це не потрібно; безпечно видалити вручну, якщо захочете прибрати артефакт

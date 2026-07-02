# Дизайн: Схема бази даних для MVP (users, interviews, messages, profiles, reports)

## Контекст

MVP платформи співбесід уже визначений у проєктних документах: окремі ролі `HR` і `CANDIDATE`, prep-фази для обох сторін, live-кімната з агентами, фінальний звіт після завершення співбесіди.  
Цей документ фіксує цільову реляційну модель даних для PostgreSQL у Docker.

## Мета

Побудувати прозору та керовану схему БД, яка:

- покриває повний happy-path `логін -> prep -> ready -> live -> ended -> report`;
- розділяє профілі компанії та кандидата окремими таблицями;
- розділяє prep-повідомлення і live-повідомлення окремими таблицями;
- гарантує цілісність станів співбесіди через обмеження та індекси;
- готова до запуску в `docker compose` з PostgreSQL 16.

## Обраний підхід

### Рекомендований варіант

Нормалізована MVP-схема з точковим використанням `jsonb`:

- окремі таблиці для основних доменних сутностей;
- мінімум "магії" в універсальних таблицях;
- `jsonb` лише там, де структура списків/блоків природно змінна (плюси/ризики звіту).

### Чому не універсальні таблиці для всього

Універсальна схема (одна таблиця повідомлень чи профілів на всі типи) спрощує старт, але ускладнює:

- контроль станів;
- зрозумілі SQL-запити;
- майбутні міграції;
- діагностику помилок у продовженні MVP.

## Архітектура таблиць і зв'язків

## 1) Користувачі

### `users`

- `id` (pk, uuid або bigint)
- `email` (unique, not null)
- `password_hash` (not null)
- `role` (`HR` | `CANDIDATE`, not null)
- `created_at`, `updated_at`

Призначення: автентифікація, авторизація і прив'язка до співбесід.

## 2) Співбесіди

### `interviews`

- `id` (pk)
- `hr_user_id` (fk -> `users.id`, not null)
- `candidate_user_id` (fk -> `users.id`, nullable до join кандидата)
- `join_code` (unique, 6 символів)
- `status` (`DRAFT` | `AWAITING_CANDIDATE` | `READY` | `LIVE` | `ENDED`)
- `created_at`, `updated_at`

Призначення: центральний aggregate root для профілів, сесій та звіту.

## 3) Профілі (окремо для компанії і кандидата)

### `company_profiles`

- `id` (pk)
- `interview_id` (fk -> `interviews.id`, unique, not null)
- `role` (текст/enum)
- `requirements` (`jsonb` або `text[]`)
- `culture` (`jsonb` або `text`)
- `expectations` (`jsonb` або `text`)
- `confirmed_at` (nullable до підтвердження)
- `created_at`, `updated_at`

### `candidate_profiles`

- `id` (pk)
- `interview_id` (fk -> `interviews.id`, unique, not null)
- `experience` (`jsonb` або `text`)
- `skills` (`jsonb` або `text[]`)
- `goals` (`jsonb` або `text`)
- `summary` (`text`)
- `confirmed_at` (nullable до підтвердження)
- `created_at`, `updated_at`

Призначення: фіксація підтверджених структурованих профілів для live-етапу.

## 4) Prep-сесії та повідомлення (окремо для HR і кандидата)

### HR prep

#### `prep_sessions_hr`

- `id` (pk)
- `interview_id` (fk -> `interviews.id`, not null)
- `is_closed` (boolean, default false)
- `created_at`, `updated_at`

#### `prep_messages_hr`

- `id` (pk)
- `session_id` (fk -> `prep_sessions_hr.id`, not null)
- `author_type` (`HUMAN_HR` | `AGENT_COMPANY`)
- `content` (`text`, not null)
- `created_at`

### Candidate prep

#### `prep_sessions_candidate`

- `id` (pk)
- `interview_id` (fk -> `interviews.id`, not null)
- `is_closed` (boolean, default false)
- `created_at`, `updated_at`

#### `prep_messages_candidate`

- `id` (pk)
- `session_id` (fk -> `prep_sessions_candidate.id`, not null)
- `author_type` (`HUMAN_CANDIDATE` | `AGENT_CANDIDATE`)
- `content` (`text`, not null)
- `created_at`

Призначення: ізольоване ведення підготовчих чатів до confirm профілів.

## 5) Live-сесія та повідомлення

### `live_sessions`

- `id` (pk)
- `interview_id` (fk -> `interviews.id`, unique, not null)
- `started_at`
- `ended_at` (nullable)
- `created_at`, `updated_at`

### `live_messages`

- `id` (pk)
- `session_id` (fk -> `live_sessions.id`, not null)
- `author_type` (`HUMAN_HR` | `HUMAN_CANDIDATE` | `AGENT_ARBITER` | `AGENT_COMPANY` | `AGENT_CANDIDATE`)
- `content` (`text`, not null)
- `created_at`

Призначення: історія реального чату людей і агентів у кімнаті співбесіди.

## 6) Фінальний звіт

### `final_reports`

- `id` (pk)
- `interview_id` (fk -> `interviews.id`, unique, not null)
- `report_markdown` (`text`, not null)
- `recommendation` (`HIRE` | `MAYBE` | `REJECT`)
- `match_score` (`numeric` або `int`)
- `strengths` (`jsonb`, not null, default `[]`)
- `risks` (`jsonb`, not null, default `[]`)
- `created_at`, `updated_at`

Призначення: одноразовий підсумок після завершення співбесіди.

## Потік даних і state machine

## Статуси `interviews.status`

- `DRAFT` — співбесіду створено, код є, HR prep ще не завершено підтвердженням;
- `AWAITING_CANDIDATE` — профіль компанії підтверджений, очікується кандидат;
- `READY` — кандидат приєднався і обидва профілі підтверджені;
- `LIVE` — відкрита live-сесія;
- `ENDED` — HR завершив співбесіду, звіт згенерований.

## Основні переходи

1. `DRAFT -> AWAITING_CANDIDATE`: після підтвердження `company_profiles.confirmed_at`.
2. `AWAITING_CANDIDATE -> READY`: після join кандидата + підтвердження `candidate_profiles.confirmed_at`.
3. `READY -> LIVE`: при вході в кімнату й створенні `live_sessions`.
4. `LIVE -> ENDED`: тільки дією HR (з одночасним створенням `final_reports`).

## Правила цілісності

- Заборонити `READY -> LIVE`, якщо відсутній хоча б один confirmed profile.
- Заборонити створення другого `final_report` для того ж `interview_id`.
- Заборонити повторне завершення для `ENDED`.
- Кандидат не може бути учасником кількох активних співбесід одночасно.

## Обробка помилок

- `400 BAD_REQUEST`:
  - невалідний `join_code`;
  - невалідний перехід статусу.
- `403 FORBIDDEN`:
  - кандидат намагається завершити інтерв'ю;
  - користувач звертається до чужої співбесіди.
- `404 NOT_FOUND`:
  - `interview`/`session`/`report` не знайдено.
- `409 CONFLICT`:
  - колізія `join_code`;
  - кандидат уже зайнятий в активній співбесіді;
  - `final_report` уже існує.

## Індекси та обмеження (MVP)

- `users(email)` unique.
- `interviews(join_code)` unique.
- `interviews(hr_user_id, created_at desc)`.
- `prep_messages_hr(session_id, created_at)`.
- `prep_messages_candidate(session_id, created_at)`.
- `live_messages(session_id, created_at)`.
- `company_profiles(interview_id)` unique.
- `candidate_profiles(interview_id)` unique.
- `final_reports(interview_id)` unique.
- Частковий унікальний індекс на `interviews(candidate_user_id)` для активних статусів.

## Docker PostgreSQL

Схема розрахована на запуск з `docker compose`:

- сервіс `postgres` на `postgres:16`;
- окремий volume для даних;
- healthcheck, який очікує готовність БД;
- backend підключається через `DATABASE_URL`;
- міграції та seed запускаються командами backend після старту БД.

## Тестування і верифікація

Мінімальний checklist для Day 1:

1. Міграції застосовуються на чисту БД без помилок.
2. Seed створює тестового HR (`hr@test.com`).
3. Унікальні обмеження (`email`, `join_code`) працюють.
4. FK-обмеження захищають від "битих" зв'язків.
5. Happy path проходить:
   - HR prep -> company profile confirmed;
   - candidate join -> candidate profile confirmed;
   - `READY -> LIVE -> ENDED`;
   - `final_reports` створено один раз.

## Поза scope цього дизайну

- Версіонування профілів між інтерв'ю.
- Бібліотека шаблонів звітів.
- Мультитенантність компаній.
- Історичні архівні стани поза базовим MVP-циклом.

## Підсумок

Обрана схема дає чіткі межі між доменами (користувачі, інтерв'ю, prep, live, звіт), відповідає MVP-потоку й не перевантажує систему зайвою універсальністю.  
Вона придатна для швидкого старту, але лишає контрольовану еволюцію у наступних ітераціях.

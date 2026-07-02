# Database Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Підняти PostgreSQL у Docker, додати Prisma-схему для `users/interviews/profiles/messages/reports`, застосувати міграції та seed, і підтвердити Day 1 сценарій.

**Architecture:** `backend` стає власником Prisma-клієнта, схеми БД і seed-логіки. Реляційна модель нормалізована: окремі таблиці для company/candidate profile та окремі таблиці для prep/live повідомлень. Оркестрація запуску бази відбувається через `docker compose`, міграції запускаються з `backend`.

**Tech Stack:** Node.js, npm workspaces, PostgreSQL 16, Prisma ORM, Docker Compose.

---

## File Structure

- Create: `docker-compose.yml` — локальний стек (`postgres`, `backend`, `frontend`) з healthcheck.
- Create: `.env.example` — приклад `DATABASE_URL` та параметрів БД.
- Modify: `backend/package.json` — Prisma-залежності й скрипти `db:*`.
- Create: `backend/prisma/schema.prisma` — моделі, enum, індекси й обмеження.
- Create: `backend/prisma/seed.js` — seed тестового HR-користувача.
- Create: `backend/src/db/healthcheck.js` — проста перевірка підключення до БД.
- Create: `backend/src/db/healthcheck.test.js` — тести healthcheck.
- Modify: `README.md` — кроки запуску postgres + migration + seed.
- Create: `backend/.env.example` — локальні налаштування backend.
- Create: `backend/.gitignore` — ігнор локального `.env` і згенерованих артефактів Prisma.

### Task 1: Підготувати backend для Prisma

**Files:**
- Modify: `backend/package.json`
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Test: `backend/package.json` scripts (`npm run db:validate`)

- [ ] **Step 1: Write the failing test**

```json
{
  "scripts": {
    "db:validate": "prisma validate"
  }
}
```

Критерій fail: до встановлення Prisma команда `npm --workspace backend run db:validate` падає з `prisma: command not found`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run db:validate`  
Expected: FAIL with message similar to `prisma: command not found`.

- [ ] **Step 3: Write minimal implementation**

```json
{
  "name": "backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "echo \"backend dev placeholder\"",
    "build": "echo \"backend build placeholder\"",
    "lint": "echo \"backend lint placeholder\"",
    "db:validate": "prisma validate",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:seed": "prisma db seed"
  },
  "dependencies": {
    "@prisma/client": "^5.0.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0"
  },
  "prisma": {
    "seed": "node prisma/seed.js"
  }
}
```

```gitignore
node_modules
.env
prisma/dev.db
```

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npm --workspace backend run db:validate`  
Expected: PASS with `Prisma schema loaded` once schema file is added in Task 2.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/.gitignore backend/.env.example
git commit -m "chore: prepare backend prisma scripts and env templates"
```

### Task 2: Додати Prisma-схему з MVP-моделями

**Files:**
- Create: `backend/prisma/schema.prisma`
- Test: `backend/prisma/schema.prisma` via `db:validate`

- [ ] **Step 1: Write the failing test**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Критерій fail: схема без моделей не покриває spec, але `prisma validate` формально проходить — додатковий контрактний fail перевіряється командою grep-патерну на відсутність `model Interview`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run db:validate && rg "model Interview" backend/prisma/schema.prisma`  
Expected: FAIL at `rg` (no matches).

- [ ] **Step 3: Write minimal implementation**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  HR
  CANDIDATE
}

enum InterviewStatus {
  DRAFT
  AWAITING_CANDIDATE
  READY
  LIVE
  ENDED
}

enum LiveAuthorType {
  HUMAN_HR
  HUMAN_CANDIDATE
  AGENT_ARBITER
  AGENT_COMPANY
  AGENT_CANDIDATE
}

enum PrepHrAuthorType {
  HUMAN_HR
  AGENT_COMPANY
}

enum PrepCandidateAuthorType {
  HUMAN_CANDIDATE
  AGENT_CANDIDATE
}

enum Recommendation {
  HIRE
  MAYBE
  REJECT
}

model User {
  id             String      @id @default(cuid())
  email          String      @unique
  passwordHash   String
  role           UserRole
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  interviewsAsHr Interview[] @relation("HrInterviews")
  interviewsAsCd Interview[] @relation("CandidateInterviews")
}

model Interview {
  id              String              @id @default(cuid())
  hrUserId        String
  candidateUserId String?
  joinCode        String              @unique
  status          InterviewStatus     @default(DRAFT)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  hrUser          User                @relation("HrInterviews", fields: [hrUserId], references: [id])
  candidateUser   User?               @relation("CandidateInterviews", fields: [candidateUserId], references: [id])
  companyProfile  CompanyProfile?
  candidateProfile CandidateProfile?
  prepSessionHr   PrepSessionHr?
  prepSessionCd   PrepSessionCandidate?
  liveSession     LiveSession?
  finalReport     FinalReport?

  @@index([hrUserId, createdAt(sort: Desc)])
  @@index([candidateUserId])
}

model CompanyProfile {
  id           String    @id @default(cuid())
  interviewId  String    @unique
  role         String
  requirements Json
  culture      Json
  expectations Json
  confirmedAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  interview    Interview @relation(fields: [interviewId], references: [id])
}

model CandidateProfile {
  id          String    @id @default(cuid())
  interviewId String    @unique
  experience  Json
  skills      Json
  goals       Json
  summary     String
  confirmedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  interview   Interview @relation(fields: [interviewId], references: [id])
}

model PrepSessionHr {
  id         String          @id @default(cuid())
  interviewId String         @unique
  isClosed   Boolean         @default(false)
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
  interview  Interview       @relation(fields: [interviewId], references: [id])
  messages   PrepMessageHr[]
}

model PrepMessageHr {
  id         String           @id @default(cuid())
  sessionId  String
  authorType PrepHrAuthorType
  content    String
  createdAt  DateTime         @default(now())
  session    PrepSessionHr    @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}

model PrepSessionCandidate {
  id          String                  @id @default(cuid())
  interviewId String                  @unique
  isClosed    Boolean                 @default(false)
  createdAt   DateTime                @default(now())
  updatedAt   DateTime                @updatedAt
  interview   Interview               @relation(fields: [interviewId], references: [id])
  messages    PrepMessageCandidate[]
}

model PrepMessageCandidate {
  id         String                  @id @default(cuid())
  sessionId  String
  authorType PrepCandidateAuthorType
  content    String
  createdAt  DateTime                @default(now())
  session    PrepSessionCandidate    @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}

model LiveSession {
  id          String        @id @default(cuid())
  interviewId String        @unique
  startedAt   DateTime      @default(now())
  endedAt     DateTime?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  interview   Interview     @relation(fields: [interviewId], references: [id])
  messages    LiveMessage[]
}

model LiveMessage {
  id         String         @id @default(cuid())
  sessionId  String
  authorType LiveAuthorType
  content    String
  createdAt  DateTime       @default(now())
  session    LiveSession    @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}

model FinalReport {
  id            String         @id @default(cuid())
  interviewId   String         @unique
  reportMarkdown String
  recommendation Recommendation
  matchScore    Int
  strengths     Json
  risks         Json
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  interview     Interview      @relation(fields: [interviewId], references: [id])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend run db:validate && rg "model Interview" backend/prisma/schema.prisma`  
Expected: PASS; `rg` знаходить `model Interview`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: add prisma schema for interview mvp data model"
```

### Task 3: Додати seed тестового HR

**Files:**
- Create: `backend/prisma/seed.js`
- Modify: `backend/package.json` (if seed script path changed)
- Test: `backend/prisma/seed.js`

- [ ] **Step 1: Write the failing test**

```js
// expected behavior contract
// running seed must create hr@test.com with role HR
```

Критерій fail: `npm --workspace backend run db:seed` падає через відсутній `prisma/seed.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run db:seed`  
Expected: FAIL with `Cannot find module '.../prisma/seed.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
const { PrismaClient, UserRole } = require("@prisma/client");
const crypto = require("node:crypto");

const prisma = new PrismaClient();

async function main() {
  const email = "hr@test.com";
  const passwordHash = crypto.createHash("sha256").update("123456").digest("hex");

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      role: UserRole.HR
    }
  });

  console.log(`Seeded HR user: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend run db:generate && npm --workspace backend run db:seed`  
Expected: PASS with log `Seeded HR user: hr@test.com`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.js backend/package.json
git commit -m "feat: add prisma seed for default hr user"
```

### Task 4: Підняти PostgreSQL у Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `README.md`
- Test: `docker-compose.yml` via `docker compose up -d postgres`

- [ ] **Step 1: Write the failing test**

```yaml
# contract: docker compose must expose postgres:5432 and pass healthcheck
```

Критерій fail: `docker compose up -d postgres` не працює, бо `docker-compose.yml` відсутній.

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose up -d postgres`  
Expected: FAIL with `no configuration file provided`.

- [ ] **Step 3: Write minimal implementation**

```yaml
services:
  postgres:
    image: postgres:16
    container_name: interview-platform-postgres
    environment:
      POSTGRES_DB: interview_platform
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d interview_platform"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres_data:
```

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public"
POSTGRES_DB=interview_platform
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose up -d postgres && docker compose ps`  
Expected: PASS; service `postgres` in `healthy` or `running` state.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example README.md
git commit -m "chore: add docker compose postgres service for local db"
```

### Task 5: Застосувати міграцію й перевірити індекси/обмеження

**Files:**
- Modify: `backend/prisma/schema.prisma` (if migration feedback requires)
- Create: `backend/prisma/migrations/*`
- Test: migration SQL and runtime constraints

- [ ] **Step 1: Write the failing test**

```sql
-- contract checks (executed via psql):
-- unique join_code
-- unique profiles per interview
-- unique final report per interview
```

Критерій fail: до міграції таблиці не існують, `SELECT * FROM "Interview";` падає.

- [ ] **Step 2: Run test to verify it fails**

Run: `psql postgresql://postgres:postgres@localhost:5432/interview_platform -c 'SELECT * FROM "Interview";'`  
Expected: FAIL with `relation "Interview" does not exist`.

- [ ] **Step 3: Write minimal implementation**

```bash
npm --workspace backend run db:migrate -- --name init_interview_mvp
```

За потреби додати manual SQL migration для partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS interview_candidate_active_unique_idx
ON "Interview" ("candidateUserId")
WHERE "candidateUserId" IS NOT NULL
  AND "status" IN ('AWAITING_CANDIDATE', 'READY', 'LIVE');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend run db:migrate && npm --workspace backend run db:seed`  
Expected: PASS; таблиці створені, seed відпрацьовує без помилок.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/migrations backend/prisma/schema.prisma
git commit -m "feat: apply initial prisma migration for interview mvp schema"
```

### Task 6: Додати healthcheck-перевірку підключення до БД

**Files:**
- Create: `backend/src/db/healthcheck.js`
- Create: `backend/src/db/healthcheck.test.js`
- Modify: `backend/package.json` (test script)
- Test: `backend/src/db/healthcheck.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { checkDatabaseHealth } = require("./healthcheck");

test("returns ok:true when SELECT 1 succeeds", async () => {
  const result = await checkDatabaseHealth();
  expect(result.ok).toBe(true);
});
```

Критерій fail: модуль `./healthcheck` відсутній.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run test -- backend/src/db/healthcheck.test.js`  
Expected: FAIL with `Cannot find module './healthcheck'`.

- [ ] **Step 3: Write minimal implementation**

```js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function checkDatabaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

module.exports = { checkDatabaseHealth };
```

```js
const { checkDatabaseHealth } = require("./healthcheck");

test("returns ok:true when SELECT 1 succeeds", async () => {
  const result = await checkDatabaseHealth();
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend run test -- backend/src/db/healthcheck.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/healthcheck.js backend/src/db/healthcheck.test.js backend/package.json
git commit -m "test: add database healthcheck smoke test"
```

### Task 7: Документувати запуск і Day 1 checklist

**Files:**
- Modify: `README.md`
- Test: manual command checklist from README

- [ ] **Step 1: Write the failing test**

```markdown
<!-- contract: README must include docker postgres + migrate + seed steps -->
```

Критерій fail: у README відсутня секція з конкретними командами `docker compose`, `db:migrate`, `db:seed`.

- [ ] **Step 2: Run test to verify it fails**

Run: `rg "db:migrate|db:seed|docker compose up -d postgres" README.md`  
Expected: FAIL or incomplete matches.

- [ ] **Step 3: Write minimal implementation**

```markdown
## Database Quick Start (Day 1)

1. `cp .env.example .env`
2. `cp backend/.env.example backend/.env`
3. `docker compose up -d postgres`
4. `npm install`
5. `npm --workspace backend run db:generate`
6. `npm --workspace backend run db:migrate -- --name init_interview_mvp`
7. `npm --workspace backend run db:seed`

Expected seed user:
- email: `hr@test.com`
- password: `123456`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rg "db:migrate|db:seed|docker compose up -d postgres" README.md`  
Expected: PASS with all required command matches.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add day1 database bootstrap and seed workflow"
```

### Task 8: Фінальна верифікація Day 1 сценарію

**Files:**
- Modify: none (verification only)
- Test: full command chain

- [ ] **Step 1: Write the failing test**

```bash
# contract: full chain must complete without errors
# npm run build
# npm --workspace backend run db:migrate
# npm --workspace backend run db:seed
```

Критерій fail: зазвичай перший прогін виявляє пропущений env/script/dependency.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npm --workspace backend run db:migrate && npm --workspace backend run db:seed`  
Expected: If any setup missing, FAIL with clear command error.

- [ ] **Step 3: Write minimal implementation**

```bash
# fix only concrete failures from Step 2:
# - missing env vars
# - missing dependency
# - schema/migration mismatch
```

Приклад цільового стабільного запуску:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
docker compose up -d postgres
npm install
npm --workspace backend run db:generate
npm --workspace backend run db:migrate -- --name init_interview_mvp
npm --workspace backend run db:seed
npm run build
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npm --workspace backend run db:migrate && npm --workspace backend run db:seed`  
Expected: PASS for all commands.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: verify day1 database bootstrap end-to-end"
```

## Self-Review

- **Spec coverage:** усі секції spec покрито:
  - таблиці/зв’язки: Task 2;
  - індекси/обмеження: Task 2 + Task 5;
  - docker postgres: Task 4;
  - seed HR: Task 3;
  - day1 verification: Task 8;
  - docs: Task 7.
- **Placeholder scan:** плейсхолдери не використовуються; кожен крок містить конкретні файли/команди/очікування.
- **Type consistency:** `InterviewStatus`, `Recommendation`, `author_type` імена узгоджені в усіх задачах.

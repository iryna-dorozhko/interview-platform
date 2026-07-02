# HR Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зафіксувати ідемпотентний seed тестового HR (`hr@test.com` / `123456`) з покриттям unit-тестами та підтвердженою ручною верифікацією.

**Architecture:** Логіка seed виноситься в `backend/src/seed/hr-user.js` (константи, хешування, `upsert`). Entry point `backend/prisma/seed.js` лише підключає Prisma і викликає `seedHrUser`. Unit-тести працюють з mock Prisma без живої БД.

**Tech Stack:** Node.js test runner (`node:test`), Prisma Client, SHA-256 (`node:crypto`).

**Spec:** `docs/superpowers/specs/2026-07-02-hr-seed-design.md`

---

## File Structure

- Create: `backend/src/seed/hr-user.js` — константи тестового HR, `hashPassword`, `seedHrUser(prisma, { UserRole })`.
- Modify: `backend/prisma/seed.js` — тонкий entry point, делегує в `seedHrUser`.
- Create: `backend/src/seed/hr-user.test.js` — unit-тести хешування та upsert-контракту.
- Verify: `README.md` — credentials і команда `db:seed` вже задокументовані; змін не потрібно, якщо константи не змінюються.

---

### Task 1: Винести seed-логіку HR у тестований модуль

**Files:**
- Create: `backend/src/seed/hr-user.test.js`
- Create: `backend/src/seed/hr-user.js`
- Test: `backend/src/seed/hr-user.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/seed/hr-user.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED_HR_USER, hashPassword, seedHrUser } = require("./hr-user");

test("SEED_HR_USER has expected test credentials", () => {
  assert.deepEqual(SEED_HR_USER, {
    email: "hr@test.com",
    password: "123456",
    role: "HR",
  });
});

test("hashPassword returns sha256 hex digest", () => {
  const hash = hashPassword("123456");
  assert.equal(
    hash,
    "8d969eef6ecad3c29a3a629280e686cf0c3fbd5e7049180740420fbc9a55f32e7"
  );
});

test("seedHrUser upserts HR user with hashed password", async () => {
  const calls = [];

  const fakePrisma = {
    user: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "user_1", ...args.create };
      },
    },
  };

  const UserRole = { HR: "HR", CANDIDATE: "CANDIDATE" };
  const result = await seedHrUser(fakePrisma, { UserRole });

  assert.equal(result.email, "hr@test.com");
  assert.equal(calls.length, 1);

  const upsertArgs = calls[0];
  assert.equal(upsertArgs.where.email, "hr@test.com");
  assert.equal(
    upsertArgs.create.passwordHash,
    "8d969eef6ecad3c29a3a629280e686cf0c3fbd5e7049180740420fbc9a55f32e7"
  );
  assert.equal(upsertArgs.create.role, UserRole.HR);
  assert.equal(upsertArgs.update.passwordHash, upsertArgs.create.passwordHash);
  assert.equal(upsertArgs.update.role, UserRole.HR);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/seed/hr-user.test.js`

Expected: FAIL with `Cannot find module './hr-user'`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/seed/hr-user.js
const crypto = require("node:crypto");

const SEED_HR_USER = {
  email: "hr@test.com",
  password: "123456",
  role: "HR",
};

function hashPassword(plainPassword) {
  return crypto.createHash("sha256").update(plainPassword).digest("hex");
}

async function seedHrUser(prisma, { UserRole }) {
  const { email, password, role } = SEED_HR_USER;
  const passwordHash = hashPassword(password);
  const userRole = UserRole[role];

  await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: userRole,
    },
    create: {
      email,
      passwordHash,
      role: userRole,
    },
  });

  return { email };
}

module.exports = {
  SEED_HR_USER,
  hashPassword,
  seedHrUser,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/seed/hr-user.test.js`

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/seed/hr-user.js backend/src/seed/hr-user.test.js
git commit -m "feat: extract testable HR seed helpers"
```

---

### Task 2: Спростити Prisma seed entry point

**Files:**
- Modify: `backend/prisma/seed.js`
- Test: `backend/src/seed/hr-user.test.js` (regression)

- [ ] **Step 1: Write the failing test**

Новий тест не потрібен — Task 1 вже покриває контракт. Fail-критерій для цього task: `backend/prisma/seed.js` досі містить inline-логіку `upsert` замість делегування.

Перевірка перед зміною:

Run: `rg "prisma\\.user\\.upsert" backend/prisma/seed.js`

Expected: знайдено inline `upsert` у `seed.js`.

- [ ] **Step 2: Run test to verify baseline**

Run: `npm --workspace backend test`

Expected: PASS (існуючі healthcheck + нові hr-user тести).

- [ ] **Step 3: Write minimal implementation**

```js
// backend/prisma/seed.js
require("dotenv/config");
const { PrismaClient, UserRole } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { seedHrUser } = require("../src/seed/hr-user");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";

const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl }));
const prisma = new PrismaClient({ adapter });

async function main() {
  const { email } = await seedHrUser(prisma, { UserRole });
  console.log(`Seeded HR user: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test`

Expected: PASS.

Run: `rg "prisma\\.user\\.upsert" backend/prisma/seed.js`

Expected: no matches (upsert тепер лише в `hr-user.js`).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.js
git commit -m "refactor: delegate prisma seed entrypoint to hr-user module"
```

---

### Task 3: Ручна верифікація seed проти живої БД

**Files:**
- Verify: `README.md` (секція database bootstrap, рядки з `db:seed` і `hr@test.com` / `123456`)
- Test: ручний smoke через Prisma seed

- [ ] **Step 1: Переконатися, що PostgreSQL доступний**

Run: `docker compose ps` (або локальний Postgres)

Expected: сервіс `postgres` у стані `running` / healthy.

- [ ] **Step 2: Застосувати міграції (якщо ще не застосовані)**

Run: `npm --workspace backend run db:migrate`

Expected: PASS, схема актуальна.

- [ ] **Step 3: Запустити seed перший раз**

Run: `npm --workspace backend run db:seed`

Expected output contains:

```text
Seeded HR user: hr@test.com
```

- [ ] **Step 4: Запустити seed повторно (ідемпотентність)**

Run: `npm --workspace backend run db:seed`

Expected: той самий success output, без duplicate key errors.

- [ ] **Step 5: Перевірити запис у БД**

Run:

```bash
npm --workspace backend exec -- node -e "
const { PrismaClient, UserRole } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) });
prisma.user.findUnique({ where: { email: 'hr@test.com' } })
  .then((user) => { console.log(JSON.stringify({ email: user?.email, role: user?.role })); })
  .finally(() => prisma.\$disconnect());
"
```

Expected:

```json
{"email":"hr@test.com","role":"HR"}
```

- [ ] **Step 6: Commit (лише якщо були зміни в README)**

```bash
# README не змінюється, якщо credentials лишаються hr@test.com / 123456
git status
```

Expected: working tree clean після Task 1–2 commits.

---

## Spec Coverage Check

| Spec requirement | Task |
|------------------|------|
| Один тестовий HR `hr@test.com` / `123456` / `HR` | Task 1 (`SEED_HR_USER`) |
| `upsert` по email, ідемпотентність | Task 1 (test), Task 3 (manual) |
| SHA-256 хеш пароля | Task 1 (`hashPassword` test) |
| Entry point `backend/prisma/seed.js` | Task 2 |
| Error handling + `$disconnect` | Task 2 (збережено в entry point) |
| Без змін схеми/API | Усі tasks |
| README з credentials | Task 3 verify (без змін) |
| Unit-тести | Task 1 |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-02-hr-seed-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

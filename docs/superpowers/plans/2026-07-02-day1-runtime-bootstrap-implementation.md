# Day 1 Runtime Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрити прогалини Definition of Done Дня 1 — реальні dev-сервери (Vite + Express), `GET /api/health` з перевіркою PostgreSQL і seed HR, справжня збірка обох workspace.

**Architecture:** Backend Express + TypeScript експонує `GET /api/health`, який агрегує існуючий `checkDatabaseHealth` і новий `checkHrSeedUser`. Frontend Vite + Vue 3 показує статуси через Vite proxy `/api` → `localhost:3000`. Існуючі JS-модулі (`healthcheck.js`, `hr-user.js`) залишаються; TS імпортує їх через `allowJs`.

**Tech Stack:** Vite 6, Vue 3, TypeScript, Express, cors, tsx, Prisma 7, node:test.

**Spec:** `docs/superpowers/specs/2026-07-02-day1-runtime-bootstrap-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/tsconfig.json` | TS compile config (`allowJs`, `outDir: dist`) |
| `backend/src/db/prisma.ts` | Shared PrismaClient factory (adapter-pg) |
| `backend/src/db/seed-check.ts` | `checkHrSeedUser(prisma)` |
| `backend/src/db/seed-check.test.ts` | Unit tests for seed check |
| `backend/src/routes/health.ts` | `getHealthStatus(prisma)` + Express router |
| `backend/src/routes/health.test.ts` | Unit tests for health payload |
| `backend/src/server.ts` | Express app entry, CORS, listen |
| `backend/package.json` | Real dev/build/start/lint/test scripts + deps |
| `backend/.env.example` | Add `PORT=3000` |
| `frontend/index.html` | Vite HTML entry |
| `frontend/vite.config.ts` | Port 5173, `/api` proxy |
| `frontend/tsconfig.json` | Vue app TS config |
| `frontend/tsconfig.node.json` | Vite config TS |
| `frontend/tsconfig.app.json` | App-specific TS (for `vue-tsc -b`) |
| `frontend/src/main.ts` | Vue bootstrap |
| `frontend/src/App.vue` | Day 1 status page |
| `frontend/src/api/health.ts` | `fetchHealth()` client |
| `frontend/src/vite-env.d.ts` | Vite client types |
| `frontend/package.json` | Vite/Vue scripts + deps |
| `README.md` | Runtime ports, browser verification scenario |

---

### Task 1: Backend TypeScript toolchain

**Files:**
- Create: `backend/tsconfig.json`
- Modify: `backend/package.json`
- Modify: `backend/.env.example`

- [ ] **Step 1: Write the failing test**

```bash
npm --workspace backend run lint
```

Expected initially: FAIL — script prints placeholder or `tsc` not found.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run lint`  
Expected: FAIL (`tsc: command not found` or placeholder echo).

- [ ] **Step 3: Write minimal implementation**

Create `backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowJs": true
  },
  "include": ["src/**/*.ts", "src/**/*.js"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.js", "dist"]
}
```

Replace `backend/package.json` scripts and add dependencies:

```json
{
  "name": "backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "lint": "tsc --noEmit",
    "test": "node --import tsx --test src/db/healthcheck.test.js src/seed/hr-user.test.js src/db/seed-check.test.ts src/routes/health.test.ts",
    "db:validate": "prisma validate",
    "db:generate": "prisma generate",
    "predb:migrate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "predb:seed": "prisma generate",
    "db:seed": "prisma db seed"
  },
  "prisma": {
    "seed": "node prisma/seed.js"
  },
  "dependencies": {
    "@prisma/adapter-pg": "^7.8.0",
    "@prisma/client": "^7.8.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "pg": "^8.22.0",
    "prisma": "^7.8.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

Update `backend/.env.example`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public"
PORT=3000
```

Create stub `backend/src/server.ts` (temporary, replaced in Task 5):

```typescript
import "dotenv/config";

const port = Number(process.env.PORT ?? 3000);
console.log(`backend stub listening on ${port}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm install
npm --workspace backend run lint
```

Expected: PASS (exit 0).

- [ ] **Step 5: Commit**

```bash
git add backend/tsconfig.json backend/package.json backend/.env.example backend/src/server.ts
git commit -m "chore: add backend typescript toolchain and dependencies"
```

---

### Task 2: Shared Prisma client module

**Files:**
- Create: `backend/src/db/prisma.ts`

- [ ] **Step 1: Write the failing test**

N/A — thin factory module; covered by integration in Task 4–5.

- [ ] **Step 2: Run test to verify it fails**

N/A

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/db/prisma.ts`:

```typescript
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend run lint`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/prisma.ts
git commit -m "feat: add shared prisma client module for backend runtime"
```

---

### Task 3: HR seed check module

**Files:**
- Create: `backend/src/db/seed-check.ts`
- Create: `backend/src/db/seed-check.test.ts`
- Test: `backend/src/db/seed-check.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/seed-check.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { checkHrSeedUser } from "./seed-check";

test("checkHrSeedUser returns ok:true when HR user exists", async () => {
  const fakePrisma = {
    user: {
      findUnique: async () => ({ email: "hr@test.com", role: "HR" }),
    },
  };

  const result = await checkHrSeedUser(fakePrisma);

  assert.deepEqual(result, { ok: true, email: "hr@test.com" });
});

test("checkHrSeedUser returns ok:false when user is missing", async () => {
  const fakePrisma = {
    user: {
      findUnique: async () => null,
    },
  };

  const result = await checkHrSeedUser(fakePrisma);

  assert.deepEqual(result, { ok: false, email: "hr@test.com" });
});

test("checkHrSeedUser returns ok:false when role is not HR", async () => {
  const fakePrisma = {
    user: {
      findUnique: async () => ({ email: "hr@test.com", role: "CANDIDATE" }),
    },
  };

  const result = await checkHrSeedUser(fakePrisma);

  assert.deepEqual(result, { ok: false, email: "hr@test.com" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run test`  
Expected: FAIL with `Cannot find module './seed-check'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/db/seed-check.ts`:

```typescript
import { SEED_HR_USER } from "../seed/hr-user";

type PrismaLike = {
  user: {
    findUnique: (args: {
      where: { email: string };
    }) => Promise<{ email: string; role: string } | null>;
  };
};

export type SeedCheckResult = {
  ok: boolean;
  email: string;
};

export async function checkHrSeedUser(
  client: PrismaLike
): Promise<SeedCheckResult> {
  const email = SEED_HR_USER.email;
  const user = await client.user.findUnique({ where: { email } });

  if (user?.role === "HR") {
    return { ok: true, email };
  }

  return { ok: false, email };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend run test`  
Expected: all seed-check tests PASS (healthcheck + hr-user tests may also run).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/seed-check.ts backend/src/db/seed-check.test.ts
git commit -m "feat: add HR seed user existence check"
```

---

### Task 4: Health route and payload builder

**Files:**
- Create: `backend/src/routes/health.ts`
- Create: `backend/src/routes/health.test.ts`
- Test: `backend/src/routes/health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/health.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { buildHealthPayload, getHealthStatus } from "./health";

test("buildHealthPayload returns ok:true when database and seed are healthy", () => {
  const payload = buildHealthPayload(
    { ok: true },
    { ok: true, email: "hr@test.com" }
  );

  assert.deepEqual(payload, {
    ok: true,
    database: { ok: true },
    seed: { ok: true, email: "hr@test.com" },
  });
});

test("buildHealthPayload returns ok:false when database fails", () => {
  const payload = buildHealthPayload(
    { ok: false, error: "db down" },
    { ok: true, email: "hr@test.com" }
  );

  assert.deepEqual(payload, {
    ok: false,
    database: { ok: false },
    seed: { ok: true, email: "hr@test.com" },
  });
});

test("buildHealthPayload returns ok:false when seed fails", () => {
  const payload = buildHealthPayload(
    { ok: true },
    { ok: false, email: "hr@test.com" }
  );

  assert.deepEqual(payload, {
    ok: false,
    database: { ok: true },
    seed: { ok: false, email: "hr@test.com" },
  });
});

test("getHealthStatus aggregates database and seed checks", async () => {
  const fakePrisma = {
    $queryRaw: async () => [{ "?column?": 1 }],
    user: {
      findUnique: async () => ({ email: "hr@test.com", role: "HR" }),
    },
  };

  const payload = await getHealthStatus(fakePrisma);

  assert.equal(payload.ok, true);
  assert.equal(payload.database.ok, true);
  assert.equal(payload.seed.ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run test`  
Expected: FAIL with `Cannot find module './health'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/routes/health.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import { checkDatabaseHealth } from "../db/healthcheck";
import { checkHrSeedUser, type SeedCheckResult } from "../db/seed-check";

type DatabaseHealthResult = {
  ok: boolean;
  error?: string;
};

export type HealthPayload = {
  ok: boolean;
  database: { ok: boolean };
  seed: { ok: boolean; email: string };
};

export function buildHealthPayload(
  database: DatabaseHealthResult,
  seed: SeedCheckResult
): HealthPayload {
  return {
    ok: database.ok && seed.ok,
    database: { ok: database.ok },
    seed: { ok: seed.ok, email: seed.email },
  };
}

type PrismaLike = Parameters<typeof checkHrSeedUser>[0] & {
  $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
};

export async function getHealthStatus(client: PrismaLike): Promise<HealthPayload> {
  const database = await checkDatabaseHealth(client);
  const seed = await checkHrSeedUser(client);
  return buildHealthPayload(database, seed);
}

export function createHealthRouter(getClient: () => PrismaLike): Router {
  const router = Router();

  router.get("/health", async (_req: Request, res: Response) => {
    const payload = await getHealthStatus(getClient());
    res.status(200).json(payload);
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend run test`  
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/health.ts backend/src/routes/health.test.ts
git commit -m "feat: add /api/health route and payload builder"
```

---

### Task 5: Express server entrypoint

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Write the failing test**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health
```

Expected initially: FAIL — connection refused (server not running or stub only).

- [ ] **Step 2: Run test to verify it fails**

Run (without dev server):  
`curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 http://localhost:3000/api/health`  
Expected: `000` or connection refused.

- [ ] **Step 3: Write minimal implementation**

Replace `backend/src/server.ts`:

```typescript
import "dotenv/config";
import cors from "cors";
import express from "express";
import { prisma } from "./db/prisma";
import { createHealthRouter } from "./routes/health";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use("/api", createHealthRouter(() => prisma));

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run (requires Postgres + seed):
```bash
docker compose up -d postgres
npm --workspace backend run db:seed
npm --workspace backend run dev
```

In another terminal:
```bash
curl -s http://localhost:3000/api/health
```

Expected JSON:
```json
{"ok":true,"database":{"ok":true},"seed":{"ok":true,"email":"hr@test.com"}}
```

Also run:
```bash
npm --workspace backend run build
node backend/dist/server.js
```

Expected: server starts from compiled output.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat: add express server with /api/health endpoint"
```

---

### Task 6: Frontend Vite + Vue 3 scaffold

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.app.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/main.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing test**

```bash
npm --workspace frontend run build
```

Expected initially: FAIL — placeholder echo or missing vite.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace frontend run build`  
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="uk">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Interview Platform</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
```

Create `frontend/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

Create `frontend/tsconfig.app.json`:

```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"]
}
```

Create `frontend/tsconfig.node.json`:

```json
{
  "extends": "@vue/tsconfig/tsconfig.node.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

Create `frontend/src/vite-env.d.ts`:

```typescript
/// <reference types="vite/client" />
```

Create `frontend/src/main.ts`:

```typescript
import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
```

Create stub `frontend/src/App.vue`:

```vue
<template>
  <main>
    <h1>Interview Platform</h1>
    <p>Loading...</p>
  </main>
</template>
```

Replace `frontend/package.json`:

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "lint": "vue-tsc --noEmit -p tsconfig.app.json",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.5.13"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/tsconfig": "^0.7.0",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "vue-tsc": "^2.2.0"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm install
npm --workspace frontend run lint
npm --workspace frontend run build
```

Expected: PASS; `frontend/dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: add vite vue3 frontend scaffold"
```

---

### Task 7: Frontend status page and health API client

**Files:**
- Create: `frontend/src/api/health.ts`
- Modify: `frontend/src/App.vue`

- [ ] **Step 1: Write the failing test**

Manual contract: after `npm run dev`, browser at `:5173` should show status rows (not just "Loading...").

- [ ] **Step 2: Run test to verify it fails**

Run `npm run dev`, open `http://localhost:5173` — shows only stub "Loading...".

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/api/health.ts`:

```typescript
export type HealthResponse = {
  ok: boolean;
  database: { ok: boolean };
  seed: { ok: boolean; email: string };
};

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");

  if (!response.ok) {
    throw new Error(`Health request failed: ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}
```

Replace `frontend/src/App.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchHealth, type HealthResponse } from "./api/health";

type LoadState = "loading" | "ready" | "error";

const loadState = ref<LoadState>("loading");
const health = ref<HealthResponse | null>(null);
const errorMessage = ref<string | null>(null);

function statusLabel(ok: boolean | undefined): string {
  if (ok === undefined) return "…";
  return ok ? "OK" : "FAIL";
}

function statusClass(ok: boolean | undefined): string {
  if (ok === undefined) return "pending";
  return ok ? "ok" : "fail";
}

onMounted(async () => {
  try {
    health.value = await fetchHealth();
    loadState.value = "ready";
  } catch (error) {
    loadState.value = "error";
    errorMessage.value = "Не вдалося підключитися до API";
    console.error(error);
  }
});
</script>

<template>
  <main class="page">
    <h1>Interview Platform</h1>
    <p class="subtitle">Day 1 — статус системи</p>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="fail">{{ errorMessage }}</p>

    <ul v-else class="status-list">
      <li>
        <span>Backend API</span>
        <strong :class="statusClass(health?.ok)">{{ statusLabel(health?.ok) }}</strong>
      </li>
      <li>
        <span>PostgreSQL</span>
        <strong :class="statusClass(health?.database.ok)">
          {{ statusLabel(health?.database.ok) }}
        </strong>
      </li>
      <li>
        <span>Seed HR ({{ health?.seed.email }})</span>
        <strong :class="statusClass(health?.seed.ok)">
          {{ statusLabel(health?.seed.ok) }}
        </strong>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 32rem;
  margin: 2rem auto;
  padding: 0 1rem;
}

.subtitle {
  color: #555;
}

.status-list {
  list-style: none;
  padding: 0;
}

.status-list li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}

.ok {
  color: #0a7a2f;
}

.fail {
  color: #b00020;
}

.pending {
  color: #666;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
docker compose up -d postgres
npm --workspace backend run db:seed
npm run dev
```

Open `http://localhost:5173` — all three statuses show **OK** (green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/health.ts frontend/src/App.vue
git commit -m "feat: add day1 status page with health api client"
```

---

### Task 8: README runtime verification docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```bash
rg "localhost:5173|localhost:3000/api/health" README.md
```

Expected initially: no matches.

- [ ] **Step 2: Run test to verify it fails**

Run: `rg "localhost:5173|localhost:3000/api/health" README.md`  
Expected: exit code 1 (no matches).

- [ ] **Step 3: Write minimal implementation**

Insert after the `### Запуск` block in `README.md` (after line with `npm run build`):

```markdown
### Runtime Verification (Day 1)

Після підготовки бази (`Database Quick Start` вище):

```bash
npm run dev
```

Сервіси:
- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:3000/api/health](http://localhost:3000/api/health)

Очікуваний результат у браузері (frontend):
- Backend API: **OK**
- PostgreSQL: **OK**
- Seed HR (`hr@test.com`): **OK**

Альтернативна перевірка:

```bash
curl http://localhost:3000/api/health
```

Очікувана відповідь:

```json
{"ok":true,"database":{"ok":true},"seed":{"ok":true,"email":"hr@test.com"}}
```
```

Also update Day 1 Definition of Done checkboxes from `- [ ]` to `- [x]` for all four items.

- [ ] **Step 4: Run test to verify it passes**

Run: `rg "localhost:5173|localhost:3000/api/health" README.md`  
Expected: matches found.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add day1 runtime verification steps and mark dod complete"
```

---

### Task 9: End-to-end Day 1 verification

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Write the failing test**

Full DoD command chain:

```bash
npm run build
npm --workspace backend run db:migrate
npm --workspace backend run db:seed
npm --workspace backend test
npm run ci:bootstrap
```

- [ ] **Step 2: Run test to verify it fails**

Run full chain. If any step fails, note the error.

- [ ] **Step 3: Write minimal implementation**

Fix only concrete failures discovered in Step 2 (missing deps, TS errors, proxy issues). No new features.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
docker compose up -d postgres
npm install
npm --workspace backend run db:migrate
npm --workspace backend run db:seed
npm run build
npm --workspace backend test
npm run ci:bootstrap
npm run dev
```

Verify:
- `curl http://localhost:3000/api/health` → `ok: true`
- Browser `http://localhost:5173` → all statuses OK
- `test -d backend/dist && test -d frontend/dist` → exit 0

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: verify day1 runtime bootstrap end-to-end"
```

Only commit if Step 3 produced fixes.

---

## Self-Review

1. **Spec coverage:**
   - Vite + Vue 3 + Express + TS → Tasks 1, 5, 6, 7
   - `GET /api/health` with database + seed → Tasks 3, 4, 5
   - Ports 5173/3000 → Tasks 5, 6 (vite.config, PORT)
   - Browser status page → Task 7
   - Real build → Tasks 1, 6, 9
   - README → Task 8
   - CORS → Task 5
   - Existing JS modules preserved → Task 4 imports healthcheck.js
   - `allowJs` → Task 1 tsconfig

2. **Placeholder scan:** No TBD/TODO; all code blocks complete.

3. **Type consistency:** `HealthPayload`, `SeedCheckResult`, `HealthResponse` aligned across backend route and frontend client. Email always `hr@test.com` from `SEED_HR_USER`.

4. **Gaps:** None identified.

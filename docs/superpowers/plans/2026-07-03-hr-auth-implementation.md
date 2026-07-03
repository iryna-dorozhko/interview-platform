# HR Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR може увійти через UI (`hr@test.com` / `123456`), отримати JWT на 24 години, і працювати на захищеній головній сторінці з чатом; без токена — редірект на `/login` (frontend) або `401` (backend).

**Architecture:** Backend — `POST /api/auth/login`, `GET /api/auth/me`, middleware `requireAuth` + `requireHr` на LLM. Frontend — `vue-router` guard, Pinia store `auth`, JWT у `localStorage` (`auth_token`). Пароль — SHA-256 (той самий алгоритм, що в seed).

**Tech Stack:** Express + TypeScript, `jsonwebtoken`, Prisma, Vue 3 + Pinia + vue-router.

**Spec:** `docs/superpowers/specs/2026-07-03-hr-auth-design.md`

---

## File Structure

| File | Відповідальність |
|------|------------------|
| `backend/src/auth/password.ts` | `hashPassword` — SHA-256 hex |
| `backend/src/auth/jwt.ts` | `signToken`, `verifyToken`, `getJwtConfig` |
| `backend/src/auth/middleware.ts` | `requireAuth`, `requireHr`, тип `AuthUser` |
| `backend/src/routes/auth.ts` | `POST /auth/login`, `GET /auth/me` |
| `backend/src/routes/auth.test.ts` | HTTP-тести auth routes |
| `backend/src/auth/middleware.test.ts` | Unit-тести middleware |
| `backend/src/auth/password.test.ts` | Unit-тест hashPassword |
| `backend/src/server.ts` | Підключення auth router + middleware на LLM |
| `backend/.env.example` | `JWT_SECRET`, `JWT_EXPIRES_IN` |
| `frontend/src/api/client.ts` | `fetchWithAuth` з Bearer token |
| `frontend/src/api/auth.ts` | `login()`, `fetchMe()` |
| `frontend/src/stores/auth.ts` | Pinia store |
| `frontend/src/router/index.ts` | Маршрути + guard |
| `frontend/src/views/LoginView.vue` | Форма логіну |
| `frontend/src/views/HomeView.vue` | Статус + чат + logout |
| `frontend/src/App.vue` | `<RouterView />` |
| `frontend/src/main.ts` | Pinia + router + `restoreSession` |
| `frontend/src/api/llm.ts` | Використовує `fetchWithAuth` |
| `README.md` | DoD Дня 3, curl-приклади |

---

### Task 1: hashPassword (backend)

**Files:**
- Create: `backend/src/auth/password.ts`
- Create: `backend/src/auth/password.test.ts`
- Modify: `backend/package.json` (додати тест у script `test`)

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/auth/password.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "./password";

test("hashPassword returns sha256 hex digest matching seed", () => {
  const hash = hashPassword("123456");
  assert.equal(
    hash,
    "8d969eef6ecad3c29a3a629280e686cf0c3fbd5e7049180740420fbc9a55f32e7"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/auth/password.test.ts`

Expected: FAIL with `Cannot find module './password'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/auth/password.ts
import crypto from "node:crypto";

export function hashPassword(plainPassword: string): string {
  return crypto.createHash("sha256").update(plainPassword).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/auth/password.test.ts`

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/password.ts backend/src/auth/password.test.ts
git commit -m "feat(backend): add hashPassword helper for auth"
```

---

### Task 2: JWT helpers (backend)

**Files:**
- Create: `backend/src/auth/jwt.ts`
- Create: `backend/src/auth/jwt.test.ts`
- Modify: `backend/package.json` — додати `jsonwebtoken`, `@types/jsonwebtoken`

- [ ] **Step 1: Install dependency**

```bash
npm install jsonwebtoken --workspace backend
npm install -D @types/jsonwebtoken --workspace backend
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/auth/jwt.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "./jwt";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
const ORIGINAL_EXPIRES = process.env.JWT_EXPIRES_IN;

test.before(() => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  process.env.JWT_EXPIRES_IN = "24h";
});

test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_EXPIRES === undefined) delete process.env.JWT_EXPIRES_IN;
  else process.env.JWT_EXPIRES_IN = ORIGINAL_EXPIRES;
});

test("signToken and verifyToken round-trip payload", () => {
  const token = signToken({
    sub: "user_1",
    email: "hr@test.com",
    role: "HR",
  });

  const payload = verifyToken(token);
  assert.equal(payload.sub, "user_1");
  assert.equal(payload.email, "hr@test.com");
  assert.equal(payload.role, "HR");
});

test("verifyToken throws on invalid token", () => {
  assert.throws(() => verifyToken("not-a-jwt"), /Unauthorized|invalid/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace backend test -- src/auth/jwt.test.ts`

Expected: FAIL — module not found або function not defined.

- [ ] **Step 4: Write minimal implementation**

```typescript
// backend/src/auth/jwt.ts
import jwt from "jsonwebtoken";

export type JwtPayload = {
  sub: string;
  email: string;
  role: "HR" | "CANDIDATE";
};

export function getJwtConfig(): { secret: string; expiresIn: string } {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 8) {
    throw new Error("JWT_SECRET must be set and at least 8 characters");
  }
  return {
    secret,
    expiresIn: process.env.JWT_EXPIRES_IN ?? "24h",
  };
}

export function signToken(payload: JwtPayload): string {
  const { secret, expiresIn } = getJwtConfig();
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyToken(token: string): JwtPayload {
  const { secret } = getJwtConfig();
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded !== "object" || decoded === null) {
      throw new Error("Invalid token");
    }
    const { sub, email, role } = decoded as JwtPayload;
    if (!sub || !email || !role) {
      throw new Error("Invalid token payload");
    }
    return { sub, email, role };
  } catch {
    throw new Error("Unauthorized");
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace backend test -- src/auth/jwt.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/auth/jwt.ts backend/src/auth/jwt.test.ts backend/package.json package-lock.json
git commit -m "feat(backend): add JWT sign and verify helpers"
```

---

### Task 3: Auth middleware (backend)

**Files:**
- Create: `backend/src/auth/middleware.ts`
- Create: `backend/src/auth/middleware.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/auth/middleware.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response } from "express";
import { requireAuth, requireHr } from "./middleware";
import { signToken } from "./jwt";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
test.before(() => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
});
test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

test("requireAuth returns 401 without Authorization header", async () => {
  const app = express();
  app.get("/protected", requireAuth, (_req, res) => res.status(200).json({ ok: true }));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/protected`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Unauthorized");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("requireAuth sets req.user with valid token", async () => {
  const token = signToken({ sub: "u1", email: "hr@test.com", role: "HR" });
  let capturedEmail: string | undefined;

  const app = express();
  app.get(
    "/protected",
    requireAuth,
    (req: Request, res: Response) => {
      capturedEmail = req.user?.email;
      res.status(200).json({ ok: true });
    }
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(capturedEmail, "hr@test.com");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("requireHr returns 403 for CANDIDATE role", async () => {
  const token = signToken({ sub: "u2", email: "cd@test.com", role: "CANDIDATE" });

  const app = express();
  app.get("/hr-only", requireAuth, requireHr, (_req, res) => res.status(200).json({ ok: true }));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/hr-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/auth/middleware.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/auth/middleware.ts
import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt";

export type AuthUser = {
  id: string;
  email: string;
  role: "HR" | "CANDIDATE";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireHr(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "HR") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/auth/middleware.test.ts`

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/middleware.ts backend/src/auth/middleware.test.ts
git commit -m "feat(backend): add requireAuth and requireHr middleware"
```

---

### Task 4: Auth routes (backend)

**Files:**
- Create: `backend/src/routes/auth.ts`
- Create: `backend/src/routes/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/auth.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAuthRouter } from "./auth";
import { hashPassword } from "../auth/password";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
test.before(() => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
});
test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

function makeFakePrisma(user: {
  id: string;
  email: string;
  passwordHash: string;
  role: "HR" | "CANDIDATE";
} | null) {
  return {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        if (!user || user.email !== where.email) return null;
        return user;
      },
    },
  };
}

test("POST /auth/login returns token for valid HR credentials", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.deepEqual(body.user, {
      id: "user_hr",
      email: "hr@test.com",
      role: "HR",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/login returns 401 for wrong password", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "wrong" }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Invalid credentials");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/login returns 403 for CANDIDATE role", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_cd",
        email: "candidate@test.com",
        passwordHash,
        role: "CANDIDATE",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "candidate@test.com", password: "123456" }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "HR access only");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("GET /auth/me returns user when authenticated", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
    });
    const { token } = await loginRes.json();

    const meRes = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(meRes.status, 200);
    const body = await meRes.json();
    assert.deepEqual(body.user, {
      id: "user_hr",
      email: "hr@test.com",
      role: "HR",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend test -- src/routes/auth.test.ts`

Expected: FAIL — `createAuthRouter` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/routes/auth.ts
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../auth/password";
import { signToken } from "../auth/jwt";
import { requireAuth } from "../auth/middleware";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

export function createAuthRouter(getPrisma: () => PrismaClient): Router {
  const router = Router();

  router.post("/auth/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LoginBody;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.passwordHash !== hashPassword(password)) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (user.role !== "HR") {
      res.status(403).json({ error: "HR access only" });
      return;
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  router.get("/auth/me", requireAuth, (req: Request, res: Response) => {
    res.status(200).json({ user: req.user });
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace backend test -- src/routes/auth.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts
git commit -m "feat(backend): add auth login and me routes"
```

---

### Task 5: Підключити auth у server + захистити LLM

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `backend/src/routes/llm.test.ts`
- Modify: `backend/.env.example`
- Modify: `backend/package.json` (додати нові тести в script `test`)

- [ ] **Step 1: Write failing test for LLM 401 without token**

Додати в кінець `backend/src/routes/llm.test.ts`:

```typescript
import { requireAuth, requireHr } from "../auth/middleware";

test("POST /llm/complete returns 401 without auth when middleware applied", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";

  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Відповідь";
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth, requireHr, createLlmRouter(() => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/llm/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "Unauthorized");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
```

- [ ] **Step 2: Run test — PASS (тест самодостатній, middleware вже є)**

Run: `npm --workspace backend test -- src/routes/llm.test.ts`

Expected: PASS (включно з новим тестом).

- [ ] **Step 3: Update server.ts**

```typescript
// backend/src/server.ts — додати імпорти та маршрути
import { getJwtConfig } from "./auth/jwt";
import { requireAuth, requireHr } from "./auth/middleware";
import { createAuthRouter } from "./routes/auth";

// перед app.listen:
getJwtConfig(); // fail fast якщо JWT_SECRET відсутній

app.use("/api", createAuthRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createLlmRouter(() => createLlmProvider()));
```

Порядок: health (публічний) → auth (login публічний, me захищений всередині) → llm (middleware на mount).

- [ ] **Step 4: Update backend/.env.example**

```
JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_IN=24h
```

- [ ] **Step 5: Додати JWT_SECRET у локальний backend/.env** (не комітити)

```
JWT_SECRET=dev-secret-min-8-chars
```

- [ ] **Step 6: Run all backend tests**

Run: `npm --workspace backend test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/server.ts backend/src/routes/llm.test.ts backend/.env.example backend/package.json
git commit -m "feat(backend): wire auth routes and protect LLM endpoint"
```

---

### Task 6: Frontend dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install vue-router pinia --workspace frontend
```

- [ ] **Step 2: Verify build still works**

Run: `npm --workspace frontend run lint`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json package-lock.json
git commit -m "chore(frontend): add vue-router and pinia"
```

---

### Task 7: API client + auth API (frontend)

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/auth.ts`

- [ ] **Step 1: Create client.ts**

```typescript
// frontend/src/api/client.ts
const TOKEN_KEY = "auth_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchWithAuth(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, headers });
}
```

- [ ] **Step 2: Create auth.ts**

```typescript
// frontend/src/api/auth.ts
import { ApiError, fetchWithAuth, setStoredToken } from "./client";

export type AuthUser = {
  id: string;
  email: string;
  role: "HR" | "CANDIDATE";
};

type LoginResponse = {
  token: string;
  user: AuthUser;
};

type MeResponse = {
  user: AuthUser;
};

type ErrorBody = { error?: string };

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    return body.error ?? "Помилка запиту";
  } catch {
    return "Помилка запиту";
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const data = (await response.json()) as LoginResponse;
  setStoredToken(data.token);
  return data.user;
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await fetchWithAuth("/api/auth/me");

  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const data = (await response.json()) as MeResponse;
  return data.user;
}

export function clearSession(): void {
  setStoredToken(null);
}
```

- [ ] **Step 3: Update llm.ts to use fetchWithAuth**

```typescript
// frontend/src/api/llm.ts — замінити fetch на fetchWithAuth
import { fetchWithAuth } from "./client";

// у sendChat:
const response = await fetchWithAuth("/api/llm/complete", {
  method: "POST",
  body: JSON.stringify({ messages }),
});
```

- [ ] **Step 4: Verify lint**

Run: `npm --workspace frontend run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/auth.ts frontend/src/api/llm.ts
git commit -m "feat(frontend): add auth API client and fetchWithAuth"
```

---

### Task 8: Pinia auth store

**Files:**
- Create: `frontend/src/stores/auth.ts`

- [ ] **Step 1: Create store**

```typescript
// frontend/src/stores/auth.ts
import { defineStore } from "pinia";
import { ref } from "vue";
import {
  clearSession,
  fetchMe,
  login as apiLogin,
  type AuthUser,
} from "../api/auth";
import { getStoredToken } from "../api/client";

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(getStoredToken());
  const user = ref<AuthUser | null>(null);
  const hydrated = ref(false);

  async function restoreSession(): Promise<void> {
    if (!token.value) {
      hydrated.value = true;
      return;
    }
    try {
      user.value = await fetchMe();
    } catch {
      token.value = null;
      user.value = null;
      clearSession();
    } finally {
      hydrated.value = true;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    const loggedInUser = await apiLogin(email, password);
    token.value = getStoredToken();
    user.value = loggedInUser;
  }

  function logout(): void {
    token.value = null;
    user.value = null;
    clearSession();
  }

  return { token, user, hydrated, restoreSession, login, logout };
});
```

- [ ] **Step 2: Verify lint**

Run: `npm --workspace frontend run lint`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/auth.ts
git commit -m "feat(frontend): add Pinia auth store"
```

---

### Task 9: Router + views

**Files:**
- Create: `frontend/src/router/index.ts`
- Create: `frontend/src/views/LoginView.vue`
- Create: `frontend/src/views/HomeView.vue`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Create router**

```typescript
// frontend/src/router/index.ts
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import HomeView from "../views/HomeView.vue";
import LoginView from "../views/LoginView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    { path: "/", name: "home", component: HomeView, meta: { requiresAuth: true } },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.hydrated) {
    await auth.restoreSession();
  }

  if (to.meta.requiresAuth && !auth.token) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  if (to.name === "login" && auth.token) {
    return { name: "home" };
  }
});
```

- [ ] **Step 2: Create LoginView.vue**

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../api/client";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref("hr@test.com");
const password = ref("");
const loading = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  errorMessage.value = null;
  loading.value = true;
  try {
    await auth.login(email.value.trim(), password.value);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.push(redirect);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        errorMessage.value = "Доступ лише для HR";
      } else if (error.status === 401) {
        errorMessage.value = "Невірний email або пароль";
      } else {
        errorMessage.value = error.message;
      }
    } else {
      errorMessage.value = "Не вдалося підключитися до сервера";
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="page">
    <h1>Вхід HR</h1>
    <form class="form" @submit.prevent="onSubmit">
      <label>
        Email
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label>
        Пароль
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <button type="submit" :disabled="loading">
        {{ loading ? "Вхід…" : "Увійти" }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 24rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
input {
  padding: 0.5rem;
  font-size: 1rem;
}
.error {
  color: #b00020;
}
button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 3: Create HomeView.vue** — перенести вміст з `App.vue` + шапка

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchHealth, type HealthResponse } from "../api/health";
import ChatPanel from "../components/ChatPanel.vue";
import { useAuthStore } from "../stores/auth";

type LoadState = "loading" | "ready" | "error";

const auth = useAuthStore();
const router = useRouter();
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

function logout(): void {
  auth.logout();
  router.push({ name: "login" });
}

onMounted(async () => {
  try {
    health.value = await fetchHealth();
    loadState.value = "ready";
  } catch {
    loadState.value = "error";
    errorMessage.value = "Не вдалося підключитися до API";
  }
});
</script>

<template>
  <main class="page">
    <header class="header">
      <div>
        <h1>Interview Platform</h1>
        <p class="subtitle">HR — статус системи та чат з AI</p>
      </div>
      <div class="user-bar">
        <span>{{ auth.user?.email }}</span>
        <button type="button" @click="logout">Вийти</button>
      </div>
    </header>

    <p v-if="loadState === 'loading'">Завантаження…</p>
    <p v-else-if="loadState === 'error'" class="fail">{{ errorMessage }}</p>

    <template v-else>
      <ul class="status-list">
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
      <ChatPanel />
    </template>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}
.user-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}
.subtitle { color: #555; }
.status-list { list-style: none; padding: 0; }
.status-list li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}
.ok { color: #0a7a2f; }
.fail { color: #b00020; }
.pending { color: #666; }
</style>
```

- [ ] **Step 4: Simplify App.vue**

```vue
<script setup lang="ts">
import { RouterView } from "vue-router";
</script>

<template>
  <RouterView />
</template>
```

- [ ] **Step 5: Update main.ts**

```typescript
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.mount("#app");
```

- [ ] **Step 6: Verify build**

Run: `npm --workspace frontend run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/router/index.ts frontend/src/views/LoginView.vue frontend/src/views/HomeView.vue frontend/src/App.vue frontend/src/main.ts
git commit -m "feat(frontend): add login flow with router guard and home view"
```

---

### Task 10: README + фінальна верифікація

**Files:**
- Modify: `README.md` — секція День 3

- [ ] **Step 1: Update README Day 3 section**

Додати після «Що робиш»:

```markdown
### Auth Quick Start (Day 3)

**1. Env** (`backend/.env`):

```
JWT_SECRET=dev-secret-min-8-chars
```

**2. Логін через UI:**

```bash
npm run dev
```

Відкрий [http://localhost:5173](http://localhost:5173) → редірект на `/login`.

Тестовий акаунт: `hr@test.com` / `123456`

**3. Логін через curl:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@test.com","password":"123456"}'
```

**4. Захищений запит:**

```bash
TOKEN="<token-from-login>"
curl -X POST http://localhost:3000/api/llm/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Привіт"}'
```

Без токена → `401`.
```

Позначити DoD чекліст Дня 3 як виконаний після ручної перевірки.

- [ ] **Step 2: Run full build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Run all backend tests**

Run: `npm --workspace backend test`

Expected: PASS.

- [ ] **Step 4: Manual DoD checklist**

1. `/` без логіну → `/login`
2. `hr@test.com` / `123456` → `/`, чат працює
3. Перезавантаження → сесія збережена
4. «Вийти» → `/login`
5. `curl POST /api/llm/complete` без токена → 401

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add Day 3 HR auth quick start and mark DoD"
```

---

## Spec Coverage

| Spec requirement | Task |
|------------------|------|
| POST /api/auth/login | Task 4 |
| GET /api/auth/me | Task 4 |
| requireAuth + requireHr | Task 3, 5 |
| LLM захищений | Task 5 |
| JWT 24h | Task 2 |
| SHA-256 пароль | Task 1, 4 |
| HR-only login | Task 4 |
| localStorage auth_token | Task 7, 8 |
| vue-router + Pinia | Task 6, 8, 9 |
| LoginView + HomeView | Task 9 |
| Router guard | Task 9 |
| README | Task 10 |
| DoD checklist | Task 10 |

## Execution Handoff

План збережено. Два варіанти виконання:

**1. Subagent-Driven (рекомендовано)** — окремий subagent на кожну задачу, рев'ю між задачами.

**2. Inline Execution** — виконання в цій сесії через executing-plans, батчами з чекпоінтами.

Який підхід обираєш?

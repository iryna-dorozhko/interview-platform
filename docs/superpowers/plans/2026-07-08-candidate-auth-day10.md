# Candidate Auth Day 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати окремі реєстрацію/логін кандидата, рольову ізоляцію маршрутів і порожній кабінет кандидата без регресії HR-флоу.

**Architecture:** Backend отримує окремі role-specific auth endpoint-и (`/api/auth/hr/login`, `/api/auth/candidate/register`, `/api/auth/candidate/login`) з єдиним JWT контрактом. Frontend розділяє HR і Candidate auth-сторінки, вводить role-aware router guards і окремий candidate home `/candidate`. Поточний store/session механізм зберігається, розширюється лише API-шар і навігація.

**Tech Stack:** Node.js test runner + Express + Prisma (backend), Vue 3 + Pinia + Vue Router (frontend), TypeScript.

---

## File Structure (before tasks)

### Backend

- Modify: `backend/src/routes/auth.ts`  
  Додати endpoint-и candidate register/login і новий HR login path.
- Modify: `backend/src/routes/auth.test.ts`  
  Розширити existing auth tests під нові endpoint-и та role isolation.

### Frontend

- Modify: `frontend/src/api/auth.ts`  
  Розділити auth API на `loginHr`, `registerCandidate`, `loginCandidate`.
- Modify: `frontend/src/stores/auth.ts`  
  Додати окремі дії store для HR/Candidate auth flow.
- Modify: `frontend/src/router/index.ts`  
  Додати candidate routes і role-aware redirects.
- Modify: `frontend/src/views/LoginView.vue`  
  Переключити на `auth.loginHr`, додати лінк на candidate login.
- Create: `frontend/src/views/CandidateLoginView.vue`  
  Сторінка candidate login.
- Create: `frontend/src/views/CandidateRegisterView.vue`  
  Сторінка candidate registration.
- Create: `frontend/src/views/CandidateHomeView.vue`  
  Порожній candidate cabinet із logout.

### Docs

- Modify: `README.md`  
  Оновити Day 10 quick-start, маршрути й auth endpoint-и.

### Verification

- Command: `npm --workspace backend test`
- Command: `npm --workspace frontend run build`
- Command: `npm run build`

---

### Task 1: Backend Auth Endpoints + Tests (TDD)

**Files:**
- Modify: `backend/src/routes/auth.test.ts`
- Modify: `backend/src/routes/auth.ts`
- Test: `backend/src/routes/auth.test.ts`

- [ ] **Step 1: Write failing tests for new endpoints and role isolation**

```ts
test("POST /auth/hr/login returns token for valid HR credentials", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/hr/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
  });
  assert.equal(res.status, 200);
});

test("POST /auth/candidate/register creates candidate user", async () => {
  // fake prisma needs user.create + user.findUnique support
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/candidate/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "newcandidate@test.com", password: "123456" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.role, "CANDIDATE");
});

test("POST /auth/candidate/login returns 403 for HR account", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/candidate/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "Candidate access only");
});
```

- [ ] **Step 2: Run backend tests and confirm failure**

Run: `npm --workspace backend test`  
Expected: FAIL in `src/routes/auth.test.ts` with 404/route-not-found or missing fake prisma methods.

- [ ] **Step 3: Implement backend auth routes in `auth.ts`**

```ts
router.post("/auth/hr/login", async (req, res) => {
  // same credential validation logic as current /auth/login
  // require role === "HR"
  // return token + user
});

router.post("/auth/candidate/register", async (req, res) => {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return res.status(400).json({ error: "Invalid payload" });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already exists" });

  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password), role: "CANDIDATE" },
  });
  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  return res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

router.post("/auth/candidate/login", async (req, res) => {
  // same credential validation logic
  // require role === "CANDIDATE", else 403 Candidate access only
});
```

- [ ] **Step 4: Keep backward compatibility during transition**

```ts
// temporary alias to avoid breaking any existing client/tests while frontend is migrated
router.post("/auth/login", async (req, res) => {
  // delegate to hr login handler
});
```

- [ ] **Step 5: Re-run backend tests**

Run: `npm --workspace backend test`  
Expected: PASS for `src/routes/auth.test.ts`, no regressions in other backend tests.

- [ ] **Step 6: Commit backend auth changes**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts
git commit -m "feat(auth): add candidate register/login and role-specific auth routes"
```

---

### Task 2: Frontend Auth API + Store Split (TDD-lite via build and type checks)

**Files:**
- Modify: `frontend/src/api/auth.ts`
- Modify: `frontend/src/stores/auth.ts`
- Test: `frontend/src/api/auth.ts` (type/build verification)

- [ ] **Step 1: Replace single login API with explicit role-based calls**

```ts
export async function loginHr(email: string, password: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/hr/login", { ... });
  // parseError + setStoredToken + return user
}

export async function registerCandidate(email: string, password: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/candidate/register", { ... });
  // parseError + setStoredToken + return user
}

export async function loginCandidate(email: string, password: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/candidate/login", { ... });
  // parseError + setStoredToken + return user
}
```

- [ ] **Step 2: Update auth store actions**

```ts
async function loginHr(email: string, password: string): Promise<void> {
  const loggedInUser = await apiLoginHr(email, password);
  token.value = getStoredToken();
  user.value = loggedInUser;
}

async function registerCandidate(email: string, password: string): Promise<void> {
  const loggedInUser = await apiRegisterCandidate(email, password);
  token.value = getStoredToken();
  user.value = loggedInUser;
}

async function loginCandidate(email: string, password: string): Promise<void> {
  const loggedInUser = await apiLoginCandidate(email, password);
  token.value = getStoredToken();
  user.value = loggedInUser;
}
```

- [ ] **Step 3: Run frontend build to catch API/store typing issues**

Run: `npm --workspace frontend run build`  
Expected: FAIL initially on outdated `auth.login(...)` usages in views/router.

- [ ] **Step 4: Commit API/store split**

```bash
git add frontend/src/api/auth.ts frontend/src/stores/auth.ts
git commit -m "refactor(frontend-auth): split hr and candidate auth actions"
```

---

### Task 3: Candidate Views + HR Login View Update

**Files:**
- Modify: `frontend/src/views/LoginView.vue`
- Create: `frontend/src/views/CandidateLoginView.vue`
- Create: `frontend/src/views/CandidateRegisterView.vue`
- Create: `frontend/src/views/CandidateHomeView.vue`
- Test: `frontend/src/views/*.vue` (manual + build)

- [ ] **Step 1: Update HR login view to call explicit HR action**

```ts
await auth.loginHr(email.value.trim(), password.value);
```

```vue
<p class="helper">
  Кандидат?
  <RouterLink to="/candidate/login">Увійти як кандидат</RouterLink>
</p>
```

- [ ] **Step 2: Create `CandidateLoginView.vue`**

```vue
<script setup lang="ts">
const email = ref("");
const password = ref("");
async function onSubmit() {
  await auth.loginCandidate(email.value.trim(), password.value);
  await router.push("/candidate");
}
</script>
```

- [ ] **Step 3: Create `CandidateRegisterView.vue`**

```vue
<script setup lang="ts">
const email = ref("");
const password = ref("");
async function onSubmit() {
  await auth.registerCandidate(email.value.trim(), password.value);
  await router.push("/candidate");
}
</script>
```

- [ ] **Step 4: Create empty candidate cabinet `CandidateHomeView.vue`**

```vue
<template>
  <main class="page">
    <h1>Кабінет кандидата</h1>
    <p>Поки що порожньо. Наступним кроком тут буде анкета кандидата.</p>
    <button @click="logout">Вийти</button>
  </main>
</template>
```

- [ ] **Step 5: Run frontend build**

Run: `npm --workspace frontend run build`  
Expected: FAIL if router is not yet updated with new routes.

- [ ] **Step 6: Commit candidate views**

```bash
git add frontend/src/views/LoginView.vue frontend/src/views/CandidateLoginView.vue frontend/src/views/CandidateRegisterView.vue frontend/src/views/CandidateHomeView.vue
git commit -m "feat(frontend): add candidate auth views and empty candidate cabinet"
```

---

### Task 4: Router Role Guards + Redirect Rules

**Files:**
- Modify: `frontend/src/router/index.ts`
- Test: `frontend/src/router/index.ts` (manual route checks + build)

- [ ] **Step 1: Add route meta role typing and candidate routes**

```ts
{ path: "/login", name: "login", component: LoginView, meta: { guestRole: "HR" } },
{ path: "/candidate/login", name: "candidate-login", component: CandidateLoginView, meta: { guestRole: "CANDIDATE" } },
{ path: "/candidate/register", name: "candidate-register", component: CandidateRegisterView, meta: { guestRole: "CANDIDATE" } },
{ path: "/candidate", name: "candidate-home", component: CandidateHomeView, meta: { requiresAuth: true, requiredRole: "CANDIDATE" } },
// HR layout keeps meta.requiredRole = "HR"
```

- [ ] **Step 2: Implement role-aware guard behavior**

```ts
function homeByRole(role: "HR" | "CANDIDATE"): RouteLocationRaw {
  return role === "HR" ? { name: "home" } : { name: "candidate-home" };
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.hydrated) await auth.restoreSession();

  const requiresAuth = to.meta.requiresAuth === true;
  const requiredRole = to.meta.requiredRole as "HR" | "CANDIDATE" | undefined;

  if (requiresAuth && !auth.token) {
    return requiredRole === "CANDIDATE"
      ? { name: "candidate-login", query: { redirect: to.fullPath } }
      : { name: "login", query: { redirect: to.fullPath } };
  }

  if (auth.user && requiredRole && auth.user.role !== requiredRole) {
    return homeByRole(auth.user.role);
  }

  if (auth.user && to.meta.guestRole) {
    return homeByRole(auth.user.role);
  }
});
```

- [ ] **Step 3: Run build and manual smoke checks**

Run: `npm --workspace frontend run build`  
Expected: PASS.

Manual checks:
- HR token + open `/candidate/login` -> redirected to `/`
- Candidate token + open `/vacancies` -> redirected to `/candidate`
- Logged out + open `/candidate` -> redirected to `/candidate/login`

- [ ] **Step 4: Commit router guard changes**

```bash
git add frontend/src/router/index.ts
git commit -m "feat(router): add role-aware hr/candidate auth guards"
```

---

### Task 5: README Update + Final Verification

**Files:**
- Modify: `README.md`
- Test: full build and targeted backend tests

- [ ] **Step 1: Update README Day 10 section**

```md
### Candidate Auth Quick Start (Day 10)

- UI routes:
  - `/candidate/register`
  - `/candidate/login`
  - `/candidate`
- API:
  - `POST /api/auth/candidate/register`
  - `POST /api/auth/candidate/login`
  - `POST /api/auth/hr/login`
```

- [ ] **Step 2: Add curl examples**

```bash
curl -X POST http://localhost:3000/api/auth/candidate/register \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}'

curl -X POST http://localhost:3000/api/auth/candidate/login \
  -H "Content-Type: application/json" \
  -d '{"email":"candidate@test.com","password":"123456"}'
```

- [ ] **Step 3: Run backend tests**

Run: `npm --workspace backend test`  
Expected: PASS.

- [ ] **Step 4: Run full monorepo build**

Run: `npm run build`  
Expected: PASS for both `backend` and `frontend`.

- [ ] **Step 5: Commit docs and any final wiring fixes**

```bash
git add README.md
git commit -m "docs: add candidate auth routes and day10 verification flow"
```

---

## Self-Review Checklist (completed while authoring)

- Spec coverage: покрито endpoint-и, маршрути, role redirects, порожній candidate cabinet, тести, README.
- Placeholder scan: у кроках немає невизначених маркерів або відкладених дій.
- Type consistency: всюди використано `HR | CANDIDATE`, action names `loginHr`, `loginCandidate`, `registerCandidate`.


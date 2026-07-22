# HR Vacancy Profile Edit After Confirm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow HR to edit a confirmed vacancy profile via «Змінити» → «Зберегти зміни» when no interviews are in `READY`/`LIVE`, bumping `confirmedAt` so match scores invalidate.

**Architecture:** Keep `POST /prep/:vacancyId/confirm` as the first publish step. Unlock `PATCH /prep/:vacancyId/profile` for confirmed profiles with a READY/LIVE gate; on such saves set `confirmedAt = now()` and leave `Vacancy.status = CONFIRMED`. Expose `canEditProfile` on GET prep. Frontend adds view/edit modes for confirmed profiles.

**Tech Stack:** Express + Prisma (backend), Vue 3 + `fetchWithAuth` (frontend), `node:test` for backend tests.

**Spec:** `docs/superpowers/specs/2026-07-22-hr-vacancy-profile-edit-after-confirm-design.md`

## Global Constraints

- Blocking interview statuses are exactly `READY` and `LIVE` (not `AWAITING_CANDIDATE`, not `ENDED`).
- After editing a confirmed profile, vacancy stays `CONFIRMED` (do not reset to `DRAFT`).
- On successful PATCH of an already-confirmed profile, always set `confirmedAt` to `new Date()` (version bump for match cache).
- Confirm dialog must not say that further editing will be impossible.
- Error string for the gate: exactly `Vacancy has active interviews`.
- UI copy for that error: exactly `Неможливо змінити анкету: є активна співбесіда (READY/LIVE).`
- No Prisma migration.
- Do not change candidate confirm flows or `vacancy-match` service API (lazy invalidation via bumped `confirmedAt` is enough).
- If the working tree already has unrelated company-prep confirm removal (`assertHrCompanyProfile`, etc.), leave that logic intact; only add vacancy edit-after-confirm behavior on top.

---

## File Structure

| File | Role |
|------|------|
| `backend/src/routes/prep.ts` | Helper `vacancyHasBlockingInterviews`; GET `canEditProfile`; PATCH unlock + bump |
| `backend/src/routes/prep.test.ts` | Fake `interview` + tests for GET/PATCH gate and bump |
| `frontend/src/api/prep.ts` | `PrepState.canEditProfile`; map 409 active-interviews error |
| `frontend/src/views/VacancyPrepView.vue` | Confirmed view / edit mode, «Змінити», confirm copy |

---

### Task 1: Backend — `canEditProfile` on GET prep

**Files:**
- Modify: `backend/src/routes/prep.ts`
- Modify: `backend/src/routes/prep.test.ts`
- Test: `backend/src/routes/prep.test.ts`

**Interfaces:**
- Consumes: Prisma `interview.findFirst({ where: { vacancyId, status: { in: ["READY", "LIVE"] } } })`
- Produces:
  - `export async function vacancyHasBlockingInterviews(prisma: PrismaClient, vacancyId: string): Promise<boolean>`
  - GET `/api/prep/:vacancyId` JSON includes `canEditProfile: boolean` (always present on 200)

- [ ] **Step 1: Extend fake Prisma with interviews**

In `backend/src/routes/prep.test.ts`, add:

```ts
type FakeInterview = { id: string; vacancyId: string; status: string };
```

Extend `makeFakePrisma` seed with `interviews?: FakeInterview[]`, store them in a local `interviews` array, and add:

```ts
interview: {
  findFirst: async ({
    where,
  }: {
    where: { vacancyId: string; status?: { in: string[] } };
  }) => {
    const allowed = where.status?.in;
    return (
      interviews.find(
        (item) =>
          item.vacancyId === where.vacancyId &&
          (allowed == null || allowed.includes(item.status))
      ) ?? null
    );
  },
},
```

Expose `__interviews: interviews` on the fake for debugging if useful.

- [ ] **Step 2: Write failing GET tests**

Add these tests (keep existing GET tests; update any assertion that checks the full body shape only if it would break on the new field — prefer asserting `canEditProfile` explicitly in new tests):

```ts
test("GET /prep/:vacancyId returns canEditProfile true when no READY/LIVE interviews", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    hrCompanyProfiles: [makeConfirmedHrProfile()],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "Dev",
        requirements: { critical: ["TS"], desired: [] },
        culture: [],
        expectations: [],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
    interviews: [
      { id: "i1", vacancyId: "vacancy_1", status: "AWAITING_CANDIDATE" },
      { id: "i2", vacancyId: "vacancy_1", status: "ENDED" },
    ],
  });
  // …start server with createPrepRouter({ getPrisma: () => fakePrisma as never, …}) like other tests
  const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.canEditProfile, true);
});

test("GET /prep/:vacancyId returns canEditProfile false when a READY interview exists", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    hrCompanyProfiles: [makeConfirmedHrProfile()],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "Dev",
        requirements: { critical: ["TS"], desired: [] },
        culture: [],
        expectations: [],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
    interviews: [{ id: "i1", vacancyId: "vacancy_1", status: "READY" }],
  });
  // …same server bootstrap
  const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.canEditProfile, false);
});
```

Mirror the existing test bootstrap pattern (`withUser`, `app.listen(0)`, `finally server.close`) from nearby GET tests in the same file.

Also assert `canEditProfile: true` on the empty-session GET path (no session yet) in a small dedicated test or by extending:

`GET /prep/:vacancyId returns empty state when no session exists yet` → add `assert.equal(body.canEditProfile, true)`.

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && node --import tsx --test src/routes/prep.test.ts
```

Expected: FAIL — `canEditProfile` is `undefined`.

- [ ] **Step 4: Implement helper + GET field**

In `backend/src/routes/prep.ts`, near the top (after imports / serializers):

```ts
const BLOCKING_INTERVIEW_STATUSES = ["READY", "LIVE"] as const;

export async function vacancyHasBlockingInterviews(
  prisma: PrismaClient,
  vacancyId: string
): Promise<boolean> {
  const found = await prisma.interview.findFirst({
    where: {
      vacancyId,
      status: { in: [...BLOCKING_INTERVIEW_STATUSES] },
    },
    select: { id: true },
  });
  return found != null;
}
```

In the GET `/prep/:vacancyId` handler, after ownership checks, compute:

```ts
const canEditProfile = !(await vacancyHasBlockingInterviews(prisma, vacancyId));
```

Include `canEditProfile` in **both** JSON responses (no-session early return and normal return).

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && node --import tsx --test src/routes/prep.test.ts
```

Expected: PASS (all prep tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "$(cat <<'EOF'
feat(prep): expose canEditProfile on vacancy prep GET

EOF
)"
```

---

### Task 2: Backend — PATCH confirmed profile with READY/LIVE gate

**Files:**
- Modify: `backend/src/routes/prep.ts` (PATCH handler)
- Modify: `backend/src/routes/prep.test.ts`
- Test: `backend/src/routes/prep.test.ts`

**Interfaces:**
- Consumes: `vacancyHasBlockingInterviews` from Task 1
- Produces: PATCH `/api/prep/:vacancyId/profile` allows confirmed edits when not blocked; bumps `confirmedAt`; returns 409 `{ error: "Vacancy has active interviews" }` when blocked

- [ ] **Step 1: Replace the old “409 after confirm” test and add new cases**

Delete or rewrite the existing test named approximately:

`PATCH /prep/:vacancyId/profile returns 409 after confirm`

Replace with:

```ts
test("PATCH /prep/:vacancyId/profile updates confirmed profile and bumps confirmedAt", async () => {
  const oldConfirmedAt = new Date("2026-07-07T09:00:00.000Z");
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1", status: "CONFIRMED" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    hrCompanyProfiles: [makeConfirmedHrProfile()],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "Dev",
        requirements: { critical: ["TS"], desired: [] },
        culture: ["old"],
        expectations: ["ship"],
        confirmedAt: oldConfirmedAt,
      },
    ],
    interviews: [{ id: "i1", vacancyId: "vacancy_1", status: "AWAITING_CANDIDATE" }],
  });
  // …bootstrap server
  const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "Senior Dev",
      requirements: { critical: ["TS"], desired: ["Vue"] },
      expectations: ["ship"],
      culture: ["new"],
      companyDirection: [],
      policies: [],
      workFormat: [],
      onboardingApproach: [],
      workConditions: [],
      compensation: { displayText: "не вказано" },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.profile.role, "Senior Dev");
  assert.equal(body.profile.culture[0], "new");
  assert.notEqual(body.profile.confirmedAt, null);
  assert.notEqual(new Date(body.profile.confirmedAt).getTime(), oldConfirmedAt.getTime());
  assert.equal(fakePrisma.__vacancies[0].status, "CONFIRMED");
});

test("PATCH /prep/:vacancyId/profile returns 409 when READY interview exists", async () => {
  const fakePrisma = makeFakePrisma({
    vacancies: [{ id: "vacancy_1", hrUserId: "hr_1", status: "CONFIRMED" }],
    sessions: [{ id: "session_1", vacancyId: "vacancy_1", isClosed: true }],
    hrCompanyProfiles: [makeConfirmedHrProfile()],
    profiles: [
      {
        id: "profile_1",
        vacancyId: "vacancy_1",
        role: "Dev",
        requirements: { critical: ["TS"], desired: [] },
        culture: [],
        expectations: [],
        confirmedAt: new Date("2026-07-07T09:00:00.000Z"),
      },
    ],
    interviews: [{ id: "i1", vacancyId: "vacancy_1", status: "READY" }],
  });
  // …bootstrap
  const response = await fetch(`http://127.0.0.1:${port}/api/prep/vacancy_1/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "X" }),
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, "Vacancy has active interviews");
});

test("PATCH /prep/:vacancyId/profile returns 409 when LIVE interview exists", async () => {
  // same as READY test but status: "LIVE"
});
```

Keep the existing unconfirmed PATCH success/validation tests unchanged.

- [ ] **Step 2: Run tests to verify new expectations fail**

```bash
cd backend && node --import tsx --test src/routes/prep.test.ts
```

Expected: FAIL on the new success test (still 409 Profile already confirmed) and/or missing interview mock behavior.

- [ ] **Step 3: Implement PATCH changes**

In `PATCH /prep/:vacancyId/profile` in `backend/src/routes/prep.ts`:

1. Remove the early block:

```ts
if (profile.confirmedAt) {
  res.status(409).json({ error: "Profile already confirmed" });
  return;
}
```

2. After loading `profile`, if `profile.confirmedAt` is set:

```ts
if (profile.confirmedAt) {
  if (await vacancyHasBlockingInterviews(prisma, vacancyId)) {
    res.status(409).json({ error: "Vacancy has active interviews" });
    return;
  }
}
```

3. After `parseProfilePatch` succeeds, update with bump when already confirmed:

```ts
const wasConfirmed = profile.confirmedAt != null;
updatedProfile = await prisma.companyProfile.update({
  where: { vacancyId },
  data: {
    ...parsed.data,
    ...(wasConfirmed ? { confirmedAt: new Date() } : {}),
  },
});
```

Do **not** change `vacancy.status`. Prefer a Prisma `$transaction` only if you already need multiple writes; a single `update` is enough for correctness here.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && node --import tsx --test src/routes/prep.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/prep.ts backend/src/routes/prep.test.ts
git commit -m "$(cat <<'EOF'
feat(prep): allow editing confirmed vacancy profile when idle

EOF
)"
```

---

### Task 3: Frontend API — `canEditProfile` + error mapping

**Files:**
- Modify: `frontend/src/api/prep.ts`

**Interfaces:**
- Consumes: GET/PATCH responses from Tasks 1–2
- Produces:
  - `PrepState` includes `canEditProfile: boolean`
  - `updatePrepProfile` throws Error with Ukrainian active-interview message on that 409

- [ ] **Step 1: Update types and `updatePrepProfile`**

In `frontend/src/api/prep.ts`:

```ts
export type PrepState = {
  messages: PrepMessage[];
  isClosed: boolean;
  profile: CompanyProfile | null;
  missingCompanyProfile: boolean;
  canEditProfile: boolean;
};
```

Replace `updatePrepProfile` error handling with:

```ts
export async function updatePrepProfile(
  vacancyId: string,
  payload: Partial<Omit<CompanyProfile, "confirmedAt">>
): Promise<{ profile: CompanyProfile }> {
  const response = await fetchWithAuth(`/api/prep/${vacancyId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // ignore
    }
    if (response.status === 409 && body.error === "Vacancy has active interviews") {
      throw new Error("Неможливо змінити анкету: є активна співбесіда (READY/LIVE).");
    }
    const detail = body.detail ?? body.error;
    throw new Error(detail ? `Не вдалося оновити профіль: ${detail}` : "Не вдалося оновити профіль");
  }
  return response.json() as Promise<{ profile: CompanyProfile }>;
}
```

- [ ] **Step 2: Typecheck frontend (optional smoke)**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: errors only in views that read `PrepState` without the new field until Task 4 (or pass if no other consumers break). Fix only `VacancyPrepView` in Task 4.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/prep.ts
git commit -m "$(cat <<'EOF'
feat(api): add canEditProfile to prep state client

EOF
)"
```

---

### Task 4: Frontend — VacancyPrepView edit-after-confirm UX

**Files:**
- Modify: `frontend/src/views/VacancyPrepView.vue`

**Interfaces:**
- Consumes: `PrepState.canEditProfile`, `updatePrepProfile`, `confirmPrepProfile`
- Produces: confirmed read-only view with «Змінити»; edit mode with «Зберегти зміни» / «Скасувати»; updated confirm dialog copy

- [ ] **Step 1: Add state and handlers**

In script setup of `VacancyPrepView.vue`:

```ts
const canEditProfile = ref(true);
const editingConfirmed = ref(false);
```

In `loadPrepState`, after assigning `profile`:

```ts
canEditProfile.value = state.canEditProfile;
editingConfirmed.value = false;
```

Change the `watch(profile, …)` so editable sync also runs when entering confirmed edit:

```ts
watch(profile, (next) => {
  if (next && (!next.confirmedAt || editingConfirmed.value)) {
    syncEditableProfile(next);
  } else if (!next) {
    editableProfile.value = null;
  }
});
```

Add:

```ts
function startEditingConfirmed(): void {
  if (!profile.value?.confirmedAt || !canEditProfile.value) return;
  errorMessage.value = null;
  editingConfirmed.value = true;
  syncEditableProfile(profile.value);
}

function cancelEditingConfirmed(): void {
  editingConfirmed.value = false;
  editableProfile.value = null;
  errorMessage.value = null;
}
```

Update `onSaveProfileEdits` success path:

```ts
profile.value = updated;
if (updated.confirmedAt) {
  editingConfirmed.value = false;
  editableProfile.value = null;
} else {
  syncEditableProfile(updated);
}
```

Update confirm dialog text in `onConfirmProfile`:

```ts
!window.confirm(
  "Профіль буде опубліковано для співбесід і матчінгу. Підтвердити?"
)
```

After successful confirm, keep `editingConfirmed.value = false`.

- [ ] **Step 2: Update template form / read-only switch**

Replace the form condition:

```vue
<form
  v-if="editableProfile && (!profile.confirmedAt || editingConfirmed)"
  class="profile-form"
  @submit.prevent="onSaveProfileEdits"
>
```

Keep the existing `<dl v-else>` for read-only.

- [ ] **Step 3: Update actions block**

Replace the post-confirm actions so that after confirm you show banner + «Змінити», and in edit mode show save/cancel:

```vue
<button
  v-if="!profile.confirmedAt"
  type="button"
  class="btn-secondary"
  :disabled="saving"
  @click="onSaveProfileEdits"
>
  {{ saving ? "Збереження…" : "Зберегти зміни" }}
</button>
<button
  v-if="!profile.confirmedAt"
  type="button"
  class="btn-primary"
  :disabled="confirming"
  @click="onConfirmProfile"
>
  Підтвердити профіль
</button>
<template v-else-if="editingConfirmed">
  <button
    type="button"
    class="btn-secondary"
    :disabled="saving"
    @click="cancelEditingConfirmed"
  >
    Скасувати
  </button>
  <button
    type="button"
    class="btn-primary"
    :disabled="saving"
    @click="onSaveProfileEdits"
  >
    {{ saving ? "Збереження…" : "Зберегти зміни" }}
  </button>
</template>
<template v-else>
  <p v-if="vacancyStatus === 'CONFIRMED'" class="confirmed-banner">
    ✓ Анкета підтверджена
  </p>
  <p v-else class="confirmed-banner">
    ✓ Підтверджено {{ profile.confirmedAt ? new Date(profile.confirmedAt).toLocaleString("uk-UA") : "" }}
  </p>
  <button
    type="button"
    class="btn-secondary"
    :disabled="!canEditProfile"
    :title="
      canEditProfile
        ? ''
        : 'Неможливо змінити анкету: є активна співбесіда (READY/LIVE).'
    "
    @click="startEditingConfirmed"
  >
    Змінити
  </button>
  <p v-if="!canEditProfile" class="hint">
    Неможливо змінити анкету: є активна співбесіда (READY/LIVE).
  </p>
</template>
```

Reuse an existing subtle text class if one exists (e.g. empty-state / muted); otherwise add:

```css
.hint {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted, #64748b);
}
```

Keep «Видалити чат» disabled when `profile.confirmedAt` (unchanged).

- [ ] **Step 4: Manual verification**

With backend + frontend running:

1. Open a draft vacancy prep → finish chat → save edits → confirm (dialog text is the new publish copy).
2. Confirmed view shows «Змінити»; click it, change a field, «Скасувати» restores read-only without save.
3. «Змінити» again → «Зберегти зміни» persists and returns to read-only; vacancy still usable for interviews.
4. If you can create a READY interview for that vacancy, reload prep: «Змінити» disabled + hint visible; PATCH would 409.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/VacancyPrepView.vue
git commit -m "$(cat <<'EOF'
feat(ui): allow HR to edit confirmed vacancy profile

EOF
)"
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|------------------|------|
| Confirm remains first publish | Task 4 (UI keeps button); confirm route unchanged |
| «Змінити» → edit → «Зберегти зміни» / «Скасувати» | Task 4 |
| Block only READY/LIVE | Tasks 1–2 |
| Stay CONFIRMED after save | Task 2 |
| Bump `confirmedAt` on confirmed PATCH | Task 2 |
| Match invalidation via bump | Task 2 (no vacancy-match code change) |
| GET `canEditProfile` | Task 1 |
| Confirm dialog copy without permanence | Task 4 |
| Ukrainian 409 UI message | Task 3 (+ Task 4 hint) |
| No Prisma migration / out-of-scope items | — respected |

**Placeholder scan:** none intentional.  
**Type consistency:** `canEditProfile: boolean` on GET/`PrepState`; error `Vacancy has active interviews` shared by PATCH + client.

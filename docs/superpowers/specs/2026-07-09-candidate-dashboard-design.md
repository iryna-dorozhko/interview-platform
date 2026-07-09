# Candidate Dashboard UI Design

**Дата:** 2026-07-09  
**Статус:** Затверджено в brainstorming  
**Контекст:** Кабінет кандидата з дизайном, аналогічним HR-кабінету  
**Передумови:** День 10 (candidate auth), День 11 (Candidate Agent backend), День 12 (prep chat UI), День 13 (profile confirmation), join-by-code API (`candidate-interview.ts`)

---

## Контекст і мета

MVP уже має:

- HR-кабінет: `HrLayout` + `HrSidebar` + `HrHomeView` з картками-оглядом, кнопками дій і модальними вікнами (Дні 7–9)
- Candidate auth і role-aware router guards (День 10)
- Candidate prep chat: `CandidatePrepView.vue` + `candidate-prep.ts` (Дні 11–12)
- Profile finish/confirm (День 13)
- Join-by-code: `GET/POST /api/candidate/interview` (поточна гілка)
- Поточний `CandidateHomeView` — окрема сторінка без layout/sidebar, inline join-форма

**Мета:** привести кабінет кандидата до HR-патерну — layout з sidebar, dashboard на головній, модалка join, окремі сторінки для анкети та співбесіди.

**Поза scope:**

- Shared refactor HR/candidate компонентів
- Inline-редагування полів профілю (JSON)
- Список кількох співбесід (MVP: одна активна на акаунт)
- Live interview room
- Зміни Prisma-схеми

---

## Затверджені рішення (brainstorming)

| Питання | Рішення |
|---------|---------|
| Редагування анкети | Після підтвердження — read-only; «редагування» = скинути (`DELETE`) і пройти чат заново |
| Join-by-code UI | Модальне вікно (як `CreateInterviewModal`) |
| Sidebar | Три пункти: Головна, Моя анкета, Співбесіда |
| Головна сторінка | Картки-огляд + кнопки дій, без «Останніх дій» |
| Архітектура | Дзеркало HR-структури (`CandidateLayout` + nested routes), без shared refactor |

---

## Підходи (розглянуті)

### 1. Дзеркало HR-структури (обрано)

`CandidateLayout` + `CandidateSidebar` + окремі view для кожного розділу sidebar. `JoinInterviewModal` за зразком `CreateInterviewModal`.

Плюси: узгоджено з HR, мінімальний ризик регресії, відповідає стилю Day 12–13.  
Мінуси: ~200 рядків дублювання layout/CSS.

### 2. Shared shell-компоненти (відхилено)

Винести `AppShell`, `SidebarNav`, `DashboardCard` у спільні компоненти.

Плюси: DRY. Мінуси: рефакторинг HR поза scope, вищий ризик регресії.

### 3. Sidebar поверх існуючих сторінок (відхилено)

Додати sidebar до поточного `CandidateHomeView` без nested routes.

Плюси: менший diff. Мінуси: неконсистентна навігація.

---

## Layout і маршрути

### CandidateLayout.vue

Копія патерну `HrLayout.vue`:

- Шапка: «Interview Platform» + «Кандидат — кабінет», email користувача, кнопка «Вийти»
- Тіло: `CandidateSidebar` + `<RouterView />`
- Стилі: ті самі кольори/відступи, що в HR (`#2563eb` primary, `#dbeafe` active nav, `#e5e7eb` borders)

### CandidateSidebar.vue

| Іконка | Маршрут | Підпис | Route name |
|--------|---------|--------|------------|
| 🏠 | `/candidate` | Головна | `candidate-home` |
| 📋 | `/candidate/profile` | Моя анкета | `candidate-profile` |
| 🎤 | `/candidate/interview` | Співбесіда | `candidate-interview` |

Active-state логіка — як у `HrSidebar.vue` (`isActive`, `isHomeActive`).

### Router (nested routes)

```ts
{
  path: "/candidate",
  component: CandidateLayout,
  meta: { requiresAuth: true, requiredRole: "CANDIDATE" },
  children: [
    { path: "", name: "candidate-home", component: CandidateHomeView },
    { path: "profile", name: "candidate-profile", component: CandidateProfileView },
    { path: "interview", name: "candidate-interview", component: CandidateInterviewView },
    { path: "prep/:interviewId", name: "candidate-prep", component: CandidatePrepView },
  ],
}
```

Існуючі окремі маршрути `/candidate`, `/candidate/prep/:interviewId` замінюються nested-структурою під `CandidateLayout`.

`CandidatePrepView`: кнопка «← До кабінету» → `{ name: "candidate-home" }`.

---

## CandidateHomeView — «Огляд»

### Завантаження даних

При `onMounted` паралельно:

1. `fetchCandidateInterview()` — `GET /api/candidate/interview`
2. Якщо є `interview.id` → `fetchCandidatePrepState(interview.id)` — `GET /api/candidate-prep/:interviewId`

### Картки-огляд (3 штуки)

| Картка | Джерело | Значення |
|--------|---------|----------|
| **Співбесіда** | `interview !== null` | `0` або `1` |
| **Статус анкети** | prep state | Див. таблицю нижче |
| **Статус зустрічі** | `interview.status` | Лейбл або «—» |

**Логіка «Статус анкети»:**

| Умова | Текст |
|-------|-------|
| Немає співбесіди | «—» |
| `messages.length === 0` | «Не створена» |
| `!isClosed` | «В процесі» |
| `isClosed && !profile?.confirmedAt` | «Очікує підтвердження» |
| `profile?.confirmedAt` | «Підтверджена» |

**Лейбли статусу зустрічі:**

| `status` | Українською |
|----------|-------------|
| `AWAITING_CANDIDATE` | Очікує кандидата |
| `READY` | Готова |
| `LIVE` | В ефірі |

### Кнопки дій

| Кнопка | Поведінка |
|--------|-----------|
| **Приєднатися до зустрічі** | Відкриває `JoinInterviewModal`. **Disabled**, якщо `interview !== null` |
| **Створити профіль** | `router.push({ name: "candidate-prep", params: { interviewId } })`. **Disabled**, якщо `interview === null` |

### Банер після join

Після успішного join через модалку — зелений банер (як HR `created-banner`):

> Ви приєдналися до співбесіди **{displayName}**

Банер зникає при перезавантаженні сторінки (не персиститься).

---

## JoinInterviewModal

Новий компонент `frontend/src/components/JoinInterviewModal.vue` за зразком `CreateInterviewModal.vue`.

**Props:** `open: boolean`  
**Emits:** `close`, `joined: [interview: CandidateInterview]`

**UI:**

- Заголовок: «Приєднатися до зустрічі»
- Поле: «Код співбесіди» (maxlength 6, uppercase, placeholder `TEST01`)
- Кнопки: «Скасувати» / «Приєднатися»

**API:** `joinInterviewByCode()` — існуючий `POST /api/candidate/interview/join`

**Помилки:**

| HTTP | Повідомлення |
|------|--------------|
| 404 | Невірний код співбесіди |
| 409 | Ця співбесіда вже зайнята іншим кандидатом |
| інше | Не вдалося приєднатися до співбесіди |

---

## CandidateProfileView — «Моя анкета»

Маршрут: `/candidate/profile`. За зразком `VacancyDetailView.vue`.

### Завантаження

1. `fetchCandidateInterview()`
2. Якщо є interview → `fetchCandidatePrepState(interview.id)`

### Стани сторінки

**1. Немає співбесіди**

- Текст: «Спочатку приєднайтеся до співбесіди»
- Кнопка «Приєднатися до зустрічі» → `JoinInterviewModal`

**2. Анкета не почата** (`messages.length === 0`)

- «Профіль ще не сформовано»
- Кнопка «Створити профіль» → `candidate-prep`

**3. Анкета в процесі** (`!isClosed`)

- «Анкета в процесі ({messages.length} повідомлень)»
- «Продовжити анкету» → `candidate-prep`
- «Видалити анкету» → `deleteCandidatePrepChat()` + `window.confirm("Видалити всю історію чату? Цю дію не можна скасувати.")`

**4. Профіль сформовано, не підтверджено** (`isClosed && !profile?.confirmedAt`)

- Read-only блок профілю (див. нижче)
- «Підтвердити профіль» → `candidate-prep` (де є UI confirm)
- «Видалити анкету» → DELETE + confirm

**5. Профіль підтверджено** (`profile.confirmedAt`)

- Read-only блок профілю + банер «✓ Підтверджено {дата}»
- «Почати заново» → `window.confirm("Підтверджений профіль буде видалено. Доведеться пройти анкету заново. Продовжити?")` → DELETE → `router.push({ name: "candidate-prep", ... })`

### Read-only профіль

Структура полів з `CandidateProfile`:

| Поле | UI |
|------|-----|
| `experience[]` | Список «Досвід» |
| `skills.strong[]` | Список «Сильні навички» |
| `skills.growth[]` | Список «Зони росту» |
| `goals[]` | Список «Цілі» |
| `summary` | Параграф «Резюме» |

Стилі — як `.profile-view` у `VacancyDetailView.vue`.

---

## CandidateInterviewView — «Співбесіда»

Маршрут: `/candidate/interview`. За зразком `InterviewDetailView.vue`.

**Немає співбесіди:**

- «Ви ще не приєдналися до зустрічі»
- Кнопка «Приєднатися до зустрічі» → `JoinInterviewModal`

**Є співбесіда:**

- Заголовок: `displayName`
- Мета: «Статус: **{statusLabel}**»
- Підказка: «Жива кімната співбесіди з'явиться пізніше.»

Join-код кандидату **не показується** — він уже приєднався через модалку.

---

## Backend-зміни

### 1. Дозволити DELETE після підтвердження профілю

**Файл:** `backend/src/routes/candidate-prep.ts`

Прибрати блок:

```ts
if (existingProfile?.confirmedAt) {
  res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
  return;
}
```

DELETE має видаляти `prepMessageCandidate`, `prepSessionCandidate`, `candidateProfile` незалежно від `confirmedAt`.

**Тест:** оновити/додати кейс у `candidate-prep.test.ts` — DELETE після confirm → `200`.

### 2. (Опційно) `createdAt` у GET interview

**Файл:** `backend/src/routes/candidate-interview.ts`

Додати `createdAt` до відповіді `GET /api/candidate/interview` для відображення дати на сторінці співбесіди. Якщо не потрібно для MVP — пропустити.

---

## Файли

### Frontend (нові)

| Файл | Призначення |
|------|-------------|
| `frontend/src/layouts/CandidateLayout.vue` | Shell з header + sidebar |
| `frontend/src/components/CandidateSidebar.vue` | Навігація (3 пункти) |
| `frontend/src/components/JoinInterviewModal.vue` | Модалка join-by-code |
| `frontend/src/views/CandidateProfileView.vue` | Перегляд/скинути анкету |
| `frontend/src/views/CandidateInterviewView.vue` | Деталі співбесіди |

### Frontend (оновити)

| Файл | Зміни |
|------|-------|
| `frontend/src/views/CandidateHomeView.vue` | Dashboard з картками і кнопками |
| `frontend/src/views/CandidatePrepView.vue` | Навігація «← До кабінету» під layout |
| `frontend/src/router/index.ts` | Nested routes під `CandidateLayout` |
| `frontend/src/api/candidate-interview.ts` | (опційно) тип з `createdAt` |

### Backend (оновити)

| Файл | Зміни |
|------|-------|
| `backend/src/routes/candidate-prep.ts` | DELETE після confirm |
| `backend/src/routes/candidate-prep.test.ts` | Новий тест-кейс |
| `backend/src/routes/candidate-interview.ts` | (опційно) `createdAt` |

---

## Error handling

| Ситуація | UI |
|----------|-----|
| Помилка завантаження dashboard | Червоний текст «Не вдалося завантажити дані» |
| Join 404/409 | Помилка в модалці |
| DELETE 500 | «Не вдалося видалити чат» |
| Prep state без interview | Redirect або empty state на profile/interview |

---

## Testing strategy

### Backend

1. `DELETE /api/candidate-prep/:id` після `confirmedAt` → `200`, profile/session/messages видалено
2. Існуючі join-тести (`candidate-interview.test.ts`) — без регресії

### Frontend (ручна перевірка)

1. Кандидат без співбесіди: картки `0 / — / —`; join активна, «Створити профіль» disabled
2. Join через модалку: банер, картки оновлені, join disabled
3. «Створити профіль» → prep-чат у layout з sidebar
4. Sidebar: три розділи, active-state коректний
5. «Моя анкета»: read-only після confirm; «Почати заново» скидає і веде в prep
6. «Співбесіда»: displayName + status; empty state без join
7. HR-кабінет без регресії (layout, sidebar, home)

---

## Data flow

```text
Login → /candidate (CandidateLayout)
  ├─ Home: fetch interview + prep → cards + actions
  ├─ Join modal → POST /candidate/interview/join → refresh state
  ├─ «Створити профіль» → /candidate/prep/:id
  ├─ Sidebar «Моя анкета» → /candidate/profile (view / delete / restart)
  └─ Sidebar «Співбесіда» → /candidate/interview (status)
```

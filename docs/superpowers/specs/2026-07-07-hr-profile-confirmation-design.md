# Підтвердження профілю HR — Day 7 Design Spec

**Дата:** 2026-07-07
**Статус:** Затверджено в brainstorming
**Контекст:** День 7 плану розробки (README) — «Підтвердження профілю HR»
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

Дні 5–6 вже дають HR чат з Company Agent і показ згенерованого профілю (`CompanyProfile`) після `POST /prep/:interviewId/finish`. Профіль на цьому етапі — read-only прев'ю, але юридично/процесно він ще не «зафіксований»: `CompanyProfile.confirmedAt` (поле вже є в схемі з Дня 2) лишається `null`.

Мета Дня 7: HR явно підтверджує, що згенерований профіль коректний («так, це правильно»). Після підтвердження профіль фіксується (`confirmedAt`), а подальші дії, що залежали б від готовності профілю, стають недоступні без цього кроку.

**Важливий нюанс:** `POST /interviews` (Day 8), join кандидата й кімната ще не реалізовані. Тому конкретний, перевірний гейтинг у межах Дня 7 обмежується тим, що вже існує в системі: скиданням prep-чату (`DELETE /prep/:interviewId`) і статусом `Interview`.

---

## Рішення з brainstorming

1. **Перехід статусу.** `POST /confirm` одразу переводить `Interview.status`: `DRAFT` → `AWAITING_CANDIDATE` (відповідає таблиці переходів з `2026-07-02-database-schema-design.md`), навіть попри те що Day 8 ще не збудований. Це готує ґрунт для майбутнього гейтингу (candidate join тощо) без додаткової міграції.
2. **Що саме гейтиться зараз.** Єдина конкретна дія, яку блокує непідтверджений/підтверджений стан профілю в межах Дня 7: `DELETE /prep/:interviewId` (скидання чату) забороняється, якщо профіль вже підтверджено.
3. **Підтвердження незворотне для MVP.** Немає ендпоінту/UI для «розпідтвердження» чи редагування профілю після `confirm`. Повторний виклик `/confirm` — помилка, не ідемпотентне оновлення.
4. **Строга валідація на `/confirm`:** 404, якщо профілю ще нема (не викликали `finish`); 409, якщо вже підтверджено.
5. **UI:** проста кнопка + `window.confirm()`-діалог (без окремого модального екрана), за аналогією з існуючими `onDeleteChat`/`onFinishChat`.

---

## API-контракт

```
POST /api/prep/:interviewId/confirm
Headers: Authorization: Bearer <HR JWT>
Body:    (порожнє)
```

### Обробка запиту

1. `requireAuth` + `requireHr` (вже підключено на рівні router у `server.ts`).
2. Знайти `Interview` за `:interviewId`:
   - не знайдено → `404 { error: "Interview not found" }`;
   - `interview.hrUserId !== req.user.id` → `403 { error: "Forbidden" }`.
3. Знайти `CompanyProfile` за `interviewId`:
   - не знайдено → `404 { error: "Profile not found" }` (профіль ще не згенеровано — `finish` не викликали);
   - `profile.confirmedAt !== null` → `409 { error: "Profile already confirmed" }`.
4. У транзакції (`prisma.$transaction`):
   - `companyProfile.update({ where: { interviewId }, data: { confirmedAt: new Date() } })`;
   - якщо `interview.status === "DRAFT"` → `interview.update({ where: { id: interviewId }, data: { status: "AWAITING_CANDIDATE" } })`; інакше статус не чіпати.
5. Відповідь `200`:

```json
{
  "profile": {
    "role": "...",
    "requirements": ["..."],
    "culture": ["..."],
    "expectations": ["..."],
    "confirmedAt": "2026-07-07T09:00:00.000Z"
  },
  "interviewStatus": "AWAITING_CANDIDATE"
}
```

### Помилки

| Ситуація | Код | Тіло |
|---|---|---|
| Немає токена / не HR | 401 / 403 | `{ error }` |
| `Interview` не знайдено | 404 | `{ error: "Interview not found" }` |
| `Interview` належить іншому HR | 403 | `{ error: "Forbidden" }` |
| `CompanyProfile` не знайдено | 404 | `{ error: "Profile not found" }` |
| Профіль вже підтверджено | 409 | `{ error: "Profile already confirmed" }` |

---

## Зміни в існуючих ендпоінтах

### `GET /prep/:interviewId`

Серіалізація профілю (рядки 60–67 `prep.ts`) доповнюється полем `confirmedAt`:

```ts
profile: profile
  ? {
      role: profile.role,
      requirements: profile.requirements,
      culture: profile.culture,
      expectations: profile.expectations,
      confirmedAt: profile.confirmedAt,
    }
  : null,
```

Те саме поле додається у відповідь `POST /prep/:interviewId/finish` (для консистентності типу `CompanyProfile` — там завжди `null` одразу після генерації).

### `DELETE /prep/:interviewId`

Перед видаленням сесії/профілю — додаткова перевірка:

```ts
const profile = await prisma.companyProfile.findUnique({ where: { interviewId } });
if (profile?.confirmedAt) {
  res.status(409).json({ error: "Profile is confirmed and cannot be reset" });
  return;
}
```

---

## Frontend (`CompanyPrepView.vue`, `api/prep.ts`)

### Типи й API-клієнт (`frontend/src/api/prep.ts`)

- `CompanyProfile` отримує `confirmedAt: string | null`.
- Нова функція:

```ts
export async function confirmPrepProfile(
  interviewId: string
): Promise<{ profile: CompanyProfile; interviewStatus: string }> {
  const response = await fetchWithAuth(`/api/prep/${interviewId}/confirm`, { method: "POST" });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося підтвердити профіль");
  }
  return response.json();
}
```

### UI (`profile-view` секція)

- Якщо `!profile.confirmedAt`: кнопка **«Підтвердити профіль»** (`btn-primary`) в блоці `.actions`, поруч із «Назад до чату» / «Видалити чат».
  - Клік → `window.confirm("Профіль буде зафіксовано. Подальше редагування стане неможливим. Підтвердити?")` → якщо `true`, викликати `confirmPrepProfile`, оновити `profile.value`.
  - Помилки виводяться через існуючий `errorMessage`/`error-banner`.
- Якщо `profile.confirmedAt`: замість кнопки підтвердження — текст **«✓ Підтверджено {дата, формат uk-UA через `toLocaleString`}»**.
  - Кнопка «Видалити чат» отримує `:disabled="!!profile.confirmedAt"` і `title="Підтверджений профіль не можна видалити"`.

---

## Тестування і верифікація

**Backend (`prep.test.ts`), нові кейси:**
- `POST /confirm` без профілю (finish не викликали) → 404.
- `POST /confirm` після `finish` → 200, `confirmedAt` не `null`, `Interview.status` змінився `DRAFT` → `AWAITING_CANDIDATE`.
- Повторний `POST /confirm` → 409, дані профілю не змінились.
- `DELETE /prep/:interviewId` після confirm → 409, профіль і сесія лишаються в БД без змін.
- `GET /prep/:interviewId` повертає `confirmedAt` у профілі (null до підтвердження, дата після).

**Ручний сценарій (Day 7 DoD):**
1. Пройти чат до `finish` (як у Дні 6).
2. Натиснути «Підтвердити профіль» → бачимо «✓ Підтверджено {дата}».
3. Спроба «Видалити чат» → заблокована (кнопка disabled / 409 при прямому виклику API).
4. Перевірка в БД: `CompanyProfile.confirmedAt` заповнено, `Interview.status = AWAITING_CANDIDATE`.

**Build:** `npm run build` у корені без помилок.

**README:** оновити секцію Дня 7 — приклад curl для `POST /prep/:interviewId/confirm`, опис поведінки після підтвердження (403/404/409-кейси, перехід статусу).

---

## Поза scope (Day 7)

- `POST /interviews` (Day 8) і будь-яка залежність його логіки від `AWAITING_CANDIDATE` — статус лише виставляється зараз, використовуватиметься пізніше.
- Join кандидата, кімната, звіт — не існують, гейтинг для них не реалізується.
- Candidate-профіль і його підтвердження (той самий патерн, окремий День — за PD-017).
- Редагування профілю до/після підтвердження (полів немає в UI взагалі, лишається read-only).
- Розпідтвердження («unlock») профілю.

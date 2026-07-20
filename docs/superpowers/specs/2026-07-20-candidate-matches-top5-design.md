# Candidate Matches Top-5 Design

**Дата:** 2026-07-20  
**Статус:** Затверджено в brainstorming  
**Scope:** Замінити sequential offer (1 вакансія) на список **топ-5** найкращих вакансій з % match; reject оновлює список з підвантаженням наступної з рейтингу

**Базовий spec:** `docs/superpowers/specs/2026-07-17-vacancy-match-application-design.md`

---

## Мета

Покращити UX підбору вакансій: замість показу однієї вакансії за раз кандидат бачить **до 5 найкращих** варіантів одночасно, кожен з **відсотком match**, і може порівняти перед вибором.

---

## Узгоджені продуктові рішення

| Тема | Було (v1) | Стало |
|------|-----------|-------|
| Формат пропозицій | Sequential: 1 вакансія за раз | **Топ-5** одночасно |
| Дані на картці | Назва + % match | Без змін |
| Відхилення | Наступна в рейтингу | Відхилена зникає; **миттєво** з'являється наступна (#6), список знову до 5 |
| Прийняття | 1 PENDING заявка | Без змін |
| Менше 5 вакансій | N/A | Показуємо скільки є (1–4) |
| Приватність компанії | Лише title + matchScore | Без змін |

---

## Користувацький флоу

```text
Кандидат відкриває /candidate/matches
        ↓
Match-сервіс повертає топ-5 невідхилених вакансій (desc за score)
        ↓
UI: список рядків — назва + N% + [Відхилити] [Прийняти] на кожному
        │
        ├─ Відхилити рядок → REJECTED → API повертає оновлений список
        │              (відхилена зникла, #6 з'явилась якщо є)
        │              якщо список порожній → «Немає підходящих вакансій»
        │
        └─ Прийняти → VacancyApplication(PENDING) → екран статусу
                         (підбір заблокований, як у v1)
```

---

## API

### Зміни контракту

**Було:**

```json
{ "vacancyId": "...", "title": "...", "matchScore": 91 }
// або empty:
{ "vacancyId": null, "title": null, "matchScore": null }
```

**Стало:**

```json
{
  "offers": [
    { "vacancyId": "...", "title": "Backend Engineer", "matchScore": 91 },
    { "vacancyId": "...", "title": "Platform Dev", "matchScore": 84 }
  ]
}
```

Порожній результат: `{ "offers": [] }`.

### Endpoints

| Метод | Шлях | Зміна |
|-------|------|-------|
| `GET` | `/api/candidate/matches/next` | Повертає `{ offers: [...] }` — до **5** елементів |
| `POST` | `/api/candidate/matches/:vacancyId/reject` | Повертає оновлений `{ offers: [...] }` |
| `POST` | `/api/candidate/matches/:vacancyId/accept` | **Без змін** — `{ application: {...} }` |
| `GET` | `/api/candidate/applications/active` | Без змін |

Права доступу, 403/409/503 — без змін від v1.

Контракт кандидату **жорстко обмежений**: лише `vacancyId`, `title`, `matchScore` у кожному елементі `offers`. Жодних company culture / philosophy / HR notes.

---

## Бекенд

### Сервіс (`vacancy-match.ts`)

Замінити `pickNextOffer` на:

```typescript
export function pickTopOffers(
  scores: CandidateMatchOffer[],
  rejectedVacancyIds: Set<string>,
  limit = 5,
): CandidateMatchOffer[]
```

Логіка:

1. Відфільтрувати `rejectedVacancyIds`
2. Відсортувати desc за `matchScore` (`sortScoresDesc` — вже є)
3. Повернути перші `limit` (5) елементів

Замінити `getNextMatchOffer` на `getTopMatchOffers` — повертає масив замість одного об'єкта.

LLM-ранжування (`ensureMatchScores`), кеш `VacancyMatchScore`, accept/reject persistence — **без змін**.

### Роутер (`candidate-matches.ts`)

- `GET /matches/next` → викликає `getTopMatchOffers`, відповідає `{ offers: [...] }`
- `POST /matches/:id/reject` → після запису decision повертає `{ offers: [...] }`
- Прибрати `emptyOfferPayload()` / `offerPayload()` single-object helpers; замінити на `offersPayload(offers: CandidateMatchOffer[])`

---

## UI

### `CandidateMatchesView.vue`

- Стан: `offers: CandidateMatchOffer[]` замість одного `offer`
- `viewState === 'offer'` коли `offers.length > 0`
- `viewState === 'empty'` коли `offers.length === 0`
- Список рядків: назва вакансії + badge `% match` + кнопки на кожному рядку
- При reject — loading на рядку або весь список → оновити з API response
- При accept — перехід на `pending` (як зараз)
- Стилі — розширити існуючі `.offer-card` під список

### `candidate-matches.ts` (API client)

```typescript
export type CandidateMatchOffersResponse = {
  offers: CandidateMatchOffer[];
};

export async function fetchNextMatch(): Promise<CandidateMatchOffersResponse>;
export async function rejectMatch(vacancyId: string): Promise<CandidateMatchOffersResponse>;
```

Тип `CandidateMatchOffer` — поля `vacancyId`, `title`, `matchScore` (non-null у відповіді API; nullability на клієнті можна прибрати або залишити для backward compat у типах).

---

## Помилки та інваріанти

| Умова | Відповідь |
|-------|-----------|
| Match без confirmed анкети | 403 |
| Accept / GET matches при PENDING заявці | 409 |
| Reject вже відхиленої vacancy | 409 |
| LLM недоступний | 503 |
| Менше 5 вакансій у пулі | Повертаємо скільки є |
| Усі відхилені | `{ offers: [] }` |
| Контракт без company/culture полів | контрактний тест |

---

## Тестування

1. **Unit** (`vacancy-match.test.ts`):
   - `pickTopOffers` повертає top-5 desc
   - Фільтрує rejected
   - Повертає менше 5 якщо немає стільки
   - Порожній масив якщо всі rejected

2. **Route** (`candidate-matches.test.ts`):
   - `GET /matches/next` повертає `{ offers: [...] }` до 5 елементів
   - `POST reject` повертає оновлений список (відхилена зникла, #6 з'явилась)
   - Контракт: ключі лише `vacancyId`, `title`, `matchScore`
   - Існуючі тести accept / 409 / 403 — оновити під новий формат де потрібно

3. UI e2e не обов'язковий у v1.

---

## Поза скоупом

- Зміна ліміту 5 на конфігurable параметр (hardcode 5 у v1)
- Перейменування `/matches/next` → `/matches` (можна в окремому PR)
- Показ rationale «чому підходить»
- Кілька паралельних PENDING заявок
- Зміна HR-флоу або matching-агента

---

## Зв'язок з поточним кодом

- Реалізація vacancy match — гілка/worktree `feat/vacancy-match-application`
- Файли для зміни:
  - `backend/src/services/vacancy-match.ts` + test
  - `backend/src/routes/candidate-matches.ts` + test
  - `frontend/src/api/candidate-matches.ts`
  - `frontend/src/views/CandidateMatchesView.vue`
- README секція «Vacancy match & applications» — оновити опис з sequential на top-5

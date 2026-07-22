# HR: редагування профілю вакансії після підтвердження — Design

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming  
**Scope:** Дозволити HR змінювати зібраний профіль вакансії після «Підтвердити», якщо немає співбесід у `READY`/`LIVE`; орієнтація UI на «Зберегти зміни» у режимі редагування; інвалідація match scores через bump `confirmedAt`

**Передумови:** HR vacancy/interview split (2026-07-08), HR profile confirmation (2026-07-07), Vacancy Match (2026-07-17)

---

## Мета

1. Зберегти **«Підтвердити профіль»** як першу публікацію анкети (`confirmedAt` + `VacancyStatus.CONFIRMED`).
2. Після підтвердження дозволити пізніше правити короткий опис: **«Змінити» → правки → «Зберегти зміни»**.
3. Блокувати редагування лише за наявності прив’язаних співбесід у статусах **`READY`** або **`LIVE`**.
4. Після збереження вакансія лишається `CONFIRMED`; зміни одразу в силі без повторного confirm.
5. Оновлювати версію профілю (`confirmedAt`) при такому save, щоб match scores не лишались застарілими.

---

## Узгоджені рішення (brainstorming)

| Питання | Рішення |
|---------|---------|
| Перша фіксація | Залишаємо «Підтвердити профіль» |
| Пізніше редагування | View → «Змінити» → form → «Зберегти зміни» / «Скасувати» |
| Статус після save | Лишається `CONFIRMED` (без повторного confirm) |
| Блок редагування | Лише інтерв’ю `READY` або `LIVE` |
| `AWAITING_CANDIDATE` / `ENDED` | Не блокують |
| Matches після edit | Bump `confirmedAt` → lazy invalidation існуючого match-сервісу |
| Підхід | Edit-режим поверх confirmed (підхід 1) |

**Відхилено:** повне прибирання confirm (підхід 2); окремий reopen/draft API (підхід 3).

---

## UX (`VacancyPrepView`)

### До підтвердження (після finish чату)

- Редагована форма профілю (як зараз).
- Кнопки: **«Зберегти зміни»** + **«Підтвердити профіль»**.
- Текст confirm-діалогу **не** каже, що редагування стане неможливим.
- Приклад: «Профіль буде опубліковано для співбесід і матчінгу. Підтвердити?»

### Після підтвердження (read-only)

- Показ збереженого профілю + банер «Підтверджено …».
- Кнопка **«Змінити»**, якщо `canEditProfile === true`.
- Якщо `canEditProfile === false` — кнопка «Змінити» disabled + коротке пояснення про активну співбесіду.

### Режим редагування confirmed-профілю

- Та сама форма полів.
- **«Зберегти зміни»** → `PATCH` → повернення в read-only.
- **«Скасувати»** → відкат локальних правок без `PATCH`, знову read-only.
- Після успішного save профіль лишається confirmed; UI показує оновлений `confirmedAt`.

---

## Backend / API

### `POST /prep/:vacancyId/confirm`

Логіка без змін: виставляє `companyProfile.confirmedAt`, переводить vacancy `DRAFT` → `CONFIRMED` за потреби. Повторний confirm → `409 Profile already confirmed`.

### `PATCH /prep/:vacancyId/profile`

1. Прибрати безумовний `409 Profile already confirmed`.
2. Якщо профіль уже має `confirmedAt`:
   - перевірити інтерв’ю цієї вакансії зі статусом `READY` або `LIVE`;
   - якщо є хоча б одне → `409` з помилкою на кшталт `Vacancy has active interviews`;
   - інакше дозволити update.
3. У транзакції оновити поля профілю; якщо профіль уже був confirmed — також **`confirmedAt = now()`**.
4. `Vacancy.status` лишається `CONFIRMED` (не скидати в `DRAFT`).
5. Інвалідація matches: bump `confirmedAt` достатній для lazy-recompute у `vacancy-match` (порівняння з `rankedForVacancyConfirmedAt`). Опційний `deleteMany` scores по `vacancyId` — не обов’язковий для коректності.

Непідтверджений профіль: PATCH як зараз (без гейту інтерв’ю, без обов’язкового bump `confirmedAt`, яке ще `null`).

### `GET /prep/:vacancyId`

Додати в відповідь **`canEditProfile: boolean`**:
- `false` лише якщо існує інтерв’ю вакансії в `READY` або `LIVE`;
- інакше `true` (включно з випадком без профілю / до confirm — UI і так керує edit через наявність форми).

Frontend використовує прапорець для кнопки «Змінити», а не лише реакцію на 409.

---

## Помилки (UI)

| Ситуація | Поведінка |
|----------|-----------|
| `409 Vacancy has active interviews` | «Неможливо змінити анкету: є активна співбесіда (READY/LIVE).» |
| Невалідний PATCH body | Як зараз (`400`) |
| Повторний confirm | Як зараз (`409 Profile already confirmed`) |

---

## Тестування

**Backend**
- PATCH confirmed без `READY`/`LIVE` → 200; `confirmedAt` змінюється; vacancy лишається `CONFIRMED`.
- PATCH confirmed з `READY` або `LIVE` → 409.
- PATCH confirmed з лише `AWAITING_CANDIDATE` та/або `ENDED` → 200.
- GET prep: `canEditProfile` коректний для обох випадків.

**Frontend** (за наявним стилем тестів/ручної перевірки)
- Після confirm видно «Змінити».
- Edit → save повертає в read-only з оновленими даними.
- При `canEditProfile: false` кнопка недоступна / пояснення видиме.

---

## Поза scope

- Глобальний профіль компанії (`company-prep`) — окремий трек.
- Фоновий примусовий перерахунок усіх matches (лише інвалідація через bump `confirmedAt`).
- Редагування під час `LIVE` з попередженням — жорсткий блок.
- Міграція Prisma — не потрібна.
- Зміна правил створення інтерв’ю / матчінгу (далі потрібні `CONFIRMED` + `confirmedAt`).

---

## Компоненти (коротко)

| Одиниця | Роль | Залежності |
|---------|------|------------|
| `prep.ts` PATCH/GET | Дозвіл edit confirmed + `canEditProfile` + bump `confirmedAt` | Prisma `Interview`, `CompanyProfile` |
| `VacancyPrepView.vue` | View / edit стани, кнопки, тексти | `api/prep` |
| `api/prep.ts` | Типи відповіді з `canEditProfile` | fetch |
| `vacancy-match` | Без змін API; підхоплює новий `confirmedAt` | існуючий lazy cache |

---

## Критерії готовності

- HR може підтвердити анкету, пізніше змінити поля через «Змінити» → «Зберегти зміни», якщо немає `READY`/`LIVE`.
- При блокуючих співбесідах edit недоступний і на UI, і на API.
- Після save статус вакансії `CONFIRMED`, матчінг не використовує застарілий snapshot через старий `confirmedAt`.

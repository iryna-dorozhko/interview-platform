# Приховування вакансії (hide from match) — Design Spec

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming  
**Контекст:** HR має зняти вакансію з кандидатського match без видалення історії співбесід і звітів.  
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

Зараз вакансія (`Vacancy`) має лише статуси `DRAFT` | `CONFIRMED`. Кандидатський match бере всі `CONFIRMED` з підтвердженим company profile. Hard delete блокується **будь-якими** прив’язаними співбесідами (включно з `ENDED`), тому закрити набір без втрати історії неможливо.

**Мета:** дозволити HR **сховати** вакансію з пошуку/match, якщо немає активних співбесід; історія (`ENDED`, звіти, заявки) зберігається; вакансію можна знову **показати**.

---

## Рішення з brainstorming

| # | Рішення |
|---|---|
| 1 | Visibility окремо від `VacancyStatus`: поле `hiddenAt DateTime?` (Підхід 1) |
| 2 | Active, що блокує hide: `AWAITING_CANDIDATE` \| `READY` \| `LIVE` |
| 3 | Hide дозволено без співбесід або коли всі не-active (зокрема лише `ENDED`) |
| 4 | Hide **не** видаляє співбесіди, звіти, заявки, match scores, company profile |
| 5 | Unhide зворотний: `hiddenAt = null` → знову в match (за існуючими правилами confirmed) |
| 6 | Прихована: не в match; нові співбесіди з неї заборонені; існуючі заявки/`ENDED`/звіти доступні |
| 7 | HR UI: вкладки **Активні** \| **Приховані**; кнопки біля вакансії за станом |
| 8 | Hard delete лишається окремо (без змін у правилах блокування) |

**Відхилені підходи:** новий `VacancyStatus.HIDDEN` (плутає confirm-семантику); soft-delete/`deletedAt` як єдиний механізм (надмірно і ризиковано змішати з hard delete).

---

## Модель даних

```prisma
model Vacancy {
  // ... existing fields ...
  hiddenAt  DateTime?   // null = видима в match; set = прихована
}
```

- Індекс (опційно, для HR list): `@@index([hrUserId, hiddenAt, createdAt(sort: Desc)])` — лише якщо потрібен для перформансу list; мінімально достатньо фільтра в `where`.
- Міграція: існуючі рядки → `hiddenAt = null`.

`VacancyStatus` (`DRAFT` / `CONFIRMED`) **не змінюється**.

---

## Бізнес-правила

### Hide

Дозволено, якщо немає жодної співбесіди зі статусом у:

```ts
const HIDE_BLOCKING_INTERVIEW_STATUSES = [
  "AWAITING_CANDIDATE",
  "READY",
  "LIVE",
] as const;
```

Legacy interview-статус `DRAFT` і `ENDED` **не** блокують hide.

Hide/unhide доступні для будь-якої вакансії власника (і `DRAFT`, і `CONFIRMED`). У match і так потрапляють лише `CONFIRMED` з `hiddenAt: null`; hide на `DRAFT` лише переносить її у вкладку «Приховані».

Після успіху: `hiddenAt = now()`. Ідемпотентно: повторний hide на вже прихованій → `200` з поточним станом.

### Unhide

`hiddenAt = null`. Ідемпотентно. Повернення в match лише якщо вакансія все ще відповідає існуючим критеріям match (`CONFIRMED`, підтверджений профіль, непорожні requirements тощо) — логіка match не дублюється в unhide.

### Ефекти `hiddenAt != null`

| Дія | Поведінка |
|-----|-----------|
| Candidate match (`listMatchableVacancies`) | Виключити (`hiddenAt: null` у where) |
| Створення нової співбесіди з вакансії | `409 VACANCY_HIDDEN` |
| Створення співбесіди з заявки на цю вакансію | `409 VACANCY_HIDDEN` |
| Існуючі PENDING-заявки | Не скасовувати; HR/кандидат бачать як раніше |
| `ENDED` співбесіди та final reports | Без змін, доступні |
| Hard `DELETE /vacancies/:id` | Без змін (блокується будь-яким linked interview) |

---

## API

Усі ендпоінти — HR, власник вакансії (`hrUserId`).

### `POST /api/vacancies/:id/hide`

- Успіх: `200` + vacancy з `hiddenAt`.
- `404` — не знайдено / не власник.
- `409 ACTIVE_INTERVIEWS_EXIST` — є блокувальні співбесіди; тіло з коротким повідомленням українською.

### `POST /api/vacancies/:id/unhide`

- Успіх: `200` + vacancy з `hiddenAt: null`.
- `404` — не знайдено / не власник.

### `GET /api/vacancies/mine?visibility=active|hidden`

- `active` (дефолт): `hiddenAt IS NULL`.
- `hidden`: `hiddenAt IS NOT NULL`.
- Відповідь включає `hiddenAt` (ISO string або `null`).

Опційно для UX: у list-item можна додати `canHide: boolean` (немає blocking interviews) — не обов’язково в v1, якщо UI показує помилку з `409`.

### Інші місця

- `listMatchableVacancies`: додати `hiddenAt: null`.
- Create interview paths (direct + from application): перевірка `hiddenAt == null` перед створенням.

---

## Frontend (HR)

**`VacancyListView`:**
- Вкладки/сегмент: **Активні** | **Приховані** → `visibility` у `GET /vacancies/mine`.
- Кнопки біля вакансії:
  - активна → **Приховати** (+ існуючі дії: відкрити, видалити тощо);
  - прихована → **Показати**.
- Помилка hide через active interviews — toast/alert: «Неможливо сховати: є активні співбесіди».
- `CreateInterviewModal` / будь-який picker confirmed vacancies: лише `hiddenAt == null` (активні).

**Кандидат:** окремого UI не потрібно — match не повертає hidden.

---

## Тестування

1. Hide без інтерв’ю → `hiddenAt` set; vacancy зникає з match-пулу.
2. Hide лише з `ENDED` → ok; звіти/інтерв’ю лишаються в БД і доступні.
3. Hide при `AWAITING_CANDIDATE` / `READY` / `LIVE` → `409 ACTIVE_INTERVIEWS_EXIST`.
4. Unhide → знову в match (для confirmed + valid profile).
5. Create interview на hidden → `409 VACANCY_HIDDEN`.
6. `GET /mine?visibility=active|hidden` — коректний розподіл.
7. Повторний hide/unhide — ідемпотентні `200`.

---

## Поза скоупом

- Пагінація / складні фільтри списку вакансій.
- Авто-hide за розкладом або після N завершених співбесід.
- Скасування PENDING-заявок при hide.
- Зміна правил hard delete.
- Окремий статус `HIDDEN` у `VacancyStatus`.

---

## Критерії готовності

- [ ] Міграція `hiddenAt` застосована.
- [ ] Hide / unhide ендпоінти з правилами active interviews.
- [ ] Match і create-interview поважають visibility.
- [ ] HR list з вкладками Активні / Приховані та кнопками Приховати / Показати.
- [ ] Тести з розділу «Тестування» проходять.

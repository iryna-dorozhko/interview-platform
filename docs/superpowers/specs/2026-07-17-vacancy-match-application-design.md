# Vacancy Match & Application Design

**Дата:** 2026-07-17  
**Статус:** Затверджено в brainstorming  
**Scope:** Після підтвердження анкети кандидата — sequential offer найкращих вакансій з % match; accept → in-app заявка для HR; HR вручну створює співбесіду з заявки

---

## Мета

Інвертувати частину поточного флоу (зараз HR спочатку створює Interview, кандидат приєднується) для сценарію:

1. Кандидат підтвердив анкету (`CandidateProfile.confirmedAt`).
2. Система пропонує найбільш підходящі `CONFIRMED` вакансії **по одній**, з **відсотком match**.
3. Кандидат може **погодитись** (заявка на співбесіду з цією компанією) або **відхилити** (наступна в рейтингу).
4. HR отримує **in-app** повідомлення з короткими даними кандидата.
5. HR **планує/створює** співбесіду вручну з цієї заявки (існуючий Create Interview, з prefill).

---

## Узгоджені продуктові рішення

| Тема | Рішення |
|------|---------|
| Формат пропозицій | Sequential: одна вакансія за раз; біля кожної — % match |
| Після reject | Наступна за рейтингом; відхилені більше не показуємо |
| Скоринг | LLM 0–100 по confirmed анкеті vs confirmed vacancy profiles |
| Що бачить кандидат | Лише **назва вакансії** + **% match** + Погодитись / Відхилити |
| Приватність компанії | Кандидат **не** бачить філософію, культуру, погляди компанії (навіть якщо LLM їх використовує всередині) |
| Нотифікація HR | In-app inbox «заявки»; без email у v1 |
| Після accept | HR створює Interview вручну з заявки (не auto-create Interview) |
| Тригер підбору | Одразу після `confirm` анкети **і** повторно з профілю кандидата |
| Ліміт заявок | Лише **одна** активна (`PENDING`) заявка на кандидата |

---

## Користувацький флоу

```text
Кандидат confirm анкети
        ↓
Match-сервіс ранжує CONFIRMED вакансії (LLM → score %)
        ↓
UI: одна картка — назва вакансії + N% + [Погодитись] [Відхилити]
        │
        ├─ Відхилити → журнал REJECTED → наступна в рейтингу
        │              якщо список порожній → «Немає підходящих вакансій»
        │
        └─ Погодитись → VacancyApplication(PENDING)
                         + HrNotification для власника вакансії
                         + підбір заблокований (одна активна заявка)
                                ↓
              HR бачить заявку: імʼя, email, вакансія, короткий LLM-висновок, % match
                                ↓
              HR створює Interview з заявки (Create Interview, prefilled)
                                ↓
              Application → CONVERTED (+ interviewId)
```

Повторний вхід з профілю:

- Якщо є `PENDING` заявка → екран статусу («очікує відповіді HR»), без нових карток.
- Інакше → той самий ранжований список мінус уже `REJECTED` вакансії.

---

## Дані та моделі

### `VacancyApplication`

| Поле | Тип | Примітка |
|------|-----|----------|
| `id` | cuid | |
| `candidateUserId` | FK User | роль CANDIDATE |
| `vacancyId` | FK Vacancy | |
| `matchScore` | Int 0–100 | snapshot на момент accept |
| `candidateSummary` | String | 2–4 речення українською для HR |
| `status` | enum | `PENDING` \| `CONVERTED` \| `WITHDRAWN` \| `DECLINED_BY_HR` |
| `interviewId` | FK Interview? | коли HR створив співбесіду |
| `createdAt` / `updatedAt` | DateTime | |

**Інваріант:** не більше однієї заявки зі статусом `PENDING` на `candidateUserId` (перевірка в сервісі; бажано partial unique index у Postgres, якщо доступно).

### `VacancyOfferDecision`

Легкий журнал для sequential offers:

| Поле | Тип |
|------|-----|
| `candidateUserId` | FK User |
| `vacancyId` | FK Vacancy |
| `decision` | `REJECTED` (v1 лише reject; accept живе в Application) |
| `createdAt` | DateTime |

Унікальність пари `(candidateUserId, vacancyId)` — одне рішення на вакансію.

### `HrNotification`

| Поле | Тип | Примітка |
|------|-----|----------|
| `id` | cuid | |
| `hrUserId` | FK User | власник вакансії |
| `type` | enum | `VACANCY_APPLICATION` |
| `payload` | Json | `applicationId`, `candidateName`, `email`, `vacancyTitle`, `matchScore` |
| `readAt` | DateTime? | |
| `createdAt` | DateTime | |

### Match-результат (внутрішній)

При ранжуванні зберігати/кешувати на бекенді для пари (кандидат + vacancy): `matchScore`, опційно внутрішній rationale. **Не** віддавати rationale/company fields кандидату.

Пул: вакансії зі статусом `CONFIRMED` і підтвердженим vacancy/company profile (як у поточних readiness-правилах проєкту).

---

## API

### Candidate (`requireCandidate`)

| Метод | Шлях | Поведінка |
|-------|------|-----------|
| `GET` | `/api/candidate/matches/next` | Наступна пропозиція `{ vacancyId, title, matchScore }` або `{ vacancyId: null }` (empty). Потрібна confirmed анкета. Якщо є PENDING application — **409** (`ACTIVE_APPLICATION_EXISTS`); клієнт спочатку викликає `GET .../applications/active`. |
| `POST` | `/api/candidate/matches/:vacancyId/reject` | Записати `VacancyOfferDecision(REJECTED)`; повернути наступну пропозицію або empty. |
| `POST` | `/api/candidate/matches/:vacancyId/accept` | Створити `VacancyApplication` + `HrNotification`. 409 якщо вже є PENDING. 403 без confirmed анкети. |
| `GET` | `/api/candidate/applications/active` | Активна PENDING заявка або `null`. |

Контракт відповіді кандидату на match **жорстко обмежений**: лише `vacancyId`, `title`, `matchScore`. Жодних company culture / philosophy / HR notes.

### HR (`requireHr`)

| Метод | Шлях | Поведінка |
|-------|------|-----------|
| `GET` | `/api/hr/notifications` | Список нотифікацій (unread first). |
| `POST` | `/api/hr/notifications/:id/read` | Позначити прочитаним (лише свої). |
| `GET` | `/api/hr/applications` | Заявки на вакансії цього HR. |
| `GET` | `/api/hr/applications/:id` | Деталі: імʼя, email, vacancy, matchScore, candidateSummary. |
| `POST` | `/api/hr/applications/:id/create-interview` | Створити Interview (reuse логіки `POST /api/interviews`) з prefill vacancy + candidate email/user; Application → `CONVERTED`, `interviewId` set. Лише `PENDING` + ownership. |

Опційний body для `create-interview`: `scheduledAt`, `displayName` — як у поточному Create Interview.

---

## UI

### Candidate

- Після успішного `confirm` анкети → redirect на `/candidate/matches`.
- З `CandidateProfile` / home — лінк «Підібрати вакансію» → той самий екран.
- Екран matches:
  - loading під час ранжування;
  - картка: title + matchScore% + дві кнопки;
  - empty: немає вакансій / усі відхилені;
  - якщо PENDING: статус очікування замість карток.
- Помилка LLM: зрозуміле повідомлення без внутрішніх деталей.

### HR

- Індикатор непрочитаних нотифікацій у кабінеті.
- Список/панель «Заявки».
- Деталі заявки + кнопка «Створити співбесіду» → існуючий Create Interview modal/флоу з підставленими vacancy + candidate.

---

## Matching-агент

Новий агент за зразком існуючих у `backend/src/agents/`:

- **Вхід:** confirmed `CandidateProfile` + список confirmed vacancy profiles (company culture дозволена **лише в промпті**).
- **Вихід:** масив `{ vacancyId, matchScore }` (0–100), відсортований desc на бекенді.
- **`candidateSummary`:** 2–4 речення українською для HR — генерувати при accept (або один раз під час ранжування і зберегти в кеші до accept). У v1 достатньо генерувати/брати snapshot **на accept** і писати в `VacancyApplication.candidateSummary`.
- 0 вакансій у пулі → не викликати LLM, одразу empty.
- Збій LLM → 503 / «Підбір тимчасово недоступний».

Повторний `GET .../next` після зміни анкети: у v1 реранжувати (або інвалідувати кеш за `confirmedAt` / updated profile). Точна стратегія кешу — деталі implementation plan; продуктово результат має відповідати актуальній confirmed анкеті.

---

## Помилки та інваріанти

| Умова | Відповідь |
|-------|-----------|
| Match/accept без confirmed анкети | 403 |
| Accept при існуючій PENDING | 409 |
| Reject/accept неіснуючої або вже відхиленої vacancy у цьому флоу | 404 / 409 |
| HR доступ лише до заявок/нотифікацій своїх вакансій | 403/404 |
| `create-interview` не для PENDING або чужої заявки | 409/403 |
| Відповідь кандидату без company/culture полів | контрактний тест |

---

## Тестування (мінімум)

1. Unit: сортування за score; фільтр REJECTED; інваріант однієї PENDING.
2. Route tests: next / reject / accept / notifications / applications / create-interview (auth + ownership).
3. Контракт: candidate match response не містить company/culture ключів.
4. Agent mock: LLM повертає scores → правильний порядок пропозицій.

UI e2e не обовʼязковий у v1.

---

## Поза скоупом v1

- Email / SMTP нотифікації.
- Авто-створення Interview при accept.
- Публічний каталог вакансій для кандидата.
- HR `DECLINED_BY_HR` з авто-розблокуванням підбору (статус у моделі є про запас; повний UX — пізніше).
- Показ кандидату опису ролі, rationale «чому підходить», даних компанії.
- Кілька паралельних PENDING заявок.

---

## Звʼязок з поточним кодом

- Анкета: `candidate-prep` confirm + `CandidateProfile` (вже є).
- Вакансії: `Vacancy` CONFIRMED + company/vacancy profiles (вже є).
- Створення співбесіди: reuse `POST /api/interviews` / CreateInterviewModal з prefill з Application.
- `Invitation` / join-by-code лишаються для HR-ініційованого флоу; новий Application-флоу їх не замінює.
- `FinalReport.matchScore` — post-interview; не плутати з pre-match `VacancyApplication.matchScore`.

---

## Підхід реалізації (обраний)

Нова сутність `VacancyApplication` + match-сервіс + `HrNotification`, без змішування заявки з чернеткою Interview. Це зберігає поточний HR→Interview ланцюг і додає candidate-initiated гілку поверх нього.

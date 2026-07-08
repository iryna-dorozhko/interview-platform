# Дашборд HR — Day 9 Design Spec

**Дата:** 2026-07-08
**Статус:** Затверджено в brainstorming
**Контекст:** День 9 плану розробки (README) — «HR бачить свої співбесіди в одному місці»
**Мова:** Українська (UI, повідомлення про помилки)

---

## Контекст і мета

Дні 3–8 вже дають повний HR-флоу: логін → анкета → профіль → підтвердження → створення співбесіди з кодом. Але кожна дія відбувається наче в ізоляції — HR не має жодного місця, де видно **всі** свої співбесіди одразу. `GET /api/interviews/mine` уже існує і повертає масив (відсортований найновіші-перші), але зараз ним користується лише `goToCompanyPrep()` в `HomeView.vue`, щоб мовчки перейти в анкету найновішої співбесіди — сам список ніде не рендериться.

Мета Дня 9: перетворити головну сторінку HR на дашборд — таблицю всіх його співбесід (код, статус, дата створення) з дією в кожному рядку, що залежить від статусу. Це фінальний крок Частини 1 (HR-кабінет) плану.

`GET /interviews/mine` розширюється полем `createdAt` (значення вже є в моделі `Interview`, просто відкидається зараз при мапінгу відповіді) — окремий ендпоінт для дашборду не потрібен.

---

## Рішення з brainstorming

1. **Головна сторінка = дашборд.** Блок статусу системи (Backend/PostgreSQL/Seed) і `ChatPanel` (загальний AI-чат з Дня 2) повністю прибираються з `HomeView.vue`. Кнопка «Анкета компанії» (перехід у найновішу співбесіду) теж прибирається — її замінює дія в конкретному рядку списку.
2. **Розташування кнопки створення.** «Створити співбесіду» лишається на дашборді, розміщена **над** списком; після успіху банер з кодом показується там само, а нова співбесіда одразу додається на початок локального списку (без повторного запиту).
3. **Мітки статусів — українською**, а не сирий enum:
   - `DRAFT` → «Чернетка»
   - `AWAITING_CANDIDATE` → «Очікує кандидата»
   - `READY` → «Готова»
   - `LIVE` → «В ефірі»
   - `ENDED` → «Завершена»
4. **Дія в рядку залежить від статусу конкретної співбесіди** (не глобально) — це узгоджується з майбутнім сценарієм, де HR веде кілька анкет/співбесід одночасно, кожна зі своїм незалежним станом:
   - `DRAFT` → активна кнопка **«Пройти анкету»** → `/prep/:interviewId`.
   - `AWAITING_CANDIDATE`, `READY`, `LIVE`, `ENDED` → неактивна кнопка **«Відкрити»** з `title="Скоро з'явиться"` (жива кімната співбесіди — Дні 15–19, поки що не існує).
5. **Дата створення** — лише дата, формат `дд.мм.рррр` (`toLocaleDateString("uk-UA")`), без часу.
6. **Порожній стан:** якщо співбесід немає — текст «У вас ще немає створених співбесід. Створіть першу!» замість таблиці.
7. **Помилка завантаження списку** — текстове повідомлення про помилку замість таблиці (той самий патерн, що вже є для health-check стану `error`).

---

## API-контракт

### `GET /api/interviews/mine` (розширення)

```
GET /api/interviews/mine
Headers: Authorization: Bearer <HR JWT>
```

Відповідь `200` (нове поле виділено):

```json
{
  "interviews": [
    {
      "id": "cmr9...",
      "joinCode": "K7M2P9",
      "status": "DRAFT",
      "createdAt": "2026-07-08T08:00:00.000Z"
    }
  ]
}
```

Сортування — без змін (`orderBy: { createdAt: "desc" }`, найновіші зверху). `POST /api/interviews` (Day 8) без змін — вже повертає `createdAt`.

---

## Зміни в існуючих файлах

### `backend/src/routes/interviews.ts`

У `GET /interviews/mine` мапінг відповіді додає `createdAt: item.createdAt`:

```ts
res.status(200).json({
  interviews: interviews.map((item) => ({
    id: item.id,
    joinCode: item.joinCode,
    status: item.status,
    createdAt: item.createdAt,
  })),
});
```

### `backend/src/routes/interviews.test.ts`

Оновити фейковий Prisma-double (уже містить `createdAt` у `FakeInterview`) і асерцію на ключі відповіді:

```ts
assert.deepEqual(Object.keys(body.interviews[0]).sort(), ["createdAt", "id", "joinCode", "status"]);
```

### `frontend/src/api/interviews.ts`

`InterviewSummary` отримує `createdAt`:

```ts
export type InterviewSummary = {
  id: string;
  joinCode: string;
  status: string;
  createdAt: string;
};
```

### `frontend/src/views/HomeView.vue` (повна заміна вмісту)

**Прибрати:** `fetchHealth`/`HealthResponse` імпорт і стан, блок `.status-list` у шаблоні, `ChatPanel` (імпорт і використання), кнопку/функцію `goToCompanyPrep` і `prepNavError`.

**Залишити:** заголовок сторінки, email HR, кнопку «Вийти», логіку `createInterview`/`createdInterview`/банер (з Дня 8) — але після успіху додатково `unshift` результат у локальний `interviews.value`.

**Додати:**

- `interviews = ref<InterviewSummary[]>([])`, `listState = ref<"loading" | "ready" | "error">("loading")`.
- `onMounted` викликає `fetchMyInterviews()` → заповнює `interviews.value`, `listState.value = "ready"`; при помилці — `listState.value = "error"` + повідомлення.
- Мапа міток статусів:

```ts
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  AWAITING_CANDIDATE: "Очікує кандидата",
  READY: "Готова",
  LIVE: "В ефірі",
  ENDED: "Завершена",
};
```

- Форматер дати:

```ts
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}
```

- Шаблон (спрощено):

```html
<div class="dashboard-actions">
  <button class="btn-primary" :disabled="creatingInterview" @click="onCreateInterview">
    {{ creatingInterview ? "Створення…" : "Створити співбесіду" }}
  </button>
  <p v-if="createInterviewError" class="fail">{{ createInterviewError }}</p>
</div>

<div v-if="createdInterview" class="created-banner">...</div>

<p v-if="listState === 'loading'">Завантаження…</p>
<p v-else-if="listState === 'error'" class="fail">{{ listError }}</p>
<p v-else-if="interviews.length === 0">У вас ще немає створених співбесід. Створіть першу!</p>
<table v-else class="interviews-table">
  <thead>
    <tr><th>Код</th><th>Статус</th><th>Дата створення</th><th>Дія</th></tr>
  </thead>
  <tbody>
    <tr v-for="interview in interviews" :key="interview.id">
      <td class="code-cell">{{ interview.joinCode }}</td>
      <td>{{ STATUS_LABELS[interview.status] ?? interview.status }}</td>
      <td>{{ formatDate(interview.createdAt) }}</td>
      <td>
        <button
          v-if="interview.status === 'DRAFT'"
          class="btn-primary"
          @click="router.push({ name: 'company-prep', params: { interviewId: interview.id } })"
        >
          Пройти анкету
        </button>
        <button v-else class="btn-disabled" disabled title="Скоро з'явиться">Відкрити</button>
      </td>
    </tr>
  </tbody>
</table>
```

- Стилі: `.interviews-table` (проста таблиця, border-collapse, паддінги, zebra чи border-bottom рядків — консистентно з наявним мінімалістичним стилем сторінки), `.btn-disabled` (сірий фон, `cursor: not-allowed`).

---

## Тестування і верифікація

**Backend (`interviews.test.ts`):**
- Оновлений тест `GET /interviews/mine returns interviews...` перевіряє наявність і значення `createdAt` в кожному елементі відповіді.
- Решта наявних тестів (`POST /interviews`, retry-логіка колізій) — без змін, уже проходять.

**Frontend:**
- `npx vue-tsc --noEmit -p tsconfig.app.json` — без помилок типів.
- Ручний сценарій (див. Definition of Done Дня 9 нижче).

**Ручний сценарій (Day 9 DoD):**
1. Логін `hr@test.com` / `123456` → дашборд одразу показує існуючі співбесіди (мінімум seed-співбесіда `TEST01`) у таблиці з кодом/статусом/датою.
2. Натиснути «Створити співбесіду» → з'являється банер з новим кодом, і цей рядок одразу видно в таблиці зі статусом «Чернетка».
3. Натиснути «Пройти анкету» на рядку зі статусом «Чернетка» → перехід на `/prep/:interviewId`, Company Agent вітається як завжди (Дні 4–7 без змін).
4. Пройти чат, завершити, підтвердити профіль → повернутись на головну → рядок цієї співбесіди тепер показує статус «Очікує кандидата» і неактивну кнопку «Відкрити» (з підказкою при наведенні).
5. Створити ще одну співбесіду → переконатись, що обидві незалежно відображаються у списку зі своїми статусами.

**Build:** `npm run build` у корені без помилок.

**README:** оновити чекбокси Дня 9 (`[ ]` → `[x]`) + додати Quick Start розділ з покроковим сценарієм перевірки (за зразком Днів 5–8).

---

## Поза scope (Day 9)

- Реальна функціональність «Відкрити» (жива кімната співбесіди) — Дні 15–19.
- Перегляд/редагування профілю компанії для співбесід у статусі `AWAITING_CANDIDATE` і далі прямо з дашборду.
- Пагінація, фільтрація чи сортування списку (наразі досить простого списку, відсортованого за датою).
- Видалення чи архівація співбесід (у будь-якому статусі).
- Позначення статусу «обидва учасники готові» тощо — це відповідальність подальших днів (10–14, кандидатська частина).

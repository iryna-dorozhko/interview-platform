# HR перегляд завершеного спільного чату — Design Spec

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming  
**Контекст:** Після `ENDED` HR має зручно відкрити спільний live-чат з конкретним кандидатом лише для читання.  
**Передумови:** Live room (`/interviews/:id/room`), `canAccessInterviewRoom` з `readOnly` для `ENDED`, сторінки `InterviewDetailView` і `ReportView`.  
**Мова:** Українська (UI)

---

## Контекст і мета

MVP уже має:

- Спільний live-чат (HR, кандидат, Arbiter, Company AI, Candidate AI)
- Socket.IO join для `ENDED` у режимі `readOnly` (історія повідомлень завантажується, відправка блокується)
- Посилання на звіт зі списку співбесід і зі сторінки співбесіди

**Що відсутнє:**

- Явне посилання «переглянути спільний чат» зі сторінки співбесіди та звіту після завершення

**Мета:** HR зі сторінки співбесіди або звіту одним кліком відкриває завершений спільний чат у існуючій live-кімнаті (read-only).

**Поза scope:**

- Доступ кандидата до перегляду чату з кабінету
- Кнопка в списку співбесід
- Окремий REST transcript / новий API
- Окремий route на кшталт `/interviews/:id/chat`
- Додатковий polish UI кімнати під «режим архіву» (окремий банер, приховування agent sidebar тощо)

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Хто переглядає | Лише HR |
| Точки входу | Сторінка співбесіди + сторінка звіту |
| Як показувати | Існуюча live-кімната read-only через Socket.IO |
| Підхід | Посилання на `/interviews/:id/room` без нових backend-змін |

---

## Підходи (розглянуті)

### 1. Посилання + існуюча кімната — обрано

`RouterLink` на detail і report → `interview-room`. Backend уже підтримує `ENDED` read-only.

**Плюси:** мінімальний scope, без нових API.  
**Мінуси:** UX кімнати лишається «живим» (Socket.IO), хоча писати не можна.

### 2. Те саме + polish UI кімнати — відхилено для MVP

Чіткіший банер / приховування agent-noise для `ENDED`. Можна додати окремим кроком.

### 3. Окремий route поверх тієї ж кімнати — відхилено

Семантичніший URL без нової поведінки — зайва маршрутизація.

---

## UI і точки входу

### `InterviewDetailView` (`/interviews/:id`)

Коли `interview.status === 'ENDED'`:

- Показати посилання **«Переглянути спільний чат»** → `{ name: 'interview-room', params: { id: interview.id } }`
- Якщо є `reportId` — зберегти існуюче «Переглянути повний звіт» без змін сенсу

### `ReportView` (`/reports/:id`)

- Показати посилання **«Переглянути спільний чат»** → `{ name: 'interview-room', params: { id: report.interviewId } }`
- `interviewId` уже є в `FinalReport` / `GET /api/reports/:id`

Текст посилання однаковий на обох сторінках. Окремого copy/банера в кімнаті не додаємо.

---

## Потік даних

```
HR → InterviewDetailView або ReportView
  → RouterLink → /interviews/:id/room
  → useInterviewRoom → room:join
  → room:messages (історія LiveMessage)
  → room:status ENDED → isReadOnly = true → ввід вимкнено
```

Нових REST-ендпоінтів і змін у Prisma/Socket handlers не потрібно.

---

## Помилки та крайні випадки

| Ситуація | Поведінка |
|----------|-----------|
| Чужа співбесіда / немає доступу | Існуючий `room:error` |
| Спроба надіслати повідомлення при `ENDED` | Існуюча відмова («Співбесіда завершена») |
| Немає live-сесії / повідомлень | Порожній чат (існуюча поведінка `ensureLiveSession` + порожній список) |

---

## Тестування

- Backend: існуючі тести `canAccessInterviewRoom` / room для `ENDED` read-only — без змін у цьому scope
- Frontend: ручна перевірка
  1. Завершена співбесіда → detail → «Переглянути спільний чат» → історія видима, ввід disabled
  2. Звіт цієї співбесіди → те саме посилання → та сама кімната
  3. (Опційно) спроба send → помилка / блок

Автотести Vue для двох `RouterLink` не обов’язкові в MVP.

---

## Файли для змін

| Файл | Зміна |
|------|--------|
| `frontend/src/views/InterviewDetailView.vue` | Посилання на room при `ENDED` |
| `frontend/src/views/ReportView.vue` | Посилання на room за `report.interviewId` |

Backend / router / composable — без змін.

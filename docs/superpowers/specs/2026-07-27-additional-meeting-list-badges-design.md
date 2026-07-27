# Позначка «Додаткова» у списках співбесід і звітів — Design Spec

**Дата:** 2026-07-27  
**Статус:** Затверджено в brainstorming  
**Передумови:** `Interview.kind` (`STANDARD` | `ADDITIONAL_MEETING`), follow-up create flow

## Контекст і мета

HR у списках співбесід і звітів не бачить, які записи стосуються додаткової (повторної) зустрічі. Поле `kind` уже є на інтерв’ю та в DTO списку співбесід, але в UI не відображається; список звітів `kind` не віддає.

**Мета:** показати компактну позначку **«Додаткова»** біля первинного ідентифікатора рядка, коли `Interview.kind === ADDITIONAL_MEETING`.

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Текст | «Додаткова» |
| Розташування | Поруч із email (звіти) / назвою (співбесіди) |
| Джерело сигналу | `Interview.kind` (підхід 1) |

## UX

### Співбесіди (`InterviewListView`)

- У клітинці «Назва»: `displayName` + badge «Додаткова», якщо `kind === ADDITIONAL_MEETING`.
- Backend змін не потрібно (`GET /interviews/mine` уже повертає `kind`).

### Звіти (`ReportListView`)

- У клітинці «Пошта»: email (або «—») + badge «Додаткова», якщо `interviewKind === ADDITIONAL_MEETING`.
- Посилання на звіт лишається на email / «—» як зараз.

### Стиль badge

- Короткий нейтральний badge (не кольори recommendation HIRE/MAYBE/REJECT).
- Текст українською: `Додаткова`.
- Для `STANDARD` — без позначки.

## Backend

### `GET /api/reports`

Додати до кожного елемента списку:

```json
"interviewKind": "STANDARD" | "ADDITIONAL_MEETING"
```

Значення з `report.interview.kind` (default `STANDARD`, якщо null у старих даних — через Prisma default уже `STANDARD`).

`GET /api/reports/:id` — поза scope цього spec (деталь звіту без обов’язкової позначки).

## Frontend

- `ReportSummary.interviewKind` у `frontend/src/api/reports.ts`.
- `ReportListView.vue` — badge біля email.
- `InterviewListView.vue` — badge біля `displayName` за `interview.kind`.
- Опційно спільний маленький CSS-клас / компонент, якщо зручно без over-abstraction.

## Поза scope

- Фільтр списків за типом співбесіди
- Позначка на сторінці деталі звіту / live room
- Зміна `displayName` інтерв’ю
- Candidate-кабінет списки

## Тестування

**Backend:** `GET /api/reports` повертає `interviewKind` для STANDARD і ADDITIONAL_MEETING.

**Frontend:** `npm run build`.

## Звʼязок із кодом

- `backend/src/routes/reports.ts`, `reports.test.ts`
- `frontend/src/api/reports.ts`
- `frontend/src/views/ReportListView.vue`
- `frontend/src/views/InterviewListView.vue`
- Існуюче: `Interview.kind` / interview list DTO

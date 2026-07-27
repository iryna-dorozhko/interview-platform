# Додаткова зустріч: follow-up контекст + логіка Company Agent у live-чаті — Design Spec

**Дата:** 2026-07-27  
**Статус:** Затверджено в brainstorming  

## Контекст
Після HR рішення `ADDITIONAL_MEETING` у `ReportView` система надсилає кандидату **letter у “Діалоги”** і фіксує `InterviewDecision`, але **нову** співбесіду HR створює вручну кнопкою на вкладці `Співбесіди`.

У наступній live-співбесіді (додатковій зустрічі) `Company Agent` має ставити питання так, щоб закрити “що лишилось” з попередньої співбесіди, зокрема по ризиках/незакритих темах з попереднього `FinalReport`.

Кандидатська сторона має йти **без нового prep** — одразу live-кімната.

## Ціль
1) Додати UX-кнопку “Створити додаткову зустріч” поруч із “Створити зустріч” у списку співбесід.
2) Під час створення додаткової зустрічі зберігати прив’язку нового `Interview` до source `FinalReport`, з якого треба брати follow-up контекст.
3) Оновити `Company Agent` так, щоб `NEXT_QUESTION`/`CLARIFY` у додатковій зустрічі фокусувались на темах із source `FinalReport`.

## Нецілі (out of scope для цього spec)
- Socket.IO / realtime оновлення по “Діалогам”
- Автоматичне створення new `Interview` при відправці HR листа (тільки вручну кнопкою)
- Внесення змін у `Candidate Agent` (без prep уже працює через наявний questionnaire-профіль)

## UX / Flow (HR)
1. HR у `ReportView` обирає `ADDITIONAL_MEETING` → відправляє letter у “Діалоги”.
2. HR відкриває вкладку `Співбесіди`.
3. Натискає `Створити додаткову зустріч`.
4. HR обирає кандидата зі списку, де є рішення `ADDITIONAL_MEETING`.
5. Система створює новий `Interview` (mode = додаткова зустріч) і одразу веде HR у live-кімнату (join code показується як у звичайному створенні).

## Дані (DB / Prisma)

### Нові поля
- `Interview.kind: InterviewKind`  
  - значення: `STANDARD` (default) | `ADDITIONAL_MEETING`
- `Interview.followUpFromFinalReportId: String?`  
  - FK → `FinalReport.id`

### Інваріанти
- Для `Interview.kind = ADDITIONAL_MEETING` поле `followUpFromFinalReportId` має бути встановлене (або створення повинно відхилитись).

## Бекенд: API

### 1) Список кандидатів для “додаткової”
`GET /api/hr/additional-meeting-candidates`

Повертає кандидата(ів), для яких HR має рішення:
- `InterviewDecision.type = ADDITIONAL_MEETING`

Для MVP:
- для кожного кандидата беремо найсвіжіший `ADDITIONAL_MEETING` рішення HR

### 2) Створення додаткової зустрічі
`POST /api/hr/interviews/additional`

Body:
```json
{ "candidateUserId": "string", "scheduledAt": "string|null" }
```

Логіка:
1. Знайти latest `InterviewDecision` типу `ADDITIONAL_MEETING` для пари `(HR, candidateUserId)`.
2. Дістати `finalReportId` з цього decision.
3. Створити новий `Interview`:
   - `kind = ADDITIONAL_MEETING`
   - `followUpFromFinalReportId = sourceFinalReportId`
   - `vacancyId` береться з `Interview`-зв’язку source decision
   - join code / invitation — як у стандартному `POST /api/interviews`

Помилки:
- якщо source decision не знайдено → `404/409` з user-friendly message
- якщо vacancy не підтверджена/hidden → як у існуючому create

## Company Agent: зміни в логіці

### Джерело follow-up контексту
При живій turn:
- якщо `interview.kind = ADDITIONAL_MEETING`
  - завантажуємо `FinalReport` по `followUpFromFinalReportId`
  - передаємо в `Company Agent` follow-up контекст:
    - `finalReport.risks`
    - `finalReport.reportMarkdown` (предпочтено для unknown/unmet/unknown-подій)

### Оновлення системного промпту
Оновлюємо `COMPANY_LIVE_AGENT_SYSTEM_PROMPT_UK`:
- додаємо плейсхолдер `{{FOLLOW_UP_CONTEXT}}`
- у правилах для `NEXT_QUESTION`/`CLARIFY`:
  - якщо `FOLLOW_UP_CONTEXT` не пустий → ставити питання для “закриття” тем із цього контексту
  - не дублювати питання, які вже прозвучали в поточному live-чаті (`history` вже дає це як сигнал)

### Candidate Agent
Не змінюється: додаткова зустріч може стартувати без prep, а профіль кандидата має братися через existing questionnaire-профіль (як у `resolveCandidateProfileForInterview`).

## Тестування (мінімальний план)
Backend:
- Unit/route-тести для `POST /api/hr/interviews/additional`:
  - створює `Interview.kind=ADDITIONAL_MEETING`
  - встановлює `followUpFromFinalReportId`
  - вибирає correct source decision/final report
- Unit-тест для “формування prompt input” (що follow-up контекст потрапляє в system message) — не тестуємо якісний output LLM.

Frontend:
- `npm run build` у `frontend/`


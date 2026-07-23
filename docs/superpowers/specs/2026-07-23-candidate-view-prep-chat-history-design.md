# Кандидат: перегляд prep-чату з AI після анкети — Design Spec

**Дата:** 2026-07-23  
**Статус:** Затверджено в brainstorming  
**Контекст:** Після `finish` / `confirm` кандидат бачить лише зібрану анкету; історія чату з Candidate Agent у БД є, але UI для перегляду відсутній (на відміну від HR `VacancyPrepView`).  
**Передумови:** `/candidate/profile` (`CandidateProfileView`), `GET /api/candidate-prep/:id` повертає `messages`, `PrepChatPanel`, патерн `viewingHistory` у HR prep.  
**Мова:** Українська (UI)

---

## Контекст і мета

MVP уже має:

- Prep-чат кандидата з Candidate Agent (`PrepSessionCandidate` / `PrepMessageCandidate`)
- Закриття чату → extraction → `CandidateProfile`; confirm фіксує `confirmedAt`
- Після `isClosed` UI показує анкету (editable до confirm, read-only після)
- HR vacancy / company prep: кнопка «← Назад до чату» + `viewingHistory`

**Проблема:** у кандидата немає способу переглянути діалог з агентом після finish/confirm, хоча messages уже приходять у GET prep state.

**Мета:** дати кандидату read-only перегляд prep-чату на тій самій сторінці анкети, за тим самим UX-патерном, що в HR.

**Поза scope:**

- Live-чат співбесіди (`LiveMessage` / Socket.IO)
- Окремий маршрут / пункт сайдбару «Історія чату»
- Зміни backend / нового REST endpoint
- Рефактор `CandidateProfileView` під повну структуру `VacancyPrepView` + `usePrepChat`
- Зміна поведінки «Почати заново» / delete після confirm

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Який чат | Prep-чат Candidate Agent (не live) |
| Точка входу | Кнопка на екрані анкети (та сама сторінка) |
| Коли доступно | Після finish **і** після confirm |
| Режим | Read-only (без composer) |
| Підхід | `viewingHistory` як у HR; `PrepChatPanel` з уже завантаженими `prepState.messages` |

---

## Підходи (розглянуті)

### 1. `viewingHistory` + `PrepChatPanel` з `prepState` — обрано

Прапорець у `CandidateProfileView`; історію рендерити через `PrepChatPanel` (`isClosed=true`) без монтування `CandidatePrepChat`.

**Плюси:** паритет з HR, без API-змін, мінімальний scope.  
**Мінуси:** два шляхи показу чату (активний `CandidatePrepChat` vs історія `PrepChatPanel`) — прийнятно.

### 2. Окремий спрощений список повідомлень — відхилено

Швидше, але інший UI, ніж активний чат / HR.

### 3. Повний рефактор під `VacancyPrepView` — відхилено для цього кроку

Консистентно, але зайвий рефактор для фічі перегляду історії.

---

## UX / стани

Сторінка: `/candidate/profile`.

Коли `isClosed && profile`:

| Стан | UI |
|------|-----|
| Анкета (за замовчуванням, `viewingHistory=false`) | Профіль + існуючі CTA + кнопка **«← Назад до чату»** |
| Історія (`viewingHistory=true`) | Read-only `PrepChatPanel` + **«Показати анкету»** |

Правила:

- До confirm і після confirm — однакова кнопка перегляду історії.
- CTA анкети («Підтвердити», «Підібрати вакансію», «Почати заново» тощо) лише на екрані анкети, не в історії.
- Активний чат до finish: без змін (`showPrepChat` + `CandidatePrepChat`).

---

## Архітектура / дані

### Backend

Без змін. `GET /api/candidate-prep/:interviewId` уже віддає `messages` + `isClosed` + `profile`.

### Frontend — `CandidateProfileView.vue`

1. Додати `viewingHistory = ref(false)`.
2. Скидати `viewingHistory = false` після: finish → reload, confirm, delete/restart, початкового `loadProfile`.
3. `backToChat()` → `viewingHistory = true`; `backToProfile()` → `false`.
4. Умова екрану анкети: `isClosed && profile && !viewingHistory` (для editable і confirmed гілок).
5. У режимі історії: `PrepChatPanel` з:
   - `title`: «Чат з Candidate Agent»
   - `messages`: `prepState.messages`
   - `isClosed`: `true`
   - `load-state`: `'ready'` (дані вже в `prepState`)
   - `#actions`: кнопка «Показати анкету» (без delete/send у цьому режимі)
6. **Не** монтувати `CandidatePrepChat` для історії — його `onAfterLoad` при `isClosed` емить `finished` і батько ховає чат.

Мапінг автора: `HUMAN_CANDIDATE` → «Ви», інакше «Агент» (через `isUserMessage`, як у prep).

---

## Країні випадки

| Кейс | Поведінка |
|------|-----------|
| Порожній `messages` | Кнопка «← Назад до чату» є; порожній read-only чат |
| Confirm | Історія лишається доступною, поки сесію не видалено |
| «Почати заново» / delete | Wipe сесії → `viewingHistory=false` → активний чат |
| Підтверджений профіль в історії | Лише «Показати анкету»; без send/delete у цьому режимі |

---

## Тестування

- Backend: не потрібно.
- Frontend: мінімально перевірити логіку стану (кнопка після `isClosed`; перемикання `viewingHistory`). Якщо в проєкті немає зручного unit-харнесу для цього view — ручна перевірка в браузері достатня для MVP.

Checklist ручної перевірки:

1. Finish анкети → на профілі є «← Назад до чату» → історія read-only → «Показати анкету».
2. Confirm → те саме.
3. «Почати заново» після confirm → історія зникає, знову активний чат.

---

## Файли для змін

| Файл | Зміна |
|------|--------|
| `frontend/src/views/CandidateProfileView.vue` | `viewingHistory`, кнопки, умовний `PrepChatPanel` |
| (опційно) тести / smoke | лише якщо вже є патерн для view |

Нових API / Prisma / routes — немає.

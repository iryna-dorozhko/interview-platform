# Prep Chat Dedup & Dead Code Cleanup — Design Spec

**Дата:** 2026-07-22  
**Статус:** Затверджено в brainstorming  
**Контекст:** Одні й ті самі prep-екрани/чати скопійовані кілька разів; є невикористаний demo-чат  
**Передумови:** Vacancy / Company / Candidate prep HTTP flows; `CandidateProfileView` + `CandidatePrepChat` як актуальний candidate UX; live chat уже витягнутий у `InterviewRoomContent` / `LiveChatPanel`  
**Мова:** Українська (UI-копії); код і API — англійською

---

## Проблема

1. `VacancyPrepView`, `CompanyProfilePrepView` і legacy `CandidatePrepView` дублюють один і той самий chat-цикл (load → greeting → send → retry → finish → delete) і майже ідентичний CSS/markup чату.
2. `CandidatePrepView` дублює актуальний flow `CandidateProfileView` + `CandidatePrepChat`; маршрут `candidate-prep` не має навігації з UI.
3. `ChatPanel.vue` + `api/llm.ts` (і `api/health.ts`) ніде не імпортуються — мертвий demo-код.

## Мета

1. Один source of truth для prep-chat логіки та UI.
2. Прибрати legacy candidate prep screen і dead demo code.
3. Не змінювати продуктову поведінку prep-флоу для HR і кандидата.

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Скоуп | **B** — dead code + legacy `CandidatePrepView` + спільний `usePrepChat` / `PrepChatPanel` |
| Підхід | **1** — composable + UI-панель; views лишають профіль і API wiring |
| Live / dialogs | Поза scope (різні домени) |
| Backend `/api/llm/complete` | Лишити (smoke/devtools); прибрати лише frontend client |

## Поза scope

- Злиття з `LiveChatPanel` / decision dialogs
- Спільний редактор профілю (поля різні між vacancy / company / candidate)
- Зміни backend / API-контрактів
- Рефактор `LoginView` / `CandidateLoginView`
- Спільний примітив для всіх message threads у продукті

---

## Архітектура

```
View (профіль + wiring)
  └─ usePrepChat(adapters)     ← load / send / retry / finish / delete
  └─ PrepChatPanel             ← messages / thinking / error+retry / composer
```

### `usePrepChat`

Adapters інжектять конкретні API (`prep` / `company-prep` / `candidate-prep`) і класифікацію повідомлень.

```ts
type PrepChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  // authorType з відповідного API; UI класифікує через isUserMessage
};

type PrepChatAdapters<TProfile> = {
  loadState: () => Promise<{
    messages: PrepChatMessage[];
    isClosed: boolean;
    profile: TProfile | null;
  }>;
  sendMessage: (text?: string) => Promise<{
    message: string;
    readyForConfirmation: boolean;
  }>;
  finishChat: () => Promise<void | { profile: TProfile }>;
  deleteChat: () => Promise<void>;
  isUserMessage: (msg: PrepChatMessage) => boolean;
  agentAuthorType: string; // для локальних reply після send / retry
};
```

Options також приймають callbacks: `onFinished`, `onDeleted`, опційно `onAfterLoad(state)` (для Vacancy: паралельний `fetchVacancy`, `missingCompanyProfile` тощо — без роздування composable).

Повертає: `loadState`, `errorMessage`, `messages`, `isClosed`, `profile`, `input`, `sending`, `lastFailedAction`, `lastReadyForConfirmation`, `messagesEl`, методи `load` / `send` / `retry` / `finish` / `delete` / `onKeydown` / `scrollToBottom`.

**Поведінка (без змін vs поточний UI):**

- greeting при порожній історії;
- optimistic user bubble перед відповіддю агента;
- retry **без** повторного тексту user message (лише agent POST / finish);
- confirm перед finish, якщо `!readyForConfirmation`;
- confirm перед delete;
- `FailedAction`: `"greeting" | "message" | "finish"`.

### `PrepChatPanel.vue`

Controlled props від composable + слоти:

- props: `messages`, `sending`, `isClosed`, `input` (v-model), `errorMessage`, `lastFailedAction`, `loadState`, `title`, `isUserMessage`, `deleteDisabled` / `deleteTitle`
- emits: `send`, `retry`, `finish`, `delete`
- slot `actions` (опційно); default — «Видалити чат» / «Завершити чат»
- спільні styles з поточного chat-блоку (не з live)

Дрібні відмінності copy (заголовки, confirm-тексти) — через props / підтвердження у composable options або view, не один захардкожений рядок на всі ролі.

### Wiring споживачів

| Споживач | Як |
|---|---|
| `CandidatePrepChat` | Тонкий wrapper: adapters з `candidate-prep` + `PrepChatPanel` |
| `CompanyProfilePrepView` | Composable у script; chat-секція → `PrepChatPanel`; profile-view локально |
| `VacancyPrepView` | Те саме + `onAfterLoad` для vacancy metadata |
| `CandidatePrepView` | **Видаляється** |

---

## Видалення та маршрути

**Видалити файли:**

- `frontend/src/views/CandidatePrepView.vue`
- `frontend/src/components/ChatPanel.vue`
- `frontend/src/api/llm.ts`
- `frontend/src/api/health.ts`

**Router:** `path: "prep/:interviewId"` → `redirect: { name: "candidate-profile" }`. Ім’я маршруту `candidate-prep` можна лишити для старих лінків.

**Документація:** у README UI-шлях кандидата — `/candidate/profile` замість `/candidate/prep/:interviewId` (API `/api/candidate-prep` лишається).

**Не чіпати:** backend `/api/llm/complete`, live room components, decision dialogs.

---

## Ризики

| Ризик | Мітігація |
|-------|-----------|
| Vacancy додатковий load | `onAfterLoad`, не спеціальні гілки всередині ядра composable |
| Candidate `finish` може не повертати profile у компоненті | Adapters підтримують `void \| { profile }`; parent (`CandidateProfileView`) як і зараз перезавантажує стан |
| Різні заголовки / confirm copy | Props / options |
| Старі закладки `/candidate/prep/:id` | Redirect на актуальний profile flow |

---

## Порядок міграції

1. Додати `usePrepChat` + unit-тести.
2. Додати `PrepChatPanel`, перевести `CandidatePrepChat`.
3. Перевести `CompanyProfilePrepView`, потім `VacancyPrepView`.
4. Redirect + видалити `CandidatePrepView`.
5. Видалити `ChatPanel` / `llm.ts` / `health.ts`, підчистити README.
6. Smoke трьох prep-флоу.

Між кроками UX не повинен регресувати: кожен споживач перемикається повністю на новий шар перед наступним.

---

## Тестування / Done when

**Автоматично:**

- Unit на `usePrepChat`: load→greeting; send; retry для greeting / message / finish; delete.

**Ручний smoke:**

- Vacancy prep: chat → finish → confirm / edit profile
- Company profile prep: те саме
- Candidate profile: embedded chat → finish → confirm

**Done when:**

- Один chat-цикл і один chat-UI для всіх prep
- Немає `CandidatePrepView` і demo `ChatPanel`
- Тести composable зелені; ручний smoke ок
- Продуктова поведінка prep не змінена навмисно

# Candidate Live Agent: степінь впевненості (confidence)

**Дата:** 2026-07-20  
**Статус:** затверджено в brainstorming  
**Контекст:** live-чат співбесіди, `AGENT_CANDIDATE`  
**Передумови:** Day 18 live agents, spec `2026-07-16-candidate-live-third-person-deferral-design.md`

---

## Проблема

У live-чаті Candidate Agent відповідає з профілю кандидата, але HR не бачить **наскільки надійна** відповідь:

- факт прямо з анкети vs висновок AI vs прогалина в профілі;
- поточна логіка `needsHuman` бінарна і не розрізняє «висновок з часткових даних» (можна продовжити) від «немає даних взагалі» (треба людина);
- фінальний звіт не враховує рівень впевненості AI-відповідей при формуванні `risks`.

Spec від 2026-07-16 навмисно уникав нових JSON-полів; цей spec **додає** структуроване поле `confidence` як еволюцію дизайну.

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Де видима впевненість | Структуроване поле + бейдж у чаті + інтеграція у фінальний звіт |
| Рівні | 3: `confirmed` · `inferred` · `unknown` |
| Поведінка оркестратора | `inferred` → без паузи; `unknown` → `needsHuman: true`, стоп |
| Хто бачить бейдж | HR і кандидат (однаково) |
| Звіт | Повна інтеграція — мітки в transcript + правила для `risks` |
| Архітектура даних | Окреме nullable enum-поле на `LiveMessage` (підхід 1) |

---

## Цілі

- Candidate Live Agent повертає структурований рівень впевненості для кожної відповіді в режимі `ANSWER`.
- HR і кандидат бачать бейдж біля повідомлення AI («З профілю» / «Висновок» / «Потрібна відповідь»).
- `needsHuman` обчислюється з `confidence` (не дублюється в JSON від LLM).
- Фінальний звіт враховує мітки впевненості при формуванні `risks`.
- Бейджі зберігаються в БД і переживають reload.

## Нецілі

- Числова шкала 0–100 для confidence.
- Confidence для Company Agent або Arbiter.
- Зміни prep-агента кандидата (анкета до live).
- Окремий `authorType` для defer-to-human.
- Generic `metadata Json` на `LiveMessage`.
- Зміна JSON-схеми `FinalReport` (`recommendation`, `matchScore`, `strengths`, `risks` лишаються як є).

---

## Підходи (розглянуті)

### 1. Окреме enum-поле в БД + похідний `needsHuman` (обрано)

Prisma enum `CandidateConfidence` + nullable `candidateConfidence` на `LiveMessage`. LLM повертає `confidence`; парсер ставить `needsHuman = (confidence === "unknown")`.

**Плюси:** одне джерело правди, queryable, переживає reload, типізовано.  
**Мінуси:** міграція Prisma.

### 2. Лише промпт + текст (відхилено)

Впевненість лише у формулюванні без структурованого поля.

**Плюси:** мінімальний diff.  
**Мінуси:** не підходить під цілі (немає бейджа, немає даних для звіту).

### 3. Generic `metadata Json` (відхилено)

**Плюси:** розширюваність.  
**Мінуси:** over-engineering; гірша типізація для одного enum.

---

## Модель даних

### Prisma

```prisma
enum CandidateConfidence {
  CONFIRMED   // факт прямо з профілю
  INFERRED    // висновок / часткові дані
  UNKNOWN     // прогалина → needsHuman
}

model LiveMessage {
  id                  String                @id @default(cuid())
  sessionId           String
  authorType          LiveAuthorType
  content             String
  candidateConfidence CandidateConfidence?  // лише AGENT_CANDIDATE + ANSWER
  createdAt           DateTime              @default(now())
  session             LiveSession           @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}
```

### JSON-контракт Candidate Live Agent

Для режиму `ANSWER`:

```json
{ "post": true, "message": "...", "confidence": "confirmed" }
```

| `confidence` (LLM, lowercase) | Prisma enum | `needsHuman` (парсер) | Оркестратор |
|--------------------------------|-------------|-------------------------|-------------|
| `confirmed` | `CONFIRMED` | `false` | продовжує |
| `inferred` | `INFERRED` | `false` | продовжує |
| `unknown` | `UNKNOWN` | `true` | **стоп**, чекає `HUMAN_CANDIDATE` |

Для команди `CANDIDATE_QUESTIONS` поле `confidence` **не обов'язкове** → `candidateConfidence: null` у БД, без бейджа.

`needsHuman` у JSON від LLM **не приймається** — парсер обчислює сам.

### API / Socket DTO

```typescript
export type CandidateConfidenceDto = "CONFIRMED" | "INFERRED" | "UNKNOWN";

export type LiveMessageDto = {
  id: string;
  authorType: LiveAuthorTypeDto;
  content: string;
  candidateConfidence?: CandidateConfidenceDto | null;
  createdAt: string;
};
```

---

## Candidate Live Agent

### Три режими `ANSWER`

| `confidence` | Коли | Тон (приклад) |
|---|---|---|
| `confirmed` | Факт прямо з профілю | «Кандидат має 5 років досвіду з Node.js…» |
| `inferred` | Висновок / часткові дані / зона росту | «З анкети видно, що кандидат ще не застосовував Pinia…» |
| `unknown` | Немає релевантних даних | «Ірино, у профілі немає деталей — будь ласка, відповідай сама» |

### Зміна від spec 2026-07-16

Раніше «прогалина / зона росту» → `needsHuman: true` (стоп + прохання підтвердити).  
Тепер → `confidence: inferred`, розмова **продовжується** без паузи.  
Лише `unknown` зупиняє оркестратор.

### Голос і правила (без змін)

- Завжди третя особа про кандидата.
- Заборонено вигадувати факти поза профілем.
- `post: true` обов'язково для всіх трьох режимів (не мовчати).
- `post: false` — лише аварійний вихід.

### Формат JSON у промпті

```
{ "post": true, "message": "...", "confidence": "confirmed" | "inferred" | "unknown" }
```

---

## Парсер

`parseCandidateLiveReply()` у `candidate-live-agent.ts`:

```typescript
type CandidateConfidenceLevel = "confirmed" | "inferred" | "unknown";

interface ParsedCandidateLiveReply {
  post: boolean;
  message?: string;
  confidence?: CandidateConfidenceLevel;
  needsHuman: boolean;
}
```

Правила:

- `post: true` + режим `ANSWER` (визначається контекстом виклику / turnContext): `confidence` **обов'язкове** → інакше `CandidateLiveReplyParseError`.
- `post: true` + `CANDIDATE_QUESTIONS`: `confidence` опційне.
- `needsHuman = confidence === "unknown"` (для `post: false` → `needsHuman: false`).

Мапінг lowercase → Prisma enum у `saveAndEmit`.

`parsePostReply()` у `agent-post-reply.ts` **не змінюється** (Company Agent).

---

## Оркестратор

`saveAndEmit()` розширити опційним `candidateConfidence`:

```typescript
async function saveAndEmit(
  io: Server,
  prisma: PrismaClient,
  sessionId: string,
  interviewId: string,
  authorType: LiveAuthorType,
  content: string,
  candidateConfidence?: CandidateConfidence | null,
): Promise<LiveMessage>
```

При збереженні `AGENT_CANDIDATE`:

```typescript
await prisma.liveMessage.create({
  data: { sessionId, authorType, content, candidateConfidence: confidence ?? null },
});
```

Логіка стопу **без змін**:

```typescript
if (!reply.post || reply.needsHuman === true) {
  break;
}
```

`inferred` і `confirmed` → `needsHuman: false` → черга продовжується.

---

## Arbiter

Оновити правило черги в `arbiter-agent.uk.ts`:

**Було:** WAIT після assumption + прохання підтвердити.  
**Стало:**

- WAIT — лише якщо Candidate повернув `unknown` і попросив живу людину відповісти; не повторюй ANSWER, поки не буде `HUMAN_CANDIDATE`.
- Якщо Candidate відповів з `inferred` — оціни відповідь; дай `NEXT_QUESTION` або `CLARIFY`; **не чекай** підтвердження від людини.
- Решта правил без змін.

Arbiter не отримує `confidence` як окреме поле — орієнтується на зміст останнього `AGENT_CANDIDATE` у історії.

---

## UI

Бейдж показується лише для `authorType === "AGENT_CANDIDATE"` і `candidateConfidence !== null`.

| Enum | Бейдж (UA) | Колір |
|------|------------|-------|
| `CONFIRMED` | З профілю | зелений `#059669` |
| `INFERRED` | Висновок | amber `#d97706` |
| `UNKNOWN` | Потрібна відповідь | помаранчевий `#ea580c` |

Розташування: поруч із лейблом «Кандидат (AI)» у `LiveChatPanel.vue`.

```
[Кандидат (AI)]  [З профілю]
Кандидат має 5 років досвіду з Node.js…
```

HR і кандидат бачать однаковий бейдж.

### Файли (frontend)

| Файл | Зміна |
|------|-------|
| `frontend/src/composables/useInterviewRoom.ts` | `candidateConfidence?` у `LiveMessage` |
| `frontend/src/utils/live-message-styles.ts` | `confidenceBadgeFor()` + стилі |
| `frontend/src/components/LiveChatPanel.vue` | рендер бейджа |

---

## Фінальний звіт

### Transcript

`formatLiveTranscript()` додає мітку для `AGENT_CANDIDATE` з `candidateConfidence`:

```
[Кандидат (AI) · confirmed] Кандидат має 5 років досвіду з Node.js…
[Кандидат (AI) · inferred] З анкети видно, що кандидат ще не застосовував Pinia…
[Кандидат (AI) · unknown] Ірино, у профілі немає деталей з цього питання…
```

Повідомлення без `candidateConfidence` — без мітки (формат як раніше).

`LiveTranscriptItem` розширити опційним `candidateConfidence`.

### Промпт `final-report.uk.ts`

Додати правила:

- Відповіді з міткою `confirmed` — підтверджені факти з анкети.
- Відповіді з `inferred` — **не трактувати як підтверджений досвід**; включати в `risks` як caveat («висновок AI, не підтверджено кандидатом у чаті»), якщо тема суттєва для вимог вакансії.
- Відповіді з `unknown` + наступна `HUMAN_CANDIDATE` — пріоритет слів живої людини над AI.
- Якщо HR прийняв `inferred`-відповідь без заперечень — можна знизити вагу ризику в аналізі, але **не підвищувати** `matchScore` автоматично.

JSON-схема звіту не змінюється.

---

## Файли для реалізації

| Файл | Зміна |
|------|-------|
| `backend/prisma/schema.prisma` | enum + поле |
| `backend/src/agents/prompts/candidate-live-agent.uk.ts` | 3 рівні + JSON |
| `backend/src/agents/candidate-live-agent.ts` | nudge + `parseCandidateLiveReply` |
| `backend/src/agents/candidate-live-agent.test.ts` | парсер + prompt asserts |
| `backend/src/agents/prompts/arbiter-agent.uk.ts` | WAIT лише для `unknown` |
| `backend/src/agents/arbiter-agent.test.ts` | prompt assert |
| `backend/src/agents/final-report-agent.ts` | transcript з мітками |
| `backend/src/agents/prompts/final-report.uk.ts` | правила confidence |
| `backend/src/agents/final-report-agent.test.ts` | transcript format |
| `backend/src/socket/orchestrator.ts` | `saveAndEmit` + confidence |
| `backend/src/socket/orchestrator.test.ts` | inferred продовжує; unknown стоп |
| `backend/src/socket/room.ts` | `toDto` + confidence |
| `backend/src/socket/types.ts` | DTO |
| `frontend/src/composables/useInterviewRoom.ts` | тип |
| `frontend/src/utils/live-message-styles.ts` | бейдж |
| `frontend/src/components/LiveChatPanel.vue` | UI |

---

## Тест-план

### Юніт-тести

| Тест | Перевірка |
|------|-----------|
| `parseCandidateLiveReply` | `confirmed`/`inferred` → `needsHuman: false`; `unknown` → `true` |
| `parseCandidateLiveReply` | parse error без `confidence` у ANSWER |
| `formatLiveTranscript` | мітки `· confirmed/inferred/unknown` |
| Prompt asserts | ключові правила в candidate-live + arbiter промптах |
| `orchestrator.test.ts` | `inferred` → черга продовжується; `unknown` → break |

### Ручна перевірка

1. Питання з чіткими даними в профілі → бейдж «З профілю», розмова йде далі.
2. Питання про зону росту → бейдж «Висновок», **без паузи**, Arbiter дає NEXT_QUESTION.
3. Питання без даних → бейдж «Потрібна відповідь», стоп до відповіді людини.
4. Reload сторінки → бейджі зберігаються.
5. Завершення співбесіди → звіт містить caveat про `inferred` у `risks`.

---

## Критерії готовності

- [ ] Prisma міграція: `CandidateConfidence` enum + `candidateConfidence` на `LiveMessage`.
- [ ] Candidate Live промпт описує 3 рівні та JSON з `confidence`.
- [ ] `parseCandidateLiveReply` валідує confidence і обчислює `needsHuman`.
- [ ] Orchestrator зберігає confidence у БД і емітить у DTO.
- [ ] Arbiter WAIT лише після `unknown`, не після `inferred`.
- [ ] UI показує бейдж для HR і кандидата.
- [ ] Transcript і промпт звіту враховують мітки confidence.
- [ ] Юніт-тести зелені; `npm run build` проходить.

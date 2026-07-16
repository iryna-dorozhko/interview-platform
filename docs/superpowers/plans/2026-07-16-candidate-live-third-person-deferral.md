# Candidate Live Third-Person Deferral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Candidate Live Agent говорить про кандидата в третій особі; при прогалині в анкеті висуває припущення й просить підтвердити (`needsHuman`); при повній відсутності даних — природно просить відповісти; Arbiter після цього чекає людину.

**Architecture:** Лише оновлення system prompt і системних nudge. Оркестратор уже зупиняється на `needsHuman:true`; парсер `parsePostReply` без змін. Юніт-тести assert’ять ключові правила в тексті промптів.

**Tech Stack:** Node.js test runner (`node --import tsx --test`), TypeScript, існуючі `candidate-live-agent` / `arbiter-agent` модулі.

## Global Constraints

- Усі публічні повідомлення — українською.
- Без нових JSON-полів відповіді Candidate.
- Без змін оркестратора / `parsePostReply`.
- Prep-агент кандидата (анкета) не змінюємо.
- Приклади в промпті — ілюстративні; заборонено формулювати їх як єдиний дозволений шаблон для дослівного копіювання.
- Spec: `docs/superpowers/specs/2026-07-16-candidate-live-third-person-deferral-design.md`.

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/agents/prompts/candidate-live-agent.uk.ts` | System prompt: третя особа + три режими ANSWER |
| `backend/src/agents/candidate-live-agent.ts` | `ANSWER_NUDGE_UK`, `COMPANY_QUESTION_NUDGE_UK` |
| `backend/src/agents/candidate-live-agent.test.ts` | Assert правил у промпті / nudge |
| `backend/src/agents/prompts/arbiter-agent.uk.ts` | WAIT після assumption + confirm |
| `backend/src/agents/arbiter-agent.test.ts` | Assert WAIT-правила в промпті |

---

### Task 1: Candidate Live prompt — третя особа + три режими

**Files:**
- Modify: `backend/src/agents/prompts/candidate-live-agent.uk.ts`
- Modify: `backend/src/agents/candidate-live-agent.ts` (nudge constants)
- Modify: `backend/src/agents/candidate-live-agent.test.ts`

**Interfaces:**
- Consumes: існуючий `CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK`, `ANSWER_NUDGE_UK`, `COMPANY_QUESTION_NUDGE_UK`
- Produces: оновлений текст промпту/nudge (без зміни сигнатур функцій)

- [ ] **Step 1: Write failing prompt-contract tests**

Додай у `backend/src/agents/candidate-live-agent.test.ts`:

```ts
test("candidate live prompt requires third person and three ANSWER modes", () => {
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /трет(я|ій) особ/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /підтверд/i);
  assert.match(CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK, /needsHuman:\s*true/);
  assert.doesNotMatch(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /Відповідай від імені кандидата \(перша особа/,
  );
  assert.doesNotMatch(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /Я не знаю відповіді з профілю\. Ірино, дай відповідь сама\./,
  );
});

test("ANSWER nudge mentions third person and confirmation deferral", () => {
  assert.match(ANSWER_NUDGE_UK, /про кандидата|трет/i);
  assert.match(ANSWER_NUDGE_UK, /needsHuman:true/);
  assert.match(ANSWER_NUDGE_UK, /підтверд|доповн/i);
});
```

Переконайся, що `ANSWER_NUDGE_UK` і `CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK` уже імпортовані (або додай імпорти).

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: FAIL — немає «третя особа» / ще є стара фраза першої особи / відсутнє «підтверд».

- [ ] **Step 3: Replace `CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK`**

Повністю заміни вміст `backend/src/agents/prompts/candidate-live-agent.uk.ts` на:

```ts
export const CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK = `Ти — AI-представник кандидата на live-співбесіді. Говори ПРО кандидата в третій особі («Кандидат має досвід з Vue…»), ніколи не відповідай від першої особи («Я працював…», «Я вивчаю…»).

КРИТИЧНО: усі публічні повідомлення — ВИКЛЮЧНО українською мовою.

Тебе викликає оркестратор лише з явною командою Arbiter (див. службове повідомлення в кінці історії). Ти НЕ вирішуєш самостійно, чи мовчати — майже завжди публікуй одне повідомлення (post:true).

Команди:
- ANSWER — відповідай на відкрите питання HR або Company на основі профілю кандидата.
- CANDIDATE_QUESTIONS — постав одне питання компанії в інтересах кандидата (зарплата, умови, команда, формат роботи тощо), або коротко скажи, що зараз питань немає, якщо це недоречно.

Режими ANSWER (обери рівно один):
1) У профілі є чітка відповідь — post:true, needsHuman:false; коротко виклади факти з профілю про кандидата.
2) З профілю видно прогалину / зону росту / відсутність досвіду з теми — post:true, needsHuman:true; спочатку коротка відповідь-припущення для HR (висновок лише з профілю), потім природне прохання до живої людини підтвердити або доповнити (звертайся по імені, якщо воно є). Приклад стилю (не копіюй дослівно): «З анкети виходить, що кандидат ще не застосовував Pinia на практиці й зараз її вивчає. Ірино, підтвердь або доповни.»
3) У профілі немає нічого релевантного — post:true, needsHuman:true; без вигаданих фактів; коротко й природно попроси живу людину відповісти. Не використовуй шаблонну фразу на кшталт «Я не знаю відповіді з профілю…». Приклад стилю (не копіюй дослівно): «Ірино, у профілі немає деталей з цього питання — будь ласка, відповідай сама.»

НІКОЛИ не мовчи (не став post:false) у режимах 2 і 3.
ЗАБОРОНЕНО вигадувати досвід, навички, проєкти чи факти поза профілем. Припущення дозволені лише як висновок з профілю (включно з відсутністю згадки / зоною росту).
post:false лише як аварійний вихід (незрозуміла команда).

Формат відповіді — лише JSON, без markdown:
{ "post": false }
або
{ "post": true, "message": "Відповідь українською про кандидата..." }
або
{ "post": true, "needsHuman": true, "message": "Припущення або прохання відповісти українською..." }

Профіль кандидата:
{{CANDIDATE_PROFILE}}`;
```

- [ ] **Step 4: Update nudge constants in `candidate-live-agent.ts`**

Заміни:

```ts
export const COMPANY_QUESTION_NUDGE_UK =
  "[Система] Company Agent поставив питання. Відповідай про кандидата (третя особа) згідно з профілем.";

export const ANSWER_NUDGE_UK =
  "[Система] Команда Arbiter: ANSWER. Відповідай на відкрите питання про кандидата (третя особа) згідно з профілем. Якщо з профілю видно прогалину — post:true, needsHuman:true, висунь припущення і попроси підтвердити/доповнити. Якщо даних немає — post:true, needsHuman:true і природно попроси живу людину відповісти (не мовчи, не копіюй шаблон).";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: PASS (усі тести файлу).

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/prompts/candidate-live-agent.uk.ts \
  backend/src/agents/candidate-live-agent.ts \
  backend/src/agents/candidate-live-agent.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): candidate live answers in third person with profile assumptions

EOF
)"
```

---

### Task 2: Arbiter WAIT після assumption + confirm

**Files:**
- Modify: `backend/src/agents/prompts/arbiter-agent.uk.ts`
- Modify: `backend/src/agents/arbiter-agent.test.ts`

**Interfaces:**
- Consumes: `ARBITER_AGENT_SYSTEM_PROMPT_UK`
- Produces: оновлене правило черги WAIT (без зміни `parseArbiterCommand`)

- [ ] **Step 1: Write failing Arbiter prompt-contract test**

Додай у `backend/src/agents/arbiter-agent.test.ts` (поруч з існуючим тестом на наявність action):

```ts
test("arbiter prompt waits after candidate assumption or human deferral", () => {
  assert.match(ARBITER_AGENT_SYSTEM_PROMPT_UK, /підтверд|доповн/i);
  assert.match(
    ARBITER_AGENT_SYSTEM_PROMPT_UK,
    /просить живу людину відповісти|припущення/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && node --import tsx --test src/agents/arbiter-agent.test.ts
```

Expected: FAIL — у поточному правилі немає «підтверд» / «припущення».

- [ ] **Step 3: Update Arbiter queue rule**

У `backend/src/agents/prompts/arbiter-agent.uk.ts` заміни рядок:

```
- Якщо Candidate щойно написав, що в профілі немає відповіді / просить живу людину відповісти — WAIT (не повторюй ANSWER).
```

на:

```
- Якщо Candidate щойно попросив живу людину відповісти, або висунув припущення з проханням підтвердити/доповнити — WAIT (не повторюй ANSWER), поки не буде повідомлення від живої людини (HUMAN_CANDIDATE).
```

Інші рядки промпту не чіпай.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && node --import tsx --test src/agents/arbiter-agent.test.ts src/agents/candidate-live-agent.test.ts src/socket/orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/arbiter-agent.uk.ts \
  backend/src/agents/arbiter-agent.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): arbiter waits after candidate assumption confirm request

EOF
)"
```

---

### Task 3: Manual smoke (optional checklist, no commit required)

- [ ] **Step 1:** Перезапусти backend з тим самим `LLM_PROVIDER`.
- [ ] **Step 2:** Live-питання про технологію з прогалиною в анкеті (на кшталт Pinia) → очікуй третю особу + припущення + прохання підтвердити; conductor стоп.
- [ ] **Step 3:** Питання без слідів у профілі → природне прохання відповісти, без «Я не знаю відповіді з профілю…».
- [ ] **Step 4:** Питання з чіткими даними → третя особа, без `needsHuman`.

---

## Spec coverage self-review

| Spec requirement | Task |
|---|---|
| Третя особа / заборона першої | Task 1 |
| Режим: чітка відповідь | Task 1 (режим 1) |
| Режим: припущення + підтвердити | Task 1 (режим 2) + Task 2 |
| Режим: немає даних, природне прохання | Task 1 (режим 3) |
| Без дослівного старого шаблону | Task 1 tests `doesNotMatch` |
| Arbiter WAIT після assumption/confirm | Task 2 |
| Без змін оркестратора / parsePostReply | (немає task — навмисно) |
| Юніт-тести на ключові формулювання | Task 1–2 |
| Ручний smoke | Task 3 |

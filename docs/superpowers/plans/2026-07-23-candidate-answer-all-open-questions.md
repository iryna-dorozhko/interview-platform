# Candidate Answer All Open Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Після перебивання HR Candidate Live Agent відповідає на всі відкриті питання Company/HR одним повідомленням (короткий ack на вже покрите + повна відповідь на нове).

**Architecture:** Детермінована евристика `collectOpenInterviewerQuestions` (Company/HR після останньої відповіді кандидата) + ANSWER-nudge зі списком відкритих і інструкцією «на всі» + оновлення system prompt. Arbiter і orchestrator без змін.

**Tech Stack:** TypeScript, Node.js test runner (`node --import tsx --test`), існуючий `candidate-live-agent` модуль.

## Global Constraints

- Усі публічні повідомлення агента — українською.
- Без змін Arbiter / orchestrator / JSON-схеми відповіді Candidate.
- Без frontend.
- `confidence` — одне поле; без агрегації worst-case.
- Spec: `docs/superpowers/specs/2026-07-23-candidate-answer-all-open-questions-design.md`.

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/agents/candidate-live-agent.ts` | `collectOpenInterviewerQuestions`; open-block для ANSWER; historical block лишається для CANDIDATE_QUESTIONS |
| `backend/src/agents/prompts/candidate-live-agent.uk.ts` | Правила multi-open + partial ack |
| `backend/src/agents/candidate-live-agent.test.ts` | Unit-тести евристики, nudge, промпту |

---

### Task 1: `collectOpenInterviewerQuestions`

**Files:**
- Modify: `backend/src/agents/candidate-live-agent.ts`
- Modify: `backend/src/agents/candidate-live-agent.test.ts`

**Interfaces:**
- Consumes: `LiveHistoryItem`, `LiveAuthorType`, існуючий `INTERVIEWER_AUTHOR_TYPES`
- Produces: `collectOpenInterviewerQuestions(history: LiveHistoryItem[]): string[]`

- [ ] **Step 1: Write the failing tests**

Додай імпорт `collectOpenInterviewerQuestions` і тести в `candidate-live-agent.test.ts` (після існуючого тесту `collectRecentInterviewerQuestions`):

```ts
test("collectOpenInterviewerQuestions returns Company+HR after last candidate reply", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Старий питання про Node." },
    { authorType: "AGENT_CANDIDATE", content: "Кандидат має досвід з Node." },
    { authorType: "AGENT_COMPANY", content: "Як організовуєте інтеграцію з REST API?" },
    { authorType: "HUMAN_HR", content: "Над якими проектами ви працювали?" },
  ];

  assert.deepEqual(collectOpenInterviewerQuestions(history), [
    "Як організовуєте інтеграцію з REST API?",
    "Над якими проектами ви працювали?",
  ]);
});

test("collectOpenInterviewerQuestions ignores interviewer messages before last candidate reply", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Почнемо?" },
    { authorType: "AGENT_COMPANY", content: "Розкажіть про Vue." },
    { authorType: "HUMAN_CANDIDATE", content: "Працювала з Vue 3 роки." },
    { authorType: "AGENT_COMPANY", content: "А з Pinia?" },
  ];

  assert.deepEqual(collectOpenInterviewerQuestions(history), ["А з Pinia?"]);
});

test("collectOpenInterviewerQuestions returns all interviewer messages when candidate never spoke", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Перше питання." },
    { authorType: "HUMAN_HR", content: "Уточнення від HR." },
  ];

  assert.deepEqual(collectOpenInterviewerQuestions(history), [
    "Перше питання.",
    "Уточнення від HR.",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: FAIL — `collectOpenInterviewerQuestions` is not exported / not defined.

- [ ] **Step 3: Implement `collectOpenInterviewerQuestions`**

У `candidate-live-agent.ts` поряд з `collectRecentInterviewerQuestions` додай:

```ts
const CANDIDATE_AUTHOR_TYPES = new Set<LiveAuthorType>([
  "AGENT_CANDIDATE",
  "HUMAN_CANDIDATE",
]);

export function collectOpenInterviewerQuestions(history: LiveHistoryItem[]): string[] {
  let afterIndex = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (CANDIDATE_AUTHOR_TYPES.has(history[i]!.authorType)) {
      afterIndex = i;
      break;
    }
  }

  return history
    .slice(afterIndex + 1)
    .filter((item) => INTERVIEWER_AUTHOR_TYPES.has(item.authorType))
    .map((item) => item.content.trim())
    .filter(Boolean);
}
```

Залиш `collectRecentInterviewerQuestions` без змін (потрібен для CANDIDATE_QUESTIONS anti-repeat).

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: PASS для трьох нових тестів (решта без регресії).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/candidate-live-agent.ts backend/src/agents/candidate-live-agent.test.ts
git commit -m "feat(agents): collect open interviewer questions after last candidate reply"
```

---

### Task 2: ANSWER nudge — список відкритих + «на всі»

**Files:**
- Modify: `backend/src/agents/candidate-live-agent.ts`
- Modify: `backend/src/agents/candidate-live-agent.test.ts`

**Interfaces:**
- Consumes: `collectOpenInterviewerQuestions`, `collectRecentInterviewerQuestions`
- Produces: `formatOpenInterviewerQuestionsBlock(history: LiveHistoryItem[]): string`; `formatCandidateTurnNudge` для `ANSWER` використовує open-block; для `CANDIDATE_QUESTIONS` — historical block

- [ ] **Step 1: Write the failing tests**

Онови/додай тести:

```ts
test("ANSWER nudge lists only open questions and instructs answering all", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_COMPANY", content: "Старий питання про Node." },
    { authorType: "AGENT_CANDIDATE", content: "Кандидат має досвід з Node." },
    { authorType: "AGENT_COMPANY", content: "Як організовуєте інтеграцію з REST API?" },
    { authorType: "HUMAN_HR", content: "Над якими проектами ви працювали?" },
  ];

  const nudge = formatCandidateTurnNudge({ action: "ANSWER", briefUk: "REST і проєкти" }, history);

  assert.match(nudge, /Відкриті питання/i);
  assert.match(nudge, /на всі|в одному повідомленні/i);
  assert.match(nudge, /REST API/);
  assert.match(nudge, /проектами/);
  assert.doesNotMatch(nudge, /Старий питання про Node/);
});

test("buildCandidateLiveMessages ANSWER nudge uses open questions after interrupt", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "AGENT_CANDIDATE", content: "Кандидат уже відповів раніше." },
    { authorType: "AGENT_COMPANY", content: "Розкажіть про досвід з Node.js." },
    { authorType: "HUMAN_HR", content: "Як ви підходите до code review?" },
  ];

  const messages = buildCandidateLiveMessages({
    candidateProfile,
    history,
    turnContext: { action: "ANSWER", briefUk: "Node і review" },
  });

  const nudge = messages.at(-1)!.content;
  assert.match(nudge, /Розкажіть про досвід з Node\.js\./);
  assert.match(nudge, /code review/);
  assert.match(nudge, /на всі|в одному повідомленні/i);
});
```

Існуючий тест `buildCandidateLiveMessages lists Company questions in ANSWER nudge` лиши валідним (немає prior candidate → open = усі Company/HR у історії), але онови assert заголовка блоку з `/не дублюй|не повторюй|не перефраз/i` на також `/Відкриті питання|на всі|в одному повідомленні/i` (або додай другий match).

Існуючий тест `buildCandidateLiveMessages lists Company questions in CANDIDATE_QUESTIONS nudge` **не змінюй за змістом** — historical list має лишитись (включно з уже відповіденим Docker-питанням).

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: FAIL на нових assert’ах про «Відкриті питання» / відсутність старого питання.

- [ ] **Step 3: Implement open-block і розвести ANSWER vs CANDIDATE_QUESTIONS**

У `candidate-live-agent.ts` заміни/доповни форматери:

```ts
export function formatInterviewerQuestionsBlock(history: LiveHistoryItem[]): string {
  const questions = collectRecentInterviewerQuestions(history);
  if (questions.length === 0) {
    return "";
  }

  const lines = questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
  return `\n\nПитання Company/HR у чаті (не дублюй і не перефразовуй):\n${lines}`;
}

export function formatOpenInterviewerQuestionsBlock(history: LiveHistoryItem[]): string {
  const questions = collectOpenInterviewerQuestions(history);
  if (questions.length === 0) {
    return "";
  }

  const lines = questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
  return `\n\nВідкриті питання (відповідай на всі в одному повідомленні, хронологічно):\n${lines}`;
}

export function formatCandidateTurnNudge(
  turnContext: LiveAgentTurnContext,
  history: LiveHistoryItem[] = [],
): string {
  const brief = turnContext.briefUk?.trim();
  const briefPart = brief ? ` Підказка Arbiter: ${brief}` : "";

  if (turnContext.action === "CANDIDATE_QUESTIONS") {
    return `${CANDIDATE_QUESTIONS_NUDGE_UK}${briefPart}${formatInterviewerQuestionsBlock(history)}`;
  }

  return `${ANSWER_NUDGE_UK}${briefPart}${formatOpenInterviewerQuestionsBlock(history)}`;
}
```

У fallback без `turnContext` (коли last = `AGENT_COMPANY`) також використовуй open-block:

```ts
content: `${COMPANY_QUESTION_NUDGE_UK}${formatOpenInterviewerQuestionsBlock(input.history)}`,
```

Опційно підсили `ANSWER_NUDGE_UK` одним реченням (без зміни JSON-контракту):

```ts
export const ANSWER_NUDGE_UK =
  "[Система] Команда Arbiter: ANSWER. Відповідай про кандидата (третя особа) згідно з профілем. Якщо відкритих питань кілька — покрий усі в одному повідомленні (хронологічно). Обов'язково вкажи confidence: confirmed (факт з профілю), inferred (висновок/часткові дані), unknown (немає даних — попроси живу людину). Не перефразовуй питання — лише відповідь. Не дублюй уже сказане в чаті.";
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: PASS (усі тести файлу).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/candidate-live-agent.ts backend/src/agents/candidate-live-agent.test.ts
git commit -m "feat(agents): ANSWER nudge lists all open interviewer questions"
```

---

### Task 3: System prompt — multi-open + partial ack

**Files:**
- Modify: `backend/src/agents/prompts/candidate-live-agent.uk.ts`
- Modify: `backend/src/agents/candidate-live-agent.test.ts`

**Interfaces:**
- Consumes: існуючий `CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK`
- Produces: оновлені правила в промпті (без зміни JSON-схеми)

- [ ] **Step 1: Write the failing prompt asserts**

```ts
test("candidate live prompt answers all open interviewer questions in one message", () => {
  assert.match(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /відкрит.*(питан|пункт).*одн(ому|им) повідомлен|кілька відкритих|усі відкриті/i,
  );
  assert.match(
    CANDIDATE_LIVE_AGENT_SYSTEM_PROMPT_UK,
    /коротк.*(підтверд|речен).*лише.*(пункт|питан)|вже.*(прозвучал|вище).*не замість/i,
  );
});
```

(Якщо regex занадто крихкий — після написання промпту піджени assert під фактичні ключові фрази з Step 3, але зміст має лишитись: multi-open + partial ack.)

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: FAIL на новому prompt-тесті.

- [ ] **Step 3: Update system prompt**

У `candidate-live-agent.uk.ts` у блоці «Правила без повторів» заміни/уточни рядки про «поточне питання» і «вже прозвучала» на щось еквівалентне:

```text
- У режимі ANSWER: НІКОЛИ не перефразовуй, не цитуй і не повторюй питання AGENT_COMPANY або HUMAN_HR — лише відповідай з профілю кандидата.
- Якщо відкритих питань від Company/HR кілька (після твоєї або живої відповіді кандидата з’явилось більше одного) — відповідай на ВСІ в одному повідомленні, у хронологічному порядку.
- На кожне відкрите питання: додай нові деталі з профілю або коротко підтверд («Так, як зазначалось…») лише те, чого ще не було в чаті.
- Якщо відповідь на конкретне відкрите питання вже повністю прозвучала в чаті — для цього пункту одне коротке речення без деталей (напр. «Кандидат уже розповів про це вище»); це НЕ скасовує відповідь на інші відкриті питання в тому ж повідомленні.
```

Не змінюй формат JSON і режими confidence.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: PASS. Піджени regex у Step 1, якщо формулювання трохи інші, але покрий обидва сенси.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/candidate-live-agent.uk.ts backend/src/agents/candidate-live-agent.test.ts
git commit -m "fix(agents): candidate live answers all open questions in one message"
```

---

### Task 4: Фінальна перевірка

**Files:**
- Verify only (no new production code expected)

- [ ] **Step 1: Re-run candidate-live tests**

```bash
cd backend && node --import tsx --test src/agents/candidate-live-agent.test.ts
```

Expected: PASS.

- [ ] **Step 2: Manual smoke (якщо є live-кімната)**

1. Company питає про REST.
2. HR перебиває питанням про проєкти (тема вже була вище).
3. Candidate одним повідомленням: коротке ack про проєкти + відповідь про REST.

Якщо live недоступний — зафіксуй у PR/звіті, що ручний крок лишився на перевірку після деплою локально.

- [ ] **Step 3: Commit лише якщо були дрібні правки після smoke; інакше skip**

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `collectOpenInterviewerQuestions` після останнього кандидата | Task 1 |
| Не включати старі питання до відповіді | Task 1 |
| ANSWER-nudge зі списком відкритих + «на всі» | Task 2 |
| CANDIDATE_QUESTIONS лишає historical anti-repeat | Task 2 |
| Промпт multi-open + partial ack | Task 3 |
| Без змін arbiter/orchestrator/JSON | Global Constraints |
| Авто-тести з тест-плану spec | Tasks 1–3 |
| Ручний сценарій перебивання | Task 4 |

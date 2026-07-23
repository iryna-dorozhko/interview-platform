# Company Agent Neutral Seniority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оновити Company Agent system prompt так, щоб перше питання було лише про роль, а досвід/грейд/відповідальність уточнювались нейтрально і лише за потреби — без нав’язування junior/middle/senior.

**Architecture:** Підхід A зі spec — лише текст `COMPANY_AGENT_SYSTEM_PROMPT_UK` і unit-тести на вміст промпту. Без змін схеми профілю, extraction, UI чи hardcoded opening.

**Tech Stack:** TypeScript, Node.js `node:test` + `node:assert/strict`, tsx.

## Global Constraints

- Повідомлення агента для HR — виключно українською (існуюче правило промпту).
- Не змінювати теми 2–4, формат `READY:true|false`, extraction/schema, UI, API.
- У промпті можна згадати `junior/middle/senior` лише як заборону нав’язування, не як обов’язковий елемент теми «Посада».
- Spec: `docs/superpowers/specs/2026-07-23-company-agent-neutral-seniority-design.md`.

---

## File map

| File | Role |
|------|------|
| `backend/src/agents/prompts/company-agent.uk.ts` | System prompt Company Agent (єдине місце поведінки діалогу) |
| `backend/src/agents/company-agent.test.ts` | Assert на правила промпту |

---

### Task 1: Prompt rules + tests

**Files:**
- Modify: `backend/src/agents/company-agent.test.ts` (після існуючого тесту `company agent system prompt includes work conditions block with seven subtopics`, ~рядки 49–59)
- Modify: `backend/src/agents/prompts/company-agent.uk.ts` (рядки 6–7 і 21–27)

**Interfaces:**
- Consumes: `COMPANY_AGENT_SYSTEM_PROMPT_UK` (експорт без зміни сигнатури)
- Produces: оновлений текст промпту; нові assert-и в тестах

- [ ] **Step 1: Write the failing test**

Додай у `backend/src/agents/company-agent.test.ts` одразу після тесту `company agent system prompt includes work conditions block with seven subtopics`:

```ts
test("company agent system prompt asks role first and seniority only neutrally if missing", () => {
  assert.doesNotMatch(
    COMPANY_AGENT_SYSTEM_PROMPT_UK,
    /Посада \(роль, рівень — junior\/middle\/senior, команда\)/,
  );
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /перше питання лише про (назву )?посади|назву посади\/роль|лише про назву посади/i);
  assert.match(
    COMPANY_AGENT_SYSTEM_PROMPT_UK,
    /досвід|грейд|рівень відповідальності/i,
  );
  assert.match(
    COMPANY_AGENT_SYSTEM_PROMPT_UK,
    /не нав.?язуй|не починай.*junior|junior\/middle\/senior/i,
  );
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /якщо HR (сам )?не (згадав|вказав)|лише якщо.*не (згадав|вказав)/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && node --import tsx --test src/agents/company-agent.test.ts
```

Expected: FAIL — новий тест не проходить (`doesNotMatch` або `match` на перше питання / нейтральне уточнення), існуючі тести лишаються зелені.

- [ ] **Step 3: Update the system prompt**

У `backend/src/agents/prompts/company-agent.uk.ts` заміни рядок теми 1:

Було:
```
1. Посада (роль, рівень — junior/middle/senior, команда).
```

Стало:
```
1. Посада:
   a) Назва ролі / посади.
   b) За потреби — досвід, грейд або рівень відповідальності (нейтрально; лише якщо HR сам цього не згадав). Не нав’язуй IT-грейди junior/middle/senior, якщо HR їх не використав.
   c) Команда / контекст команди.
```

Заміни правило про порожню історію (рядок з «привітайся і одразу постав перше питання про посаду») на:

```
- Якщо HR ще нічого не написав (порожнє повідомлення на початку розмови), привітайся і одразу постав перше питання лише про назву посади/роль (не питай одразу про рівень, грейд чи junior/middle/senior).
- Після відповіді про роль: якщо бракує інформації про досвід/грейд/рівень відповідальності — одне нейтральне уточнення; потім запитай про команду, якщо її ще не зібрано. Не починай діалог із питання про junior/middle/senior.
```

Решту промпту (мови, теми 2–4, READY) не змінюй.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && node --import tsx --test src/agents/company-agent.test.ts
```

Expected: PASS — усі тести файлу, включно з новим.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/company-agent.uk.ts backend/src/agents/company-agent.test.ts docs/superpowers/specs/2026-07-23-company-agent-neutral-seniority-design.md docs/superpowers/plans/2026-07-23-company-agent-neutral-seniority.md
git commit -m "$(cat <<'EOF'
fix(agents): ask vacancy role first, seniority only if needed

Stop prompting HR with IT junior/middle/senior grades up front so non-IT vacancies stay natural.
EOF
)"
```

(Коміть лише якщо користувач явно попросив створити коміт; інакше зупинись після зелених тестів і запропонуй коміт.)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Перше питання = лише роль | Task 1 (prompt + test) |
| Не нав’язувати junior/middle/senior | Task 1 |
| Нейтральне уточнення лише якщо бракує | Task 1 |
| Команда наступним кроком | Task 1 |
| Поза scope: B/C, UI, extraction | не чіпаємо |

Placeholder scan: немає TBD/TODO. Type consistency: N/A (лише string prompt).

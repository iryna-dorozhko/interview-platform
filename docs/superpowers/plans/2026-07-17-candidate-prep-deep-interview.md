# Candidate Prep Deep Interview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити prep-чат Candidate Agent глибшим — follow-up доки відповідь конкретна, окремий блок умов роботи, збагачений `goals` у профілі.

**Architecture:** Prompt-only зміни в двох system prompt-файлах; без змін Prisma, API-роутів і frontend. Unit-тести фіксують наявність нових правил у промптах. Ручний сценарій оновлюється в `manual-test-dialogues.uk.md`.

**Tech Stack:** TypeScript, Node.js, node:test

## Global Constraints

- Усі тексти для користувача та промпти агентів — українською.
- Схема `CandidateProfile` не змінюється; умови роботи зберігаються в `goals` з префіксами.
- Контекст вакансії в prep-чат не додається.
- Contact bootstrap (ім'я, email, телефон) — без змін.
- Серверна перевірка `READY` (підхід B) — out of scope.
- Live Candidate Agent prompt не змінюється.

---

## File Structure

- **Modify**
  - `backend/src/agents/prompts/candidate-agent.uk.ts` — 5 тем, deep follow-up, умови роботи, READY gate
  - `backend/src/agents/prompts/candidate-profile-extraction.uk.ts` — `goals` з префіксами
  - `backend/src/agents/candidate-agent.test.ts` — тести промптів
  - `docs/manual-test-dialogues.uk.md` — ручні відповіді для нового flow

---

### Task 1: Candidate Agent System Prompt

**Files:**
- Modify: `backend/src/agents/prompts/candidate-agent.uk.ts`
- Test: `backend/src/agents/candidate-agent.test.ts`

**Interfaces:**
- Consumes: `CANDIDATE_AGENT_SYSTEM_PROMPT_UK` (експортована константа)
- Produces: оновлений `CANDIDATE_AGENT_SYSTEM_PROMPT_UK`, який використовує `buildCandidateAgentMessages()` без змін сигнатури

- [ ] **Step 1: Write the failing tests**

Додати в `backend/src/agents/candidate-agent.test.ts` після існуючого тесту `candidate system prompt mentions experience...`:

```ts
test("candidate system prompt includes work conditions and deep follow-up rules", () => {
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /умови роботи/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /формат/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /зарплат/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /графік/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /релокац/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /доки відповідь не стане конкретною/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /обов'язково заглиб/i);
});

test("candidate system prompt READY gate requires all five profile topics", () => {
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /умови роботи/i);
  assert.match(CANDIDATE_AGENT_SYSTEM_PROMPT_UK, /кар'єрні цілі/i);
  assert.doesNotMatch(
    CANDIDATE_AGENT_SYSTEM_PROMPT_UK,
    /одне коротке уточнювальне питання/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/agents/candidate-agent.test.ts`

Expected: FAIL — промпт ще містить «одне коротке уточнювальне питання» і не містить «умови роботи».

- [ ] **Step 3: Replace candidate agent system prompt**

Повністю замінити вміст `backend/src/agents/prompts/candidate-agent.uk.ts`:

```ts
export const CANDIDATE_AGENT_SYSTEM_PROMPT_UK = `Ти — AI-асистент кандидата, який проводить структуроване інтерв'ю, щоб зібрати профіль перед співбесідою.

КРИТИЧНО: усі повідомлення для кандидата — ВИКЛЮЧНО українською мовою. Заборонено китайську, англійську, російську, ієрогліфи та будь-яку іншу мову.

Спочатку проведи короткий блок знайомства (контактні дані), потім перейди до збору профілю за п'ятьма темами:
1. Досвід (попередні ролі, роки, ключові проєкти, технології, масштаб).
2. Сильні сторони (конкретні навички та досягнення з прикладами).
3. Зони росту (слабкі сторони — конструктивно, без токсичної самокритики).
4. Умови роботи (формат, зарплатні очікування, графік, готовність до релокації).
5. Кар'єрні цілі (напрямок розвитку, тип продукту/команди, горизонт).

Правила блоку знайомства (виконуй по черзі, одне питання за раз):
- Представся коротко як AI-асистент, який допоможе зібрати профіль перед співбесідою.
- Запитай ім'я та прізвище кандидата.
- Запитай email як додатковий спосіб зв'язку; запропонуй залишити email, вказаний під час реєстрації в системі.
- Якщо кандидат не дає email, постав одне коротке уточнення; якщо далі відмовляється — переходь далі (бекенд підставить email з акаунта).
- Запитай номер телефону.
- Якщо кандидат не дає телефон, постав повторний запит з поясненням, для чого потрібен номер (зв'язок HR щодо співбесіди); якщо повторна відмова — не блокуй анкету і переходь до тем профілю без номера.

Правила ведення діалогу:
- Став рівно одне запитання за раз, українською мовою.
- Не показуй кандидату весь список тем одразу — веди природну розмову.
- Якщо відповідь кандидата загальна або розпливчаста («працював з базами даних», «хочу розвиватися») — став уточнюючі питання доки відповідь не стане конкретною: роки, назви технологій, цифри, приклади, терміни, масштаб.
- Якщо кандидат згадав щось конкретне (компанію, технологію, проєкт, метрику, роль) — обов'язково заглибся: масштаб, роль, результат, контекст. Приклади стилю (не копіюй дослівно):
  • «FinTech» → який продукт, який стек, яка роль;
  • «Оптимізував БД» → які запити, який був/став час відповіді;
  • «Remote» → повністю чи гібрид, скільки днів в офісі;
  • «Вів команду» → скільки людей, які обов'язки.
- Кількість уточнюючих раундів на тему не обмежена, але завжди одне питання за раз.
- Ніколи не вигадуй факти за кандидата і не роби припущень замість нього.
- Якщо кандидат ще нічого не написав (порожнє повідомлення на початку розмови), привітайся, представся і почни блок знайомства з питання про ім'я.
- Після того як дізнався ім'я кандидата, можеш звертатися до нього по імені (лише ім'я, без прізвища) — але ВИБІРКОВО, не в кожному повідомленні.
- Доречно звернутися по імені: одразу після отримання імені, при переході до нової теми, подяку за розгорнуту відповідь, або коли підбадьорюєш кандидата.
- Не звертайся по імені в двох повідомленнях підряд і не вставляй ім'я в кожне питання — це має звучати природно, а не шаблонно.
- Якщо ім'я ще невідоме, не звертайся по імені.
- Якщо кандидат питає про наступні кроки (наприклад: «що робити далі?»), чітко поясни:
  1) потрібно отримати код від HR;
  2) приєднатися за цим кодом і перейти до спільної live-співбесіди з HR;
  3) у цій співбесіді AI-агент представляє інтереси кандидата й відповідає на запитання на основі підтвердженого профілю;
  4) після завершення співбесіди HR окремо повідомить результати.

Блок «Умови роботи» (тема 4) — чотири підтеми по черзі, одне питання за раз:
- Формат: офіс / гібрид / remote. Якщо гібрид або remote — уточни деталі (наприклад, скільки днів в офісі).
- Зарплата: діапазон або мінімум із валютою. Якщо кандидат назвав суму — можеш уточнити gross чи net.
- Графік: повний день / part-time / гнучкий графік; за потреби — обмеження по годинах.
- Релокація: готовність переїхати або лише поточне місто; за потреби — які міста/країни розглядає.
Якщо кандидат відмовляється відповідати на підтему (типово для зарплати) — один раз коротко поясни, навіщо це потрібно для співбесіди; при повторній відмові не блокуй і переходь до наступної підтеми.

Блок «Кар'єрні цілі» (тема 5) — окремо від умов роботи; ті самі правила глибоких follow-up.

Формат відповіді (дотримуйся точно щоразу):
1. Текст твого повідомлення чи запитання для кандидата.
2. Останній рядок — рівно один з двох варіантів, без дужок, крапок чи будь-яких інших символів навколо: READY:true або READY:false.

Ставай READY:true лише тоді, коли одночасно виконано:
- зібрано ім'я кандидата (fullName);
- є доступний email (наданий кандидатом або буде підставлений з акаунта після відмови);
- відбулося щонайменше 3 змістовні обміни повідомленнями з кандидатом після блоку знайомства;
- по темі «Досвід» зібрано конкретику (ролі, роки, проєкти/технології), а не загальні фрази;
- по темі «Сильні сторони» — конкретні навички з прикладами або результатами;
- по темі «Зони росту» — хоча б одна конкретна зона;
- по темі «Умови роботи» — усі чотири підтеми: конкретна відповідь або явна відмова після уточнення;
- по темі «Кар'єрні цілі» — конкретика, а не «хочу розвиватися».

Відсутній телефон після повторного запиту з поясненням не блокує READY:true.

У всіх інших випадках завжди пиши READY:false.`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/agents/candidate-agent.test.ts`

Expected: PASS (усі тести, включно з новими).

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/candidate-agent.uk.ts backend/src/agents/candidate-agent.test.ts
git commit -m "feat(agents): deepen candidate prep interview with work conditions"
```

---

### Task 2: Profile Extraction Prompt

**Files:**
- Modify: `backend/src/agents/prompts/candidate-profile-extraction.uk.ts`
- Test: `backend/src/agents/candidate-agent.test.ts`

**Interfaces:**
- Consumes: `CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK`
- Produces: оновлений extraction prompt; `parseCandidateProfileExtraction()` лишається без змін (приймає `goals: string[]`)

- [ ] **Step 1: Write the failing test**

Додати імпорт і тест у `backend/src/agents/candidate-agent.test.ts`:

```ts
import { CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK } from "./prompts/candidate-profile-extraction.uk";

test("extraction prompt encodes work conditions in goals with prefixes", () => {
  assert.match(CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /Формат:/);
  assert.match(CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /Зарплата:/);
  assert.match(CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /Графік:/);
  assert.match(CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /Релокація:/);
  assert.match(CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK, /Ціль:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- src/agents/candidate-agent.test.ts`

Expected: FAIL — extraction prompt не містить префіксів.

- [ ] **Step 3: Update extraction system prompt**

Повністю замінити вміст `backend/src/agents/prompts/candidate-profile-extraction.uk.ts`:

```ts
export const CANDIDATE_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK = `Ти отримуєш повну стенограму діалогу між кандидатом і AI-агентом, який збирав інформацію для профілю перед співбесідою.

Твоє завдання — проаналізувати діалог і повернути СТРОГО валідний JSON без жодного тексту навколо (без пояснень, без markdown, без код-блоків) у такому форматі:

{"fullName": "Ім'я Прізвище", "email": "candidate@example.com", "phone": "+380...", "experience": ["пункт 1", "пункт 2"], "skills": {"strong": ["навичка 1"], "growth": ["зона росту 1"]}, "goals": ["Формат: повністю remote", "Зарплата: від 4000 USD gross", "Графік: повний день", "Релокація: не розглядає", "Ціль: перейти на senior у продуктовій команді"], "summary": "короткий опис у 1-3 речення"}

Правила:
- "fullName" — ім'я та прізвище кандидата з діалогу; обов'язкове непорожнє значення.
- "email" — email кандидата з діалогу; якщо кандидат не назвав явно, поверни порожній рядок "" (бекенд підставить email з акаунта).
- "phone" — номер телефону з діалогу; якщо кандидат відмовився після повторного запиту, поверни null.
- "experience" — масив коротких рядків про досвід роботи, ролі, проєкти, технології, масштаб (включно з деталями з follow-up).
- "skills.strong" — сильні сторони та конкретні навички з діалогу.
- "skills.growth" — зони росту / слабкі сторони (конструктивно).
- "goals" — масив, що містить І умови роботи, І кар'єрні цілі. Кожен рядок з префіксом:
  • "Формат: ..." — офіс / гібрид / remote та деталі;
  • "Зарплата: ..." — очікування або "не вказано" при відмові;
  • "Графік: ..." — повний день / part-time / гнучкий тощо;
  • "Релокація: ..." — готовність або "не вказано" при відмові;
  • "Ціль: ..." — одна або кілька кар'єрних цілей (окремий рядок на кожну суттєву ціль).
  Якщо про підтему умов роботи в діалозі не було сказано нічого — "Формат: не вказано" (аналогічно для інших підтем).
- "summary" — один абзац українською (1-3 речення), узагальнює профіль кандидата.
- Якщо про тему в діалозі не було сказано нічого конкретного, для experience/skills масивів поверни ["не вказано"]; для goals — чотири рядки умов з "не вказано" і "Ціль: не вказано", якщо кар'єрні цілі не обговорювались.
- Не вигадуй фактів, яких немає в діалозі.
- Відповідь має містити лише JSON, без жодних інших символів до чи після нього.`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- src/agents/candidate-agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/candidate-profile-extraction.uk.ts backend/src/agents/candidate-agent.test.ts
git commit -m "feat(agents): extract work conditions into candidate goals with prefixes"
```

---

### Task 3: Manual Test Dialogues + Build Verification

**Files:**
- Modify: `docs/manual-test-dialogues.uk.md`

**Interfaces:**
- Consumes: оновлені промпти з Task 1–2
- Produces: оновлений ручний сценарій для QA

- [ ] **Step 1: Update candidate prep section intro**

У `docs/manual-test-dialogues.uk.md`, секція «2. Кандидат — анкета», замінити рядок 65:

Було:
```
На початку чату Candidate Agent представляється і збирає контакти **до** тем профілю (досвід, навички, цілі):
```

Стало:
```
На початку чату Candidate Agent представляється і збирає контакти **до** тем профілю (досвід, навички, зони росту, умови роботи, кар'єрні цілі):
```

- [ ] **Step 2: Insert work conditions responses and renumber goals**

Після **Відповідь 6 — зони росту** (існуючий текст залишити) вставити нові блоки і перенумерувати:

```markdown
**Відповідь 7 — формат роботи**

```
Повністю remote. Готовий іноді приїжджати в офіс на командні зустрічі раз на місяць.
```

**Відповідь 8 — зарплата**

```
Очікую від 4500 USD gross на місяць.
```

**Відповідь 9 — графік**

```
Повний робочий день, гнучкий старт між 9:00 і 11:00.
```

**Відповідь 10 — релокація**

```
Не розглядаю релокацію, працюю з Києва.
```

**Відповідь 11 — кар'єрні цілі**

```
Хочу перейти на рівень senior у продуктовій команді, де видно вплив на бізнес. Шукаю стабільну команду з менторством і можливістю розвивати архітектурні навички.
```

**Відповідь 12 — якщо агент просить уточнення по досвіду (опційно)**

```
Останній проєкт — інтеграція з трьома платіжними провайдерами. Відповідав за API-шар і міграції БД. Команда була з чотирьох backend-розробників. Обсяг — до 50 тис. транзакцій на день.
```
```

Видалити старі **Відповідь 7 — цілі** і **Відповідь 8 — якщо агент просить уточнення** (замінені новими блоками).

- [ ] **Step 3: Update expected result**

У блоці «Очікуваний результат» додати:

```markdown
- Поле `goals` містить рядки з префіксами: `Формат:`, `Зарплата:`, `Графік:`, `Релокація:`, `Ціль:`.
- Агент може поставити додаткові follow-up питання по досвіду перед переходом до наступної теми.
```

- [ ] **Step 4: Run full backend test suite and build**

Run:
```bash
cd backend && npm test
cd .. && npm run build
```

Expected: усі тести PASS; build без помилок.

- [ ] **Step 5: Commit**

```bash
git add docs/manual-test-dialogues.uk.md
git commit -m "docs: update manual test dialogues for deep candidate prep"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Deep follow-up until concrete | Task 1 |
| Work conditions block (4 subtopics) | Task 1 |
| Goals field with prefixes | Task 2 |
| READY gate all 5 topics + refusal handling | Task 1 |
| No DB/UI/live agent changes | Global Constraints |
| Unit tests updated | Task 1, Task 2 |
| manual-test-dialogues updated | Task 3 |
| npm run build passes | Task 3 Step 4 |

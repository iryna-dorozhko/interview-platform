# Expand Vacancy Offer Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand offer-related questions in the vacancy-filling flow by enhancing `COMPANY_AGENT_SYSTEM_PROMPT_UK` (Company Agent) so collected `compensation.displayText` and `workConditions` are more specific.

**Architecture:** Prompt-only change in `backend/src/agents/prompts/company-agent.uk.ts` plus unit-test assertions in `backend/src/agents/company-agent.test.ts`. No changes to extraction JSON schema (`VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK`) or decision-letter logic.

**Tech Stack:** TypeScript, Node test runner (`node:test` / `tsx --test`)

## Global Constraints

- Keep all prompt messages in Ukrainian
- Do not change the READY:true/false marker format and READY gate logic
- Do not change `VACANCY_PROFILE_EXTRACTION_SYSTEM_PROMPT_UK` JSON schema (6 `workConditions` prefixes + `compensation.displayText`)
- Only edit files listed in tasks

---

### Task 1: Expand offer guidance in Company Agent prompt

**Files:**
- Modify: `backend/src/agents/prompts/company-agent.uk.ts`
- Modify: `backend/src/agents/company-agent.test.ts`
- Test: `backend/src/agents/company-agent.test.ts`

**Interfaces:**
- Consumes: `COMPANY_AGENT_SYSTEM_PROMPT_UK` string export
- Produces: updated `COMPANY_AGENT_SYSTEM_PROMPT_UK` with expanded offer/compensation follow-up guidance

- [ ] **Step 1: Write the failing test**

Add new assertions to the existing test `company agent system prompt includes work conditions block with seven subtopics` to require the new offer-detail anchors:

Update `backend/src/agents/company-agent.test.ts` inside the test block:

```ts
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /бонус/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /equity/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /сертиф/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /житл/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /перельот/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /OS/i);
  assert.match(COMPANY_AGENT_SYSTEM_PROMPT_UK, /монітор/i);
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`cd /Users/iruna/interview-platform-1/backend && npx tsx --test src/agents/company-agent.test.ts`

Expected: FAIL (because the prompt does not yet contain these new anchors).

- [ ] **Step 3: Implement minimal prompt changes**

Replace the full content of `COMPANY_AGENT_SYSTEM_PROMPT_UK` in `backend/src/agents/prompts/company-agent.uk.ts` with the following updated version (note: READY contract stays unchanged; only offer guidance is expanded):

```ts
export const COMPANY_AGENT_SYSTEM_PROMPT_UK = `Ти — досвідчений HR-консультант, який допомагає описати вакансію так, щоб знайти найкращого кандидата. Твоя мета — через невимушену розмову з HR-менеджером зібрати повний профіль вакансії.

Мова: усі повідомлення — виключно українською. Технічні терміни (назви технологій, ролей) можуть бути англійською.

Стиль спілкування:
- Говори коротко, як у месенджері: 2-4 речення на повідомлення.
- Перед наступним питанням коротко відреагуй на сказане — не переходь одразу до нового питання.
- Звертайся на «ви» (HR — діловий контекст). Тон — професійний, але без канцеляриту.
- Став рівно одне питання за раз.
- Не вигадуй факти за HR і не роби припущень.

Початок розмови:
- Якщо HR ще нічого не написав — привітайся, коротко поясни мету розмови і постав перше питання лише про назву посади/роль.
- Не питай одразу про грейд чи junior/middle/senior — дай HR описати роль природно.
- Після відповіді про роль: якщо бракує контексту про досвід/рівень — одне нейтральне уточнення; потім команда, якщо ще не зібрано.

Теми для покриття (порядок гнучкий — підлаштовуйся під контекст розмови):
- Посада: назва ролі, досвід/грейд/рівень (нейтрально, лише якщо HR сам не згадав), команда/контекст.
- Вимоги — двома кроками: критичні (без них кандидат не підходить) та бажані (підсилюють fit). Не підвищуй і не знижуй пріоритет самостійно.
- Очікування від кандидата в перші місяці роботи.
- Умови роботи: зарплата (діапазон або мінімум, валюта, gross/net; що саме входить у compensation: base + бонуси/надбавки, equity за наявності), формат (офіс/hybrid/remote; скільки днів відвідування/remote очікується), графік (часові зони, core hours), бенефіти (PTO/відпустки, страхування: health/dental на високому рівні, навчання/сертифікації), релокація (візова підтримка, пакет: житло, перельоти, допомога на старт), випробувальний період (тривалість і як оцінюють), обладнання (ноутбук: OS, монітори/периферія, політика/бюджет).

Навігація по темах:
- Не оголошуй список тем і не кажи «тепер перейдемо до...» — переходь органічно.
- Якщо HR сам згадав тему з іншого блоку — підхопи й розкрий її зараз.
- Підтеми умов роботи теж не обов'язково послідовно — збирай по ходу розмови.

Глибина:
- Якщо відповідь розпливчаста — одне коротке уточнення перед переходом далі.
- Не нав'язуй IT-грейди junior/middle/senior, якщо HR їх не використав.

Формат відповіді (дотримуйся щоразу):
1. Текст повідомлення для HR.
2. Останній рядок — рівно один із двох варіантів: READY:true або READY:false

READY:true лише коли одночасно:
- щонайменше 3 змістовні обміни з HR;
- по всіх чотирьох темах (посада, вимоги, очікування, умови) зібрано конкретику;
- по вимогах є конкретні критичні та/або бажані пункти (або явна відповідь «критичних немає» + непорожній desired, або навпаки);
- по всіх семи підтемах умов роботи — конкретна відповідь або явне «не вказано».

В усіх інших випадках — READY:false.`;
```

Пояснення для інженера:
- Вставлені лише “offer-detail anchors” (bonus/equity/сертифікації/житло/перельоти/OS/монітори) та розширення списку прикладів у блоці умов.
- Контракт READY і структура prompt не змінюються.

- [ ] **Step 4: Run test to verify it passes**

Run:
`cd /Users/iruna/interview-platform-1/backend && npx tsx --test src/agents/company-agent.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/prompts/company-agent.uk.ts backend/src/agents/company-agent.test.ts
git commit -m "feat(prep): expand vacancy offer questions in Company Agent prompt"
```


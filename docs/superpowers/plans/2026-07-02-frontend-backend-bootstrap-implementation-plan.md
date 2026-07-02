# Frontend/Backend Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Створити мінімальний `npm workspaces`-скелет із пакетами `frontend` і `backend`, який запускається через єдині кореневі команди.

**Architecture:** Кореневий `package.json` виступає оркестратором воркспейсів і агрегує скрипти `dev/build/lint`. Кожен пакет (`frontend`, `backend`) має власний мінімальний `package.json` і локальний `README.md` для ізольованої еволюції в наступних днях. Верифікація виконується через кореневі команди, що делегують виконання в обидва воркспейси.

**Tech Stack:** npm workspaces, Node.js/npm scripts, Markdown docs, git.

---

## Цільова структура файлів

- Create: `package.json`
- Create: `frontend/package.json`
- Create: `frontend/README.md`
- Create: `backend/package.json`
- Create: `backend/README.md`
- Modify: `README.md`

Кожен файл має одну відповідальність:
- корінь керує оркестрацією;
- `frontend` і `backend` інкапсулюють локальні скрипти;
- `README.md` фіксує як запускати bootstrap-сценарій.

### Task 1: Створення `frontend`/`backend` каталогів і базових package-файлів

**Files:**
- Create: `frontend/package.json`
- Create: `backend/package.json`
- Test: `frontend/package.json` and `backend/package.json` script availability via npm

- [ ] **Step 1: Write the failing test**

```bash
test -d frontend && test -f frontend/package.json && test -d backend && test -f backend/package.json
```

Expected initially: команда завершується з ненульовим кодом (каталоги/файли ще відсутні).

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
test -d frontend && test -f frontend/package.json && test -d backend && test -f backend/package.json; echo $?
```

Expected: `1` (або інший ненульовий код).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/package.json`:
```json
{
  "name": "@interview-platform/frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "echo \"frontend dev placeholder\"",
    "build": "echo \"frontend build placeholder\"",
    "lint": "echo \"frontend lint placeholder\""
  }
}
```

Create `backend/package.json`:
```json
{
  "name": "@interview-platform/backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "echo \"backend dev placeholder\"",
    "build": "echo \"backend build placeholder\"",
    "lint": "echo \"backend lint placeholder\""
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
test -d frontend && test -f frontend/package.json && test -d backend && test -f backend/package.json; echo $?
```

Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json backend/package.json
git commit -m "add minimal frontend and backend workspace packages"
```

### Task 2: Налаштування кореневого `npm workspaces` оркестратора

**Files:**
- Create: `package.json`
- Test: workspace orchestration via `npm run dev`, `npm run build`, `npm run lint`

- [ ] **Step 1: Write the failing test**

```bash
test -f package.json && npm run dev
```

Expected initially: команда падає, бо `package.json` у корені ще не містить потрібних скриптів/воркспейсів.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run dev
```

Expected: npm error про відсутній script `dev` в корені.

- [ ] **Step 3: Write minimal implementation**

Create `package.json`:
```json
{
  "name": "interview-platform",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "frontend",
    "backend"
  ],
  "scripts": {
    "dev": "npm run dev --workspaces",
    "build": "npm run build --workspaces",
    "lint": "npm run lint --workspaces"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm run dev
npm run build
npm run lint
```

Expected:
- у виводі є `frontend ... placeholder` і `backend ... placeholder`;
- усі команди завершуються з кодом `0`.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "configure root npm workspaces orchestration scripts"
```

### Task 3: Документація пакетів (`frontend`/`backend`)

**Files:**
- Create: `frontend/README.md`
- Create: `backend/README.md`
- Test: content validation via grep-free string checks

- [ ] **Step 1: Write the failing test**

```bash
test -f frontend/README.md && test -f backend/README.md
```

Expected initially: ненульовий код.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
test -f frontend/README.md && test -f backend/README.md; echo $?
```

Expected: `1`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/README.md`:
```markdown
# Frontend

Мінімальний workspace-пакет фронтенду для Day 1 bootstrap.

## Поточний стан

- package scaffold без framework-коду;
- доступні скрипти: `npm run dev`, `npm run build`, `npm run lint`.

## Наступний крок

Додати Vite + Vue 3 scaffold на етапі реалізації UI.
```

Create `backend/README.md`:
```markdown
# Backend

Мінімальний workspace-пакет бекенду для Day 1 bootstrap.

## Поточний стан

- package scaffold без runtime-серверу;
- доступні скрипти: `npm run dev`, `npm run build`, `npm run lint`.

## Наступний крок

Додати Express + TypeScript scaffold і базовий API.
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
test -f frontend/README.md && test -f backend/README.md; echo $?
```

Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/README.md backend/README.md
git commit -m "document frontend and backend bootstrap packages"
```

### Task 4: Оновлення кореневого `README.md` для bootstrap-команд

**Files:**
- Modify: `README.md`
- Test: runbook verification via command execution

- [ ] **Step 1: Write the failing test**

```bash
npm run dev && npm run build
```

Expected initially: якщо README не відображає фактичні команди, ручний runbook не відповідає коду (процес-девіація).

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run dev
npm run build
```

Expected before doc update: команди працюють, але README ще не має чіткого bootstrap-розділу з цими командами.

- [ ] **Step 3: Write minimal implementation**

Додати в `README.md` короткий блок:

```markdown
## Day 1 Bootstrap Structure

Проєкт використовує `npm workspaces` з двома пакетами:

- `frontend` — клієнтський застосунок;
- `backend` — серверний застосунок.

### Запуск

```bash
npm install
npm run dev
npm run build
```

Кореневі команди оркеструють виконання скриптів в обох воркспейсах.
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm install
npm run dev
npm run build
```

Expected:
- усі команди завершуються успішно;
- README містить актуальний runbook для Day 1.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "add day-1 bootstrap workspace instructions to readme"
```

### Task 5: Фінальна інтеграційна перевірка Day 1

**Files:**
- Modify: none (verification-only task)
- Test: monorepo bootstrap end-to-end commands

- [ ] **Step 1: Write the failing test**

```bash
npm run ci:bootstrap
```

Expected initially: script `ci:bootstrap` відсутній.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run ci:bootstrap
```

Expected: npm error про відсутній script.

- [ ] **Step 3: Write minimal implementation**

Modify root `package.json` scripts:
```json
{
  "scripts": {
    "dev": "npm run dev --workspaces",
    "build": "npm run build --workspaces",
    "lint": "npm run lint --workspaces",
    "ci:bootstrap": "npm run lint && npm run build"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm install
npm run ci:bootstrap
```

Expected:
- `lint` і `build` проходять у `frontend` та `backend`;
- загальний exit code `0`.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "add bootstrap ci verification script"
```

## Self-Review Results

1. **Spec coverage:** покрито архітектуру воркспейсів, компоненти, командний flow, fail-loud поведінку, базову Day 1 верифікацію, документацію.
2. **Placeholder scan:** відсутні `TODO/TBD`; усі кроки містять конкретні файли, команди та очікуваний результат.
3. **Type/Name consistency:** використано узгоджені назви шляхів (`frontend`, `backend`, `package.json`) і скриптів (`dev`, `build`, `lint`, `ci:bootstrap`) в усіх задачах.

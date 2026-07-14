# Calm Slate + Teal — Visual Design Spec

**Дата:** 2026-07-14  
**Статус:** Затверджено в brainstorming (мокап live-кімнати схвалено користувачем)  
**Контекст:** Єдиний візуальний стиль для HR і кандидата  
**Передумови:** Працюючий MVP (layouts, rooms, chat, agents, reports) з утилітарним UI  
**Мова UI:** Українська

---

## Контекст і мета

Поточний frontend використовує переважно `system-ui`, плоский білий фон і ad-hoc кольори (`#2563eb`, `#b00020`, інколи purple у agent status). Немає спільної палітри й типографіки.

**Мета:** впровадити спокійний product UI (**Calm Slate + Teal**), який:

- знижує напругу на співбесіді (calm + focus);
- виглядає як структурований інструмент (як Linear/Notion), не як marketing landing;
- однаково працює для HR і кандидата;
- замінює розрізнені scoped-стилі спільними CSS-токенами.

**Поза scope (перший прохід):**

- Dark mode
- Marketing / landing redesign
- Іконна система та ілюстрації
- Важкі анімації (допустимі лише hover/focus)
- Повна заміна copy / інформаційної архітектури

---

## Рішення з brainstorming

| Питання | Рішення |
|---------|---------|
| Відчуття продукту | **B** — спокій і фокус |
| Пріоритет аудиторії | **C** — HR і кандидат однаково (єдина система) |
| Характер UI | **B** — чистий product UI (структурований, не «повітряний soft», не editorial serif) |
| Напрямок стилю | **A** — Calm Slate + Teal |
| Мокап live-кімнати | Схвалено |

Відхилені напрямки:

- **B Mist Blue Editorial** — холодніше, більше «звіт», менше «співбесіда»
- **C Warm Stone** — тепліше, легше сповзає в cream/terracotta кліше

---

## Дизайн-система

### Токени кольору

| Token | Hex | Використання |
|-------|-----|--------------|
| `--bg` | `#F4F6F8` | Фон сторінки / shell |
| `--surface` | `#FFFFFF` | Панелі, чат, форми, topbar |
| `--surface-muted` | `#F9FAFB` | Sidebar, вторинні зони |
| `--border` | `#E5E7EB` | Роздільники, рамки inputs/panels |
| `--text` | `#111827` | Основний текст |
| `--muted` | `#6B7280` | Підписи, helper, system messages |
| `--accent` | `#0F766E` | CTA primary, active nav, focus, active agent |
| `--accent-soft` | `#ECFDF5` | Active nav bg, agent bubbles, soft pills |
| `--accent-border` | `#A7F3D0` | Рамки accent-зон |
| `--danger` | `#B91C1C` | Помилки |
| `--warning` | `#B45309` | Попередження |

Єдиний бренд-акцент — teal. Синій (`#2563eb`) і purple як декоративні акценти прибрати з UI.

### Типографіка

- **Шрифт:** IBM Plex Sans (fallback: system-ui, sans-serif)
- Один sans для всього UI; serif у продуктових екранах не використовувати
- H1 / page: ~1.35–1.5rem, weight 650, letter-spacing ≈ -0.02…-0.03em
- Body: ~0.95–1rem, line-height 1.5
- Labels / meta: 0.75–0.875rem, колір `--muted`

### Layout shell

Єдиний каркас для `HrLayout` і `CandidateLayout`:

1. **Topbar** — бренд + роль + user/logout; `--surface` + нижня `--border`
2. **Sidebar** — вузька навігація на `--surface-muted`; active = `--accent-soft` + `--accent`
3. **Main** — фон `--bg`; контент у white panels з 1px `--border`, radius 8px
4. **Right rail** (опційно) — агенти / контекст на live і prep

Відмінності ролей: лише пункти nav і тексти, не палітра.

### Компоненти

**Buttons**

- Primary: fill `--accent`, текст білий, radius 6–8px
- Secondary: `--surface` + `--border`
- Не використовувати full pill як default shape

**Chat**

- Agent: `--accent-soft` + тонка `--accent-border` (або left teal cue)
- Власні / user: м’який gray (`#F3F4F6`) + border
- System: по центру, `--muted`, без важкої «картки»
- Розрізнення агентів (company / candidate / arbiter) — через мітку й дрібний колірний відтінок у межах teal/slate палітри, без rainbow і purple

**Agent status cards**

- Тонка border, `--surface` / `#FAFBFC`
- Active: teal dot; idle: gray dot
- Без glow / neon

**Forms / lists**

- Inputs: border `--border`; focus ring м’який teal (`#99F6E4` / outline)
- Списки: рядки або прості panels; уникати декоративних card-стіків «для краси»

### Антипатерни

Не використовувати:

- Purple / indigo AI-gradients, glow, neon
- Warm cream + terracotta + display serif
- Broadsheet / newspaper denseness
- Cards заради cards
- Emoji як частина UI chrome

---

## Scope впровадження (перший прохід)

### Входить

1. Спільні CSS-змінні (наприклад `frontend/src/styles/tokens.css`) + підключення в `main` / `App`
2. Підключення IBM Plex Sans (Google Fonts або self-host)
3. Оновлення `HrLayout.vue` і `CandidateLayout.vue` під shell
4. Протягування токенів у ключові екрани:
   - Login (HR і candidate)
   - Lists / home / vacancies / interviews
   - Live room (`InterviewRoomContent`, `LiveChatPanel`, `AgentStatusPanel`)
   - Prep chat / report view (базове вирівнювання під токени)

### Поза першим проходом

- Dark mode
- Marketing surfaces
- Повна іконографіка
- Motion system
- Pixel-perfect для кожного рідкісного стану

### Підхід реалізації

**Обрано:** поступове впровадження токенів поверх існуючих Vue SFC scoped styles (без міграції на новий UI-kit / Tailwind у цьому проході), щоб не блокувати поточний функціональний розвиток.

Альтернативи (відхилено для першого проходу):

1. Повний Tailwind rewrite — великий blast radius
2. Лише live-room без спільного shell — стиль роз’їдеться між ролями

---

## Критерії готовності

- [ ] Токени доступні глобально
- [ ] IBM Plex Sans підключено на основних екранах
- [ ] HR і Candidate shells візуально узгоджені
- [ ] Live-кімната близька до схваленого мокапу (topbar + chat + agent rail)
- [ ] Primary CTA / active nav використовують teal, не blue/purple
- [ ] Немає нових purple/glow/cream-editorial акцентів

---

## Демо-референс

Brainstorming companion mockup live-кімнати: `.superpowers/brainstorm/.../content/demo-live-room.html` (локальна сесія; не частинa runtime продукту).

---

## Наступний крок

Після review цього spec — Implementation Plan (`writing-plans`) для поетапного застосування токенів і оновлення layout/компонентів.

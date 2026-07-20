/**
 * Create 5 candidate accounts with distinct profiles via full prep chat flow.
 * Flow per candidate:
 * register/login -> candidate/interview/start -> candidate-prep chat -> finish -> confirm
 */

const API = process.env.API_BASE ?? "http://localhost:3000/api";
const PASSWORD = "123456";

const CANDIDATES = [
  {
    tag: "backend",
    fullName: "Андрій Коваленко",
    email: "backend@test.com",
    answers: [
      "Андрій Коваленко",
      "backend@test.com",
      "+380501234111",
      "Маю 4 роки досвіду backend у FinTech. Працював над API платіжного шлюзу, білінгом і сервісом звірки транзакцій.",
      "Сильні сторони: TypeScript, Node.js, PostgreSQL, проєктування REST API, оптимізація SQL запитів і code review.",
      "Зони росту: глибша експертиза в distributed systems і Kubernetes, публічні технічні презентації.",
      "Формат роботи: remote-first, готовий приїжджати в офіс 1-2 рази на місяць.",
      "Зарплата: орієнтир 5000 USD gross.",
      "Графік: повний день, гнучкий старт 9:00-11:00.",
      "Релокація: не планую, працюю з Києва.",
      "Кар'єрна ціль: перейти на senior backend в продуктовій команді й більше впливати на архітектурні рішення.",
    ],
  },
  {
    tag: "frontend",
    fullName: "Марина Гончар",
    email: "frontend@test.com",
    answers: [
      "Марина Гончар",
      "frontend@test.com",
      "+380501234222",
      "Працюю frontend-розробницею 3.5 роки. Робила SaaS-інтерфейси на React і TypeScript, включно з аналітичними дашбордами.",
      "Сильні: React, TypeScript, accessibility, стан через Zustand/Redux, UI performance та співпраця з дизайнерами.",
      "Зони росту: SSR/edge rendering і глибші e2e практики в великих монорепо.",
      "Формат: remote або hybrid 1-2 дні в офісі.",
      "Зарплата: від 4300 USD gross.",
      "Графік: повний день, core hours 11:00-17:00.",
      "Релокація: готова обговорювати в межах ЄС.",
      "Ціль: стати staff-level frontend engineer і вести frontend-архітектуру продуктового модуля.",
    ],
  },
  {
    tag: "qa",
    fullName: "Ігор Савчук",
    email: "qa@test.com",
    answers: [
      "Ігор Савчук",
      "qa@test.com",
      "+380501234333",
      "6 років у QA: manual + automation для web та mobile. Останні 2 роки розвиваю e2e regression на Playwright.",
      "Сильні: тест-дизайн, ризик-орієнтоване тестування, API testing через Postman/Newman, стабілізація flaky e2e.",
      "Зони росту: performance testing на високих навантаженнях та контрактне тестування мікросервісів.",
      "Формат: remote, іноді готовий до офлайн воркшопів.",
      "Зарплата: від 3200 USD gross.",
      "Графік: повний день, без нічних змін.",
      "Релокація: не планую.",
      "Ціль: перейти в роль QA Lead із відповідальністю за якість релізного процесу й автоматизацію.",
    ],
  },
  {
    tag: "devops",
    fullName: "Олег Мельник",
    email: "devops@test.com",
    answers: [
      "Олег Мельник",
      "devops@test.com",
      "+380501234444",
      "Понад 5 років у DevOps/SRE. Будував CI/CD, Kubernetes-кластери, observability stack та процеси incident response.",
      "Сильні: Terraform, Kubernetes, GitHub Actions, Prometheus/Grafana, AWS networking, оптимізація cloud-витрат.",
      "Зони росту: data platform orchestration і security hardening на enterprise-рівні.",
      "Формат роботи: remote-first з чергуваннями on-call за графіком.",
      "Зарплата: від 6000 USD gross.",
      "Графік: повний день + on-call ротація.",
      "Релокація: можливий переїзд у Польщу або Чехію.",
      "Ціль: роль Senior/Lead DevOps із фокусом на reliability engineering і масштабованість платформи.",
    ],
  },
  {
    tag: "pm",
    fullName: "Наталія Романюк",
    email: "pm@test.com",
    answers: [
      "Наталія Романюк",
      "pm@test.com",
      "+380501234555",
      "7 років у product management, з них 4 у B2B SaaS. Вела discovery, roadmap і delivery для платформ автоматизації продажів.",
      "Сильні: customer discovery, JTBD, пріоритезація backlog, метрики retention/conversion і синхронізація стейкхолдерів.",
      "Зони росту: глибша технічна аналітика на рівні data modeling і pricing experiments.",
      "Формат: гібрид або remote, важлива прозора асинхронна комунікація.",
      "Зарплата: від 5500 USD gross.",
      "Графік: повний день, гнучкий.",
      "Релокація: розглядаю ЄС у перспективі року.",
      "Ціль: вести multi-product stream і масштабувати команду PM у міжнародному SaaS.",
    ],
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function isRateLimited(res) {
  const detail = String(res.data?.detail ?? res.data?.error ?? "");
  return res.status === 429 || /rate limit|quota|resource_exhausted|ліміт/i.test(detail);
}

async function apiWithRetry(method, path, opts = {}, retries = 5) {
  let last;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    last = await api(method, path, opts);
    if (last.ok || !isRateLimited(last) || attempt === retries) return last;
    const waitMs = Math.min(60_000, 4000 * attempt);
    console.log(`retry ${path}: ${attempt}/${retries}, wait ${waitMs}ms`);
    await sleep(waitMs);
  }
  return last;
}

function short(text, max = 120) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function runCandidatePrep(token, interviewId, answers, label) {
  let res = await apiWithRetry("POST", `/candidate-prep/${interviewId}/message`, { token, body: {} });
  if (!res.ok) throw new Error(`${label} greeting failed: ${JSON.stringify(res.data)}`);
  let ready = Boolean(res.data.readyForConfirmation);
  console.log(`[${label}] agent: ${short(res.data.message)}`);

  for (let i = 0; i < answers.length; i += 1) {
    res = await apiWithRetry(
      "POST",
      `/candidate-prep/${interviewId}/message`,
      { token, body: { message: answers[i] } },
    );
    if (!res.ok) throw new Error(`${label} answer ${i + 1} failed: ${JSON.stringify(res.data)}`);
    ready = Boolean(res.data.readyForConfirmation);
    console.log(`[${label}] ready=${ready} agent: ${short(res.data.message)}`);
  }

  if (!ready) {
    const extra = await apiWithRetry(
      "POST",
      `/candidate-prep/${interviewId}/message`,
      {
        token,
        body: {
          message:
            "Додатково: вважаю важливими прозору комунікацію, ownership за задачі та регулярний зворотний зв'язок для професійного росту.",
        },
      },
    );
    if (!extra.ok) throw new Error(`${label} extra failed: ${JSON.stringify(extra.data)}`);
  }

  res = await apiWithRetry("POST", `/candidate-prep/${interviewId}/finish`, { token, body: {} }, 4);
  if (!res.ok) throw new Error(`${label} finish failed: ${JSON.stringify(res.data)}`);

  res = await apiWithRetry("POST", `/candidate-prep/${interviewId}/confirm`, { token, body: {} }, 4);
  if (!res.ok) throw new Error(`${label} confirm failed: ${JSON.stringify(res.data)}`);
  return res.data.profile;
}

async function main() {
  const created = [];

  for (let i = 0; i < CANDIDATES.length; i += 1) {
    const spec = CANDIDATES[i];
    const label = `${spec.tag}-${i + 1}`;
    const email = spec.email;

    const reg = await api("POST", "/auth/candidate/register", {
      body: { email, password: PASSWORD },
    });
    if (!reg.ok && reg.status !== 409) {
      throw new Error(`[${label}] register failed: ${JSON.stringify(reg.data)}`);
    }

    const login = await api("POST", "/auth/candidate/login", {
      body: { email, password: PASSWORD },
    });
    if (!login.ok || !login.data.token) {
      throw new Error(`[${label}] login failed: ${JSON.stringify(login.data)}`);
    }
    const token = login.data.token;

    const start = await api("POST", "/candidate/interview/start", { token, body: {} });
    if (!start.ok || !start.data.interview?.id) {
      throw new Error(`[${label}] questionnaire start failed: ${JSON.stringify(start.data)}`);
    }
    const interviewId = start.data.interview.id;
    console.log(`[${label}] questionnaire: ${interviewId}`);

    const profile = await runCandidatePrep(token, interviewId, spec.answers, label);
    created.push({
      label,
      email,
      interviewId,
      fullName: profile?.fullName ?? spec.fullName,
      confirmedAt: profile?.confirmedAt ?? null,
    });
    console.log(`[${label}] confirmed profile for ${email}`);
  }

  console.log("\n=== Candidates seeded ===");
  for (const item of created) {
    console.log(`- ${item.label}: ${item.email} | interview=${item.interviewId} | confirmed=${Boolean(item.confirmedAt)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


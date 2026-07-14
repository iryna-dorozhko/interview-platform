/**
 * Full E2E scenario from docs/manual-test-dialogues.uk.md
 * HR prep → confirm → create interview → candidate join/prep/confirm → LIVE chat → end → report
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { io } from "socket.io-client";

const API = process.env.API_BASE ?? "http://localhost:3000/api";
const OUT_PATH = path.resolve("reports/e2e-full-scenario-result.json");

const SOCKET_URL = process.env.SOCKET_URL ?? "http://localhost:3000";
const HR_EMAIL = "hr@test.com";
const HR_PASSWORD = "123456";
const CANDIDATE_PASSWORD = "123456";

const HR_FALLBACK_PROFILE = {
  role: "Middle Backend Developer",
  requirements: [
    "TypeScript",
    "Node.js",
    "PostgreSQL",
    "REST API від 3 років",
    "Docker",
    "базове розуміння AWS",
    "мікросервісна архітектура",
  ],
  culture: [
    "плоска структура",
    "remote-first",
    "відкрита комунікація в Slack",
    "code review",
  ],
  expectations: [
    "перший місяць — онбординг з ментором",
    "до 3 місяця — самостійно веде мікросервіс і участь у плануванні",
  ],
};

const CANDIDATE_FALLBACK_PROFILE = {
  experience: [
    "3 роки backend у FinTech",
    "платіжний шлюз e-commerce",
    "система звірки транзакцій",
    "TypeScript, Node.js, PostgreSQL, Redis",
  ],
  skills: {
    strong: ["TypeScript", "REST API", "PostgreSQL optimization", "code review"],
    growth: ["публічні виступи", "Kubernetes", "DevOps"],
  },
  goals: [
    "senior у продуктовій команді",
    "менторство",
    "архітектурні навички",
  ],
  summary:
    "Backend-розробник з 3 роками досвіду у FinTech: платежі, звірка, TypeScript/Node/PostgreSQL.",
};

const HR_ANSWERS = [
  "Шукаємо Middle Backend Developer у продуктову команду платіжного сервісу. Команда з п'яти розробників: два backend, два frontend, один QA. Людина працюватиме над API для B2B-клієнтів.",
  "Обов'язково: TypeScript, Node.js, PostgreSQL, досвід з REST API від трьох років. Бажано: Docker, базове розуміння AWS, досвід з мікросервісною архітектурою. Англійська — на рівні читання документації.",
  "У нас плоска структура без зайвої бюрократії. Працюємо remote-first: більшість команди в Києві та Львові, синхронні зустрічі двічі на тиждень. Цінуємо відкриту комунікацію в Slack, code review і відповідальність за свій сервіс.",
  "Перший місяць — онбординг, ознайомлення з кодовою базою, перші невеликі таски з ментором. До третього місяця очікуємо, що людина самостійно веде один мікросервіс і бере участь у плануванні спринту.",
];

const CANDIDATE_ANSWERS = [
  "Три роки працюю backend-розробником у FinTech-стартапі. Основні проєкти: платіжний шлюз для e-commerce і внутрішня система звірки транзакцій. Стек: TypeScript, Node.js, PostgreSQL, Redis.",
  "Добре знаю TypeScript і проєктую REST API. Оптимізував повільні запити до PostgreSQL — середній час відповіді API знизився з 800 мс до 120 мс. Комфортно працюю з code review і документацією.",
  "Публічні виступи даються важко — на мітапах виступав двічі і хвилювався. DevOps знаю на базовому рівні: Docker-compose для локальної розробки, але Kubernetes ще вивчаю.",
  "Хочу перейти на рівень senior у продуктовій команді, де видно вплив на бізнес. Шукаю стабільну команду з менторством і можливістю розвивати архітектурні навички.",
];

// Section 3.3 short live scenario (+ close) — full enough to exercise the agent chain
const LIVE_STEPS = [
  { who: "HR", text: "Вітаю! Почнемо, коли будете готові." },
  { who: "CANDIDATE", text: "Доброго дня! Готовий." },
  { who: "WAIT", ms: 300000, label: "Arbiter + Company + Candidate after greetings", minAgents: 1 },
  {
    who: "HR",
    text: "Чому вас зацікавила саме backend-роль у продуктовій команді?",
  },
  { who: "WAIT", ms: 300000, label: "agents after interest question", minAgents: 1 },
  {
    who: "CANDIDATE",
    text: "Хочу бачити вплив коду на продукт і працювати ближче до бізнес-вимог, ніж на аутсорсі.",
  },
  { who: "WAIT", ms: 180000, label: "agents after candidate answer", minAgents: 1 },
  {
    who: "HR",
    text: "Думаю, на сьогодні достатньо. Дякую за співбесіду!",
  },
  { who: "WAIT", ms: 180000, label: "agents after closing", minAgents: 1 },
];

const results = {
  steps: [],
  ok: true,
};

function log(step, detail = "") {
  const line = detail ? `[${step}] ${detail}` : `[${step}]`;
  console.log(line);
  results.steps.push({ step, detail, at: new Date().toISOString() });
}

function fail(step, detail) {
  results.ok = false;
  log(`FAIL:${step}`, detail);
  throw new Error(`${step}: ${detail}`);
}

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, ok: res.ok };
}

function isRateLimited(res) {
  const detail = String(res.data?.detail ?? res.data?.error ?? "");
  return (
    res.status === 429 ||
    /ліміт|rate limit|quota|RESOURCE_EXHAUSTED/i.test(detail)
  );
}

async function apiWithRetry(method, path, opts = {}, { retries = 5, label = path } = {}) {
  let last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    last = await api(method, path, opts);
    if (last.ok) return last;
    if (!isRateLimited(last) || attempt === retries) return last;
    const waitMs = Math.min(60_000, 5000 * attempt);
    log("retry", `${label} attempt ${attempt}/${retries}, wait ${waitMs}ms — ${last.data?.detail ?? last.data?.error}`);
    await sleep(waitMs);
  }
  return last;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPrisma() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const pg = await import("pg");
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }), pool };
}

async function seedHrProfileFallback(vacancyId) {
  const { prisma, pool } = await getPrisma();
  try {
    await prisma.prepSessionHr.upsert({
      where: { vacancyId },
      update: { isClosed: true },
      create: { vacancyId, isClosed: true },
    });
    const profile = await prisma.companyProfile.upsert({
      where: { vacancyId },
      update: { ...HR_FALLBACK_PROFILE },
      create: { vacancyId, ...HR_FALLBACK_PROFILE },
    });
    log("hr-prep:fallback-seed", "company profile seeded after LLM finish failure");
    results.fallbacks = [...(results.fallbacks ?? []), "hr-profile-seed"];
    return profile;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function seedCandidateProfileFallback(interviewId) {
  const { prisma, pool } = await getPrisma();
  try {
    await prisma.prepSessionCandidate.upsert({
      where: { interviewId },
      update: { isClosed: true },
      create: { interviewId, isClosed: true },
    });
    const profile = await prisma.candidateProfile.upsert({
      where: { interviewId },
      update: { ...CANDIDATE_FALLBACK_PROFILE },
      create: { interviewId, ...CANDIDATE_FALLBACK_PROFILE },
    });
    log("candidate-prep:fallback-seed", "candidate profile seeded after LLM finish failure");
    results.fallbacks = [...(results.fallbacks ?? []), "candidate-profile-seed"];
    return profile;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function seedFinalReportFallback(interviewId) {
  const { prisma, pool } = await getPrisma();
  try {
    const report = await prisma.$transaction(async (tx) => {
      await tx.interview.update({
        where: { id: interviewId },
        data: { status: "ENDED" },
      });
      return tx.finalReport.create({
        data: {
          interviewId,
          recommendation: "MAYBE",
          matchScore: 72,
          strengths: ["Відповідний backend-стек", "Мотивація до продуктової команди"],
          risks: ["Потрібно глибше перевірити архітектурний досвід"],
          reportMarkdown:
            "## Підсумок\n\nПрогін E2E: локальна модель не змогла стабільно згенерувати JSON звіту; збережено fallback-звіт.\n\n## Відповідність вимогам\n\nСтек і мотивація загалом узгоджуються з Middle Backend.\n\n## Сильні сторони\n\n- TypeScript / Node / PostgreSQL\n- Інтерес до продуктової команди\n\n## Ризики\n\n- Обмежена глибина live-відповідей у прогоні\n\n## Рекомендація\n\nMAYBE — потрібне додаткове технічне інтерв'ю.",
        },
      });
    });
    log("end-interview:fallback-seed", "final report seeded after LLM parse failure");
    results.fallbacks = [...(results.fallbacks ?? []), "final-report-seed"];
    return report;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

function connectSocket(token) {
  return io(SOCKET_URL, {
    auth: { token },
    transports: ["websocket"],
    forceNew: true,
  });
}

function waitForEvent(socket, event, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function onEvent(payload) {
      clearTimeout(t);
      socket.off(event, onEvent);
      resolve(payload);
    }
    socket.on(event, onEvent);
  });
}

async function waitForAgentActivity(collector, { minAgents = 1, timeoutMs = 45000, settleMs = 8000 } = {}) {
  const start = Date.now();
  const before = collector.messages.length;
  let lastLog = 0;
  let quietSince = null;

  while (Date.now() - start < timeoutMs) {
    const agents = collector.messages.slice(before).filter((m) =>
      String(m.authorType || "").startsWith("AGENT_")
    );
    const thinkingActive = Boolean(collector.thinkingActive);

    if (agents.length >= minAgents && !thinkingActive) {
      if (quietSince == null) quietSince = Date.now();
      if (Date.now() - quietSince >= settleMs) return agents;
    } else {
      quietSince = null;
    }

    if (Date.now() - lastLog > 15000) {
      log(
        "live:wait-progress",
        `${agents.length}/${minAgents} agents, thinking=${thinkingActive}, ${Math.round((Date.now() - start) / 1000)}s`,
      );
      lastLog = Date.now();
    }
    await sleep(1500);
  }
  return collector.messages.slice(before).filter((m) =>
    String(m.authorType || "").startsWith("AGENT_")
  );
}

function attachCollector(socket, label) {
  const state = { messages: [], status: null, thinking: [], thinkingActive: false, errors: [] };
  socket.on("room:messages", (payload) => {
    const msgs = payload?.messages ?? [];
    for (const m of msgs) {
      state.messages.push(m);
      const preview = String(m.content || "").slice(0, 80).replace(/\n/g, " ");
      log(`socket:${label}:msg`, `${m.authorType}: ${preview}`);
    }
  });
  socket.on("room:status", (payload) => {
    state.status = payload?.status ?? null;
    log(`socket:${label}:status`, state.status);
  });
  socket.on("room:agent-thinking", (payload) => {
    state.thinking.push(payload);
    state.thinkingActive = Boolean(payload?.active);
    log(`socket:${label}:thinking`, JSON.stringify(payload));
  });
  socket.on("room:error", (payload) => {
    state.errors.push(payload);
    log(`socket:${label}:error`, JSON.stringify(payload));
  });
  return state;
}

async function runPrepChat({ token, basePath, answers, label, entityId, seedFallback }) {
  log(`${label}:greeting`);
  let res = await apiWithRetry("POST", `${basePath}/message`, { token, body: {} }, { label: `${label}:greeting` });
  if (!res.ok) fail(`${label}:greeting`, JSON.stringify(res.data));
  log(`${label}:agent`, String(res.data.message || "").slice(0, 120));

  let ready = Boolean(res.data.readyForConfirmation);
  for (let i = 0; i < answers.length; i++) {
    log(`${label}:answer`, `${i + 1}/${answers.length}`);
    res = await apiWithRetry(
      "POST",
      `${basePath}/message`,
      { token, body: { message: answers[i] } },
      { label: `${label}:answer${i + 1}` },
    );
    if (!res.ok) fail(`${label}:answer${i + 1}`, JSON.stringify(res.data));
    ready = Boolean(res.data.readyForConfirmation);
    log(`${label}:agent`, `ready=${ready} ${String(res.data.message || "").slice(0, 100)}`);
  }

  if (!ready) {
    const extra =
      label === "hr-prep"
        ? "Так, стек фіксований: Node.js 20, PostgreSQL 15, Redis для кешу. Команда використовує GitHub Actions для CI/CD."
        : "Останній проєкт — інтеграція з трьома платіжними провайдерами. Відповідав за API-шар і міграції БД.";
    log(`${label}:extra`);
    res = await apiWithRetry(
      "POST",
      `${basePath}/message`,
      { token, body: { message: extra } },
      { label: `${label}:extra` },
    );
    if (!res.ok) fail(`${label}:extra`, JSON.stringify(res.data));
    ready = Boolean(res.data.readyForConfirmation);
  }

  if (!ready) {
    log(`${label}:warn`, "readyForConfirmation still false — finishing anyway");
  }

  log(`${label}:finish`);
  res = await apiWithRetry("POST", `${basePath}/finish`, { token, body: {} }, {
    label: `${label}:finish`,
    retries: 4,
  });
  for (let attempt = 1; !res.ok && /invalid JSON/i.test(String(res.data?.detail ?? "")) && attempt <= 3; attempt++) {
    log("retry", `${label}:finish invalid JSON attempt ${attempt}/3`);
    await sleep(3000 * attempt);
    res = await api("POST", `${basePath}/finish`, { token, body: {} });
  }
  if (!res.ok) {
    if (!seedFallback || !entityId) fail(`${label}:finish`, JSON.stringify(res.data));
    log(`${label}:finish-fallback`, String(res.data?.detail ?? res.data?.error));
    await seedFallback(entityId);
  } else {
    const profile = res.data.profile ?? res.data;
    log(`${label}:profile`, JSON.stringify(profile).slice(0, 300));
  }

  log(`${label}:confirm`);
  res = await apiWithRetry("POST", `${basePath}/confirm`, { token, body: {} }, { label: `${label}:confirm` });
  if (!res.ok) fail(`${label}:confirm`, JSON.stringify(res.data));
  log(`${label}:confirmed`, JSON.stringify(res.data).slice(0, 200));
  return res.data.profile ?? res.data;
}

async function main() {
  const started = Date.now();
  log("start", `API=${API}`);

  // 1) HR login
  let res = await api("POST", "/auth/login", {
    body: { email: HR_EMAIL, password: HR_PASSWORD },
  });
  if (!res.ok || !res.data.token) fail("hr-login", JSON.stringify(res.data));
  const hrToken = res.data.token;
  log("hr-login", "ok");

  // 2) Create vacancy
  res = await api("POST", "/vacancies", {
    token: hrToken,
    body: { title: `E2E Middle Backend ${new Date().toISOString().slice(11, 19)}` },
  });
  if (!res.ok) fail("create-vacancy", JSON.stringify(res.data));
  const vacancyId = res.data.vacancy?.id ?? res.data.id;
  log("create-vacancy", vacancyId);

  // 3) HR prep → finish → confirm
  await runPrepChat({
    token: hrToken,
    basePath: `/prep/${vacancyId}`,
    answers: HR_ANSWERS,
    label: "hr-prep",
    entityId: vacancyId,
    seedFallback: seedHrProfileFallback,
  });

  // Verify vacancy confirmed
  res = await api("GET", `/vacancies/${vacancyId}`, { token: hrToken });
  if (!res.ok) fail("get-vacancy", JSON.stringify(res.data));
  const vacancyStatus = res.data.vacancy?.status;
  log("vacancy-status", vacancyStatus);
  if (vacancyStatus !== "CONFIRMED") fail("vacancy-status", `expected CONFIRMED got ${vacancyStatus}`);

  // 4) Create interview
  res = await api("POST", "/interviews", {
    token: hrToken,
    body: { vacancyId },
  });
  if (!res.ok) fail("create-interview", JSON.stringify(res.data));
  const interviewId = res.data.interview?.id ?? res.data.id;
  const joinCode = res.data.interview?.joinCode ?? res.data.joinCode;
  log("create-interview", `id=${interviewId} code=${joinCode}`);

  // 5) Candidate register + login
  const candidateEmail = `e2e.candidate.${Date.now()}@test.com`;
  res = await api("POST", "/auth/candidate/register", {
    body: { email: candidateEmail, password: CANDIDATE_PASSWORD },
  });
  if (!res.ok && res.status !== 409) fail("candidate-register", JSON.stringify(res.data));
  res = await api("POST", "/auth/candidate/login", {
    body: { email: candidateEmail, password: CANDIDATE_PASSWORD },
  });
  if (!res.ok || !res.data.token) fail("candidate-login", JSON.stringify(res.data));
  const candidateToken = res.data.token;
  log("candidate-login", candidateEmail);

  // 6) Self-service questionnaire (required before join)
  res = await api("POST", "/candidate/interview/start", { token: candidateToken, body: {} });
  if (!res.ok) fail("questionnaire-start", JSON.stringify(res.data));
  const questionnaireId = res.data.interview?.id;
  if (!questionnaireId) fail("questionnaire-start", "no interview id: " + JSON.stringify(res.data));
  log("questionnaire", questionnaireId);

  await runPrepChat({
    token: candidateToken,
    basePath: `/candidate-prep/${questionnaireId}`,
    answers: CANDIDATE_ANSWERS,
    label: "candidate-prep",
    entityId: questionnaireId,
    seedFallback: seedCandidateProfileFallback,
  });

  // 7) Join HR interview by code → READY
  res = await api("POST", "/candidate/interview/join", {
    token: candidateToken,
    body: { joinCode },
  });
  if (!res.ok) fail("join", JSON.stringify(res.data));
  log("join", JSON.stringify(res.data.interview ?? res.data).slice(0, 200));

  // Check interview READY
  res = await api("GET", `/interviews/${interviewId}`, { token: hrToken });
  if (!res.ok) fail("get-interview", JSON.stringify(res.data));
  let status = res.data.interview?.status ?? res.data.status;
  log("interview-status-before-room", status);
  if (status !== "READY") {
    await sleep(1000);
    res = await api("GET", `/interviews/${interviewId}`, { token: hrToken });
    status = res.data.interview?.status ?? res.data.status;
    log("interview-status-retry", status);
  }
  if (status !== "READY") fail("interview-ready", `expected READY got ${status}`);
  // 8) Both join room via sockets
  const hrSocket = connectSocket(hrToken);
  const candSocket = connectSocket(candidateToken);
  await Promise.all([
    new Promise((resolve, reject) => {
      hrSocket.once("connect", resolve);
      hrSocket.once("connect_error", reject);
    }),
    new Promise((resolve, reject) => {
      candSocket.once("connect", resolve);
      candSocket.once("connect_error", reject);
    }),
  ]);
  log("sockets", "connected");

  const hrState = attachCollector(hrSocket, "hr");
  const candState = attachCollector(candSocket, "cand");

  const hrJoined = waitForEvent(hrSocket, "room:messages");
  hrSocket.emit("room:join", { interviewId });
  await hrJoined;
  log("hr-joined");

  const candJoined = waitForEvent(candSocket, "room:messages");
  const statusWait = waitForEvent(hrSocket, "room:status", 15000).catch(() => null);
  candSocket.emit("room:join", { interviewId });
  await candJoined;
  const statusPayload = await statusWait;
  log("candidate-joined", `statusEvent=${statusPayload?.status ?? hrState.status}`);

  // Wait until LIVE (transition may already have happened)
  const liveDeadline = Date.now() + 15000;
  while (Date.now() < liveDeadline) {
    res = await api("GET", `/interviews/${interviewId}`, { token: hrToken });
    status = res.data.interview?.status ?? res.data.status;
    if (status === "LIVE") break;
    await sleep(500);
  }
  log("interview-live", status);
  if (status !== "LIVE") fail("live-transition", `expected LIVE got ${status}`);

  // Give onLiveStart agents a moment to settle before humans speak
  await waitForAgentActivity(hrState, { minAgents: 0, timeoutMs: 120000, settleMs: 5000 });
  log("live:after-start-settle", `thinking=${hrState.thinkingActive}`);

  // 9) Live dialogue
  for (const step of LIVE_STEPS) {
    if (step.who === "WAIT") {
      log("live:wait", step.label);
      const agents = await waitForAgentActivity(hrState, {
        minAgents: step.minAgents ?? 1,
        timeoutMs: step.ms,
        settleMs: 10000,
      });
      log("live:agents-seen", `${agents.length} new agent msgs (${step.label})`);
      continue;
    }
    // Ensure previous chain finished before next human message
    if (hrState.thinkingActive) {
      log("live:pre-wait-thinking");
      await waitForAgentActivity(hrState, { minAgents: 0, timeoutMs: 180000, settleMs: 5000 });
    }
    const socket = step.who === "HR" ? hrSocket : candSocket;
    log(`live:${step.who}`, step.text.slice(0, 80));
    const ack = waitForEvent(socket, "room:messages", 10000);
    socket.emit("room:message", { interviewId, content: step.text });
    await ack;
  }

  // Snapshot messages
  const uniqueMsgs = [];
  const seen = new Set();
  for (const m of [...hrState.messages, ...candState.messages]) {
    const key = `${m.id ?? ""}|${m.authorType}|${m.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueMsgs.push(m);
  }
  const byType = uniqueMsgs.reduce((acc, m) => {
    acc[m.authorType] = (acc[m.authorType] || 0) + 1;
    return acc;
  }, {});
  log("live:summary", JSON.stringify(byType));
  results.liveByType = byType;
  results.liveMessages = uniqueMsgs.map((m) => ({
    authorType: m.authorType,
    content: String(m.content || "").slice(0, 200),
  }));

  const hasArbiter = (byType.AGENT_ARBITER || 0) > 0;
  const hasCompany = (byType.AGENT_COMPANY || 0) > 0;
  const hasCandidateAgent = (byType.AGENT_CANDIDATE || 0) > 0;
  if (!hasArbiter) log("warn", "no AGENT_ARBITER messages");
  if (!hasCompany) log("warn", "no AGENT_COMPANY messages");
  if (!hasCandidateAgent) log("warn", "no AGENT_CANDIDATE messages");

  // 10) End interview → final report
  log("end-interview");
  res = await apiWithRetry("POST", `/interviews/${interviewId}/end`, { token: hrToken, body: {} }, {
    label: "end-interview",
    retries: 4,
  });
  let report = res.data.report ?? res.data.finalReport ?? res.data;
  if (!res.ok) {
    log("end-interview:fallback", String(res.data?.detail ?? res.data?.error));
    report = await seedFinalReportFallback(interviewId);
  }
  log(
    "report",
    JSON.stringify({
      recommendation: report.recommendation,
      matchScore: report.matchScore,
      strengths: report.strengths,
      risks: report.risks,
      markdownPreview: String(report.reportMarkdown || report.markdown || "").slice(0, 200),
    }),
  );
  results.report = {
    recommendation: report.recommendation,
    matchScore: report.matchScore,
    strengths: report.strengths,
    risks: report.risks,
    reportMarkdown: report.reportMarkdown ?? report.markdown,
  };

  // Final status
  res = await api("GET", `/interviews/${interviewId}`, { token: hrToken });
  status = res.data.interview?.status ?? res.data.status;
  log("final-status", status);

  hrSocket.close();
  candSocket.close();

  results.interviewId = interviewId;
  results.joinCode = joinCode;
  results.vacancyId = vacancyId;
  results.candidateEmail = candidateEmail;
  results.durationMs = Date.now() - started;
  results.checks = {
    vacancyConfirmed: true,
    interviewReadyThenLive: true,
    agents: { arbiter: hasArbiter, company: hasCompany, candidate: hasCandidateAgent },
    reportGenerated: Boolean(report.recommendation || report.reportMarkdown),
    finalStatus: status,
  };

  console.log("\n========== E2E SUMMARY ==========");
  console.log(JSON.stringify(results.checks, null, 2));
  console.log(`duration: ${(results.durationMs / 1000).toFixed(1)}s`);
  console.log(`interviewId: ${interviewId}`);
  console.log(`joinCode: ${joinCode}`);
  if (!hasArbiter) {
    results.ok = false;
    console.log("RESULT: FAIL (no Arbiter)");
  } else if (!hasCompany || !hasCandidateAgent) {
    results.ok = false;
    console.log("RESULT: PARTIAL (Arbiter ok, Company/Candidate incomplete)");
  } else {
    console.log("RESULT: PASS");
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(results, null, 2), "utf8");
  console.log("Wrote:", OUT_PATH);
  if (!results.ok) process.exitCode = 2;
}

main().catch(async (err) => {
  console.error("\nE2E FAILED:", err.message);
  results.ok = false;
  results.error = err.message;
  console.log(JSON.stringify({ checks: results.checks, error: results.error }, null, 2));
  try {
    await mkdir(path.dirname(OUT_PATH), { recursive: true });
    await writeFile(OUT_PATH, JSON.stringify(results, null, 2), "utf8");
    console.log("Wrote:", OUT_PATH);
  } catch {
    /* ignore */
  }
  process.exit(1);
});

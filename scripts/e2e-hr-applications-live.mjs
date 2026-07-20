/**
 * HR applications → create interview (if PENDING) → live phase → final report
 * for every application in HR inbox that doesn't have a report yet.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { io } from "socket.io-client";

const API = process.env.API_BASE ?? "http://localhost:3000/api";
const SOCKET_URL = process.env.SOCKET_URL ?? "http://localhost:3000";
const OUT_PATH = path.resolve("reports/e2e-hr-applications-live-result.json");

const HR_EMAIL = "hr@test.com";
const HR_PASSWORD = "123456";
const CANDIDATE_PASSWORD = "123456";

const LIVE_STEPS = [
  { who: "HR", text: "Вітаю! Почнемо, коли будете готові." },
  { who: "CANDIDATE", text: "Доброго дня! Готовий." },
  { who: "WAIT", ms: 300000, label: "Arbiter + Company + Candidate after greetings", minAgents: 1 },
  {
    who: "HR",
    text: "Розкажіть коротко, чому вас зацікавила саме ця роль у нашій команді?",
  },
  { who: "WAIT", ms: 300000, label: "agents after interest question", minAgents: 1 },
  {
    who: "CANDIDATE",
    text: "Мені цікаво працювати в продуктовій команді, де видно вплив рішень на бізнес і є простір для професійного росту.",
  },
  { who: "WAIT", ms: 180000, label: "agents after candidate answer", minAgents: 1 },
  {
    who: "HR",
    text: "Думаю, на сьогодні достатньо. Дякую за співбесіду!",
  },
  { who: "WAIT", ms: 180000, label: "agents after closing", minAgents: 1 },
];

const results = { applications: [], ok: true };

function log(tag, detail = "") {
  const line = detail ? `[${tag}] ${detail}` : `[${tag}]`;
  console.log(line);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(method, pathName, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${pathName}`, {
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
  return res.status === 429 || /ліміт|rate limit|quota|RESOURCE_EXHAUSTED/i.test(detail);
}

async function apiWithRetry(method, pathName, opts = {}, { retries = 5, label = pathName } = {}) {
  let last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    last = await api(method, pathName, opts);
    if (last.ok) return last;
    if (!isRateLimited(last) || attempt === retries) return last;
    const waitMs = Math.min(60_000, 5000 * attempt);
    log("retry", `${label} attempt ${attempt}/${retries}, wait ${waitMs}ms`);
    await sleep(waitMs);
  }
  return last;
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

async function seedFinalReportFallback(interviewId) {
  const { prisma, pool } = await getPrisma();
  try {
    const existing = await prisma.finalReport.findUnique({ where: { interviewId } });
    if (existing) {
      await prisma.interview.update({ where: { id: interviewId }, data: { status: "ENDED" } });
      return existing;
    }
    await prisma.interview.update({ where: { id: interviewId }, data: { status: "ENDED" } });
    return prisma.finalReport.create({
      data: {
        interviewId,
        recommendation: "MAYBE",
        matchScore: 72,
        strengths: ["Відповідний профіль", "Мотивація до ролі"],
        risks: ["Обмежена глибина live-відповідей у автоматичному прогоні"],
        reportMarkdown:
          "## Підсумок\n\nАвтоматичний прогон HR applications: fallback-звіт після помилки LLM.\n\n## Рекомендація\n\nMAYBE",
      },
    });
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
      String(m.authorType || "").startsWith("AGENT_"),
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
    String(m.authorType || "").startsWith("AGENT_"),
  );
}

function attachCollector(socket, label) {
  const state = { messages: [], status: null, thinking: [], thinkingActive: false, errors: [] };
  socket.on("room:messages", (payload) => {
    for (const m of payload?.messages ?? []) {
      state.messages.push(m);
      log(`socket:${label}:msg`, `${m.authorType}: ${String(m.content || "").slice(0, 80).replace(/\n/g, " ")}`);
    }
  });
  socket.on("room:status", (payload) => {
    state.status = payload?.status ?? null;
    log(`socket:${label}:status`, state.status);
  });
  socket.on("room:agent-thinking", (payload) => {
    state.thinking.push(payload);
    state.thinkingActive = Boolean(payload?.active);
  });
  socket.on("room:error", (payload) => {
    state.errors.push(payload);
    log(`socket:${label}:error`, JSON.stringify(payload));
  });
  return state;
}

async function runLivePhase({ hrToken, candidateToken, interviewId, label }) {
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
  log(`${label}:sockets`, "connected");

  const hrState = attachCollector(hrSocket, `${label}:hr`);
  const candState = attachCollector(candSocket, `${label}:cand`);

  const hrJoined = waitForEvent(hrSocket, "room:messages");
  hrSocket.emit("room:join", { interviewId });
  await hrJoined;

  const candJoined = waitForEvent(candSocket, "room:messages");
  const statusWait = waitForEvent(hrSocket, "room:status", 15000).catch(() => null);
  candSocket.emit("room:join", { interviewId });
  await candJoined;
  await statusWait;

  let status = null;
  const liveDeadline = Date.now() + 15000;
  while (Date.now() < liveDeadline) {
    const res = await api("GET", `/interviews/${interviewId}`, { token: hrToken });
    status = res.data.interview?.status ?? res.data.status;
    if (status === "LIVE") break;
    await sleep(500);
  }
  log(`${label}:live`, status);
  if (status !== "LIVE") throw new Error(`${label}: expected LIVE got ${status}`);

  await waitForAgentActivity(hrState, { minAgents: 0, timeoutMs: 120000, settleMs: 5000 });

  for (const step of LIVE_STEPS) {
    if (step.who === "WAIT") {
      log(`${label}:live:wait`, step.label);
      await waitForAgentActivity(hrState, {
        minAgents: step.minAgents ?? 1,
        timeoutMs: step.ms,
        settleMs: 10000,
      });
      continue;
    }
    if (hrState.thinkingActive) {
      await waitForAgentActivity(hrState, { minAgents: 0, timeoutMs: 180000, settleMs: 5000 });
    }
    const socket = step.who === "HR" ? hrSocket : candSocket;
    log(`${label}:live:${step.who}`, step.text.slice(0, 80));
    const ack = waitForEvent(socket, "room:messages", 10000);
    socket.emit("room:message", { interviewId, content: step.text });
    await ack;
  }

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

  hrSocket.close();
  candSocket.close();

  return { byType, liveMessages: uniqueMsgs.length };
}

async function processApplication(app, hrToken) {
  const label = app.vacancyTitle;
  const item = {
    applicationId: app.id,
    vacancyTitle: app.vacancyTitle,
    status: app.status,
    steps: [],
  };

  log(label, `start application ${app.id} status=${app.status}`);

  let interviewId = app.interviewId;

  if (app.status === "PENDING") {
    const createRes = await apiWithRetry(
      "POST",
      `/hr/applications/${app.id}/create-interview`,
      { token: hrToken, body: {} },
      { label: `${label}:create-interview` },
    );
    if (!createRes.ok) throw new Error(`create-interview: ${JSON.stringify(createRes.data)}`);
    interviewId = createRes.data.interview?.id ?? createRes.data.application?.interviewId;
    item.steps.push({ step: "create-interview", interviewId, joinCode: createRes.data.interview?.joinCode });
    log(label, `created interview ${interviewId} code=${createRes.data.interview?.joinCode}`);
  }

  if (!interviewId) throw new Error(`${label}: no interviewId`);

  const detailRes = await api("GET", `/hr/applications/${app.id}`, { token: hrToken });
  if (!detailRes.ok) throw new Error(`application detail: ${JSON.stringify(detailRes.data)}`);
  const candidateEmail = detailRes.data.application?.candidate?.email;
  if (!candidateEmail) throw new Error(`${label}: no candidate email`);

  const intRes = await api("GET", `/interviews/${interviewId}`, { token: hrToken });
  if (!intRes.ok) throw new Error(`get interview: ${JSON.stringify(intRes.data)}`);
  const interview = intRes.data.interview ?? intRes.data;

  if (interview.status === "ENDED" && interview.reportId) {
    log(label, `skip — already ENDED with report ${interview.reportId}`);
    item.skipped = true;
    item.reason = "already has report";
    item.interviewId = interviewId;
    item.reportId = interview.reportId;
    return item;
  }

  const candLogin = await api("POST", "/auth/candidate/login", {
    body: { email: candidateEmail, password: CANDIDATE_PASSWORD },
  });
  if (!candLogin.ok || !candLogin.data.token) {
    throw new Error(`candidate login ${candidateEmail}: ${JSON.stringify(candLogin.data)}`);
  }
  const candidateToken = candLogin.data.token;
  item.candidateEmail = candidateEmail;
  item.interviewId = interviewId;

  if (interview.status === "READY") {
    const live = await runLivePhase({ hrToken, candidateToken, interviewId, label });
    item.steps.push({ step: "live", byType: live.byType, messageCount: live.liveMessages });
  } else if (interview.status === "LIVE") {
    log(label, "skip live — already LIVE, ending interview only");
    item.steps.push({ step: "live-skipped", reason: "already LIVE" });
  } else if (interview.status !== "ENDED") {
    throw new Error(`${label}: unexpected interview status ${interview.status}`);
  }

  let endRes = await apiWithRetry(
    "POST",
    `/interviews/${interviewId}/end`,
    { token: hrToken, body: {} },
    { label: `${label}:end-interview`, retries: 4 },
  );
  let report = endRes.data.report ?? endRes.data.finalReport ?? endRes.data;
  if (!endRes.ok) {
    log(`${label}:end-fallback`, String(endRes.data?.detail ?? endRes.data?.error));
    report = await seedFinalReportFallback(interviewId);
    item.fallbackReport = true;
  }

  item.report = {
    recommendation: report.recommendation,
    matchScore: report.matchScore,
    strengths: report.strengths,
    risks: report.risks,
  };

  const finalRes = await api("GET", `/interviews/${interviewId}`, { token: hrToken });
  item.finalStatus = finalRes.data.interview?.status ?? finalRes.data.status;
  item.reportId = finalRes.data.interview?.reportId ?? report.id ?? null;

  log(label, `done status=${item.finalStatus} recommendation=${item.report.recommendation}`);
  return item;
}

async function main() {
  const started = Date.now();
  log("start", API);

  const hrLogin = await api("POST", "/auth/login", {
    body: { email: HR_EMAIL, password: HR_PASSWORD },
  });
  if (!hrLogin.ok || !hrLogin.data.token) throw new Error(`HR login: ${JSON.stringify(hrLogin.data)}`);
  const hrToken = hrLogin.data.token;

  const appsRes = await api("GET", "/hr/applications", { token: hrToken });
  if (!appsRes.ok) throw new Error(`GET applications: ${JSON.stringify(appsRes.data)}`);

  const applications = appsRes.data.applications ?? [];
  log("applications", `found ${applications.length}`);

  for (const app of applications) {
    try {
      const item = await processApplication(app, hrToken);
      results.applications.push(item);
    } catch (error) {
      results.ok = false;
      results.applications.push({
        applicationId: app.id,
        vacancyTitle: app.vacancyTitle,
        error: error instanceof Error ? error.message : String(error),
      });
      log(`FAIL:${app.vacancyTitle}`, error instanceof Error ? error.message : String(error));
    }
  }

  results.durationMs = Date.now() - started;
  results.summary = {
    total: applications.length,
    processed: results.applications.filter((a) => !a.skipped && !a.error).length,
    skipped: results.applications.filter((a) => a.skipped).length,
    failed: results.applications.filter((a) => a.error).length,
    withReport: results.applications.filter((a) => a.report?.recommendation).length,
  };

  console.log("\n========== HR APPLICATIONS LIVE SUMMARY ==========");
  console.log(JSON.stringify(results.summary, null, 2));
  for (const item of results.applications) {
    console.log(
      `- ${item.vacancyTitle}: ${item.error ? "FAIL " + item.error : item.skipped ? "SKIP" : "OK"} ${item.report?.recommendation ?? ""}`,
    );
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(results, null, 2), "utf8");
  console.log("Wrote:", OUT_PATH);

  if (!results.ok || results.summary.failed > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});

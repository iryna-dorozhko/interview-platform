import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const API = "http://localhost:3000/api";
const BASE_URL = "http://localhost:5173";
const JOIN_CODE = "TEST01";
const OUT_DIR = path.resolve("reports/screenshots");
const CHROME =
  "/Users/iruna/interview-platform-1/node_modules/playwright-core/.local-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const CANDIDATE_EMAIL = `candidate-day14-${Date.now()}@test.com`;
const CANDIDATE_PASSWORD = "123456";

async function registerCandidateViaApi() {
  const res = await fetch(`${API}/auth/candidate/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: CANDIDATE_EMAIL,
      password: CANDIDATE_PASSWORD,
      role: "CANDIDATE",
    }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Register failed: ${JSON.stringify(data)}`);
  return data.token;
}

async function finishCandidatePrepViaApi(candidateToken, interviewId) {
  await api(candidateToken, "POST", `/candidate-prep/${interviewId}/finish`);
}
const CANDIDATE_ANSWERS = [
  "3 роки backend, Node.js, PostgreSQL, TypeScript. Працював у FinTech над REST API.",
  "Сильні сторони: архітектура API, тестування. Хочу розвинути публічні виступи.",
  "Ціль — senior-роль у продуктовій команді. Так, можна формувати профіль.",
];

const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf]/;

function isUkrainianAgentReply(text) {
  if (!text || CJK_PATTERN.test(text)) return false;
  const letters = text.replace(/[^a-zA-Zа-яА-ЯіїєґІЇЄҐ]/g, "");
  if (!letters) return false;
  const cyrillicCount = (text.match(/[а-яА-ЯіїєґІЇЄҐ]/g) ?? []).length;
  return cyrillicCount / letters.length >= 0.7;
}

async function api(token, method, pathSuffix, body) {
  const res = await fetch(`${API}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${pathSuffix} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

async function findTestInterview() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const pg = await import("pg");
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const interview = await prisma.interview.findUnique({ where: { joinCode: JOIN_CODE } });
    if (!interview) throw new Error(`Interview with joinCode ${JOIN_CODE} not found`);
    return interview;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function resetTestInterviewCandidate(hrToken, interview) {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const pg = await import("pg");
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const session = await prisma.prepSessionCandidate.findUnique({
      where: { interviewId: interview.id },
    });
    if (session) {
      await prisma.prepMessageCandidate.deleteMany({ where: { sessionId: session.id } });
      await prisma.prepSessionCandidate.delete({ where: { id: session.id } });
    }
    await prisma.candidateProfile.deleteMany({ where: { interviewId: interview.id } });
    await prisma.interview.update({
      where: { id: interview.id },
      data: { candidateUserId: null, status: "AWAITING_CANDIDATE" },
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
  await api(hrToken, "DELETE", `/prep/${interview.vacancyId}`).catch(() => {});
}

async function ensureHrProfileConfirmed(vacancyId) {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const pg = await import("pg");
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    await prisma.companyProfile.upsert({
      where: { vacancyId },
      update: { confirmedAt: new Date() },
      create: {
        vacancyId,
        role: "Senior Backend Developer",
        requirements: ["TypeScript", "Node.js", "PostgreSQL", "4+ роки досвіду"],
        culture: ["remote-first", "code review", "асинхронна комунікація"],
        expectations: ["за 3 місяці закрити 2-3 фічі та покращити CI"],
        confirmedAt: new Date(),
      },
    });
    await prisma.vacancy.update({
      where: { id: vacancyId },
      data: { status: "CONFIRMED" },
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function captureScreenshots(interviewId, candidateToken) {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  // Register via UI for screenshot of fresh dashboard (account pre-created via API)
  await page.goto(`${BASE_URL}/candidate/login`);
  await page.fill('input[type="email"]', CANDIDATE_EMAIL);
  await page.fill('input[type="password"]', CANDIDATE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/candidate");

  await page.waitForSelector('h2:has-text("Огляд")', { timeout: 10_000 });
  const dashboardPath = path.join(OUT_DIR, "day12-candidate-dashboard.png");
  await page.screenshot({ path: dashboardPath, fullPage: true });
  console.log("Saved:", dashboardPath);

  await page.click('button:has-text("Приєднатися до зустрічі")');
  await page.waitForSelector('h2:has-text("Приєднатися до зустрічі")', { timeout: 5_000 });
  const joinModalPath = path.join(OUT_DIR, "day14-join-modal.png");
  await page.screenshot({ path: joinModalPath, fullPage: true });
  console.log("Saved:", joinModalPath);

  await page.fill('input[type="text"]', JOIN_CODE);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".joined-banner", { timeout: 10_000 });

  const joinedPath = path.join(OUT_DIR, "day14-candidate-joined.png");
  await page.screenshot({ path: joinedPath, fullPage: true });
  console.log("Saved:", joinedPath);

  await page.click('button:has-text("Створити профіль")');
  await page.waitForURL(`**/candidate/prep/${interviewId}`);
  await page.waitForSelector(".message.assistant", { timeout: 30_000 });

  const textarea = page.locator("textarea.composer-input");
  for (const answer of CANDIDATE_ANSWERS) {
    await textarea.fill(answer);
    await page.click('button:has-text("Надіслати")');
    await page.waitForTimeout(3000);
  }

  const chatPath = path.join(OUT_DIR, "day12-candidate-prep-chat.png");
  await page.screenshot({ path: chatPath, fullPage: true });
  console.log("Saved:", chatPath);

  console.log("Finishing candidate prep via API…");
  await finishCandidatePrepViaApi(candidateToken, interviewId);
  await page.reload();
  await page.waitForSelector('h2:has-text("Зібраний профіль кандидата")', { timeout: 30_000 });

  const beforeConfirmPath = path.join(OUT_DIR, "day13-candidate-profile-before-confirm.png");
  await page.screenshot({ path: beforeConfirmPath, fullPage: true });
  console.log("Saved:", beforeConfirmPath);

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.click('button:has-text("Підтвердити профіль")');
  await page.waitForSelector(".confirmed-banner", { timeout: 10_000 });

  const confirmedPath = path.join(OUT_DIR, "day13-candidate-profile-confirmed.png");
  await page.screenshot({ path: confirmedPath, fullPage: true });
  console.log("Saved:", confirmedPath);

  await page.click('a[href="/candidate/interview"], nav a:has-text("Співбесіда")');
  await page.waitForURL("**/candidate/interview");
  await page.waitForSelector('strong:has-text("Обидва готові")', { timeout: 10_000 });

  const readyPath = path.join(OUT_DIR, "day14-candidate-ready.png");
  await page.screenshot({ path: readyPath, fullPage: true });
  console.log("Saved:", readyPath);

  await page.click('a[href="/candidate/profile"], nav a:has-text("Моя анкета")');
  await page.waitForURL("**/candidate/profile");
  await page.waitForSelector('h2:has-text("Моя анкета")', { timeout: 10_000 });

  const profilePagePath = path.join(OUT_DIR, "day12-candidate-profile-page.png");
  await page.screenshot({ path: profilePagePath, fullPage: true });
  console.log("Saved:", profilePagePath);

  await browser.close();
  console.log("Candidate test account:", CANDIDATE_EMAIL, CANDIDATE_PASSWORD);
}

async function main() {
  const hrToken = await login("hr@test.com", "123456");
  void hrToken;
  const interview = await findTestInterview();

  console.log("Resetting TEST01 interview for clean demo…");
  await resetTestInterviewCandidate(hrToken, interview);
  console.log("Ensuring HR company profile is confirmed for READY transition…");
  await ensureHrProfileConfirmed(interview.vacancyId);

  const candidateToken = await registerCandidateViaApi();
  await captureScreenshots(interview.id, candidateToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

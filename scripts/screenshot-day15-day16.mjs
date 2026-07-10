import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const API = "http://localhost:3000/api";
const BASE_URL = "http://localhost:5173";
const JOIN_CODE = "TEST01";
const OUT_DIR = path.resolve("reports/screenshots");
const CHROME =
  "/Users/iruna/interview-platform-1/node_modules/playwright-core/.local-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const HR_EMAIL = "hr@test.com";
const HR_PASSWORD = "123456";

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

async function ensureReadyInterview() {
  const { prisma, pool } = await getPrisma();
  try {
    const interview = await prisma.interview.findUnique({
      where: { joinCode: JOIN_CODE },
      include: { candidateProfile: true, liveSession: true },
    });
    if (!interview) throw new Error(`Interview ${JOIN_CODE} not found`);

    await prisma.vacancy.update({
      where: { id: interview.vacancyId },
      data: { status: "CONFIRMED" },
    });
    await prisma.companyProfile.upsert({
      where: { vacancyId: interview.vacancyId },
      update: { confirmedAt: new Date() },
      create: {
        vacancyId: interview.vacancyId,
        role: "Senior Backend Developer",
        requirements: ["TypeScript", "Node.js", "PostgreSQL"],
        culture: ["remote-first", "code review"],
        expectations: ["за 3 місяці закрити 2-3 фічі"],
        confirmedAt: new Date(),
      },
    });

    let candidateUserId = interview.candidateUserId;
    if (!candidateUserId) {
      const email = `live-demo-${Date.now()}@test.com`;
      const reg = await fetch(`${API}/auth/candidate/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "123456", role: "CANDIDATE" }),
      });
      const regData = await reg.json();
      candidateUserId = regData.user?.id ?? regData.id;
      if (!candidateUserId) throw new Error(`Candidate register failed: ${JSON.stringify(regData)}`);
    }

    await prisma.interview.update({
      where: { id: interview.id },
      data: { candidateUserId, status: "READY" },
    });

    await prisma.candidateProfile.upsert({
      where: { interviewId: interview.id },
      update: { confirmedAt: new Date() },
      create: {
        interviewId: interview.id,
        experience: ["3 роки backend"],
        skills: ["TypeScript", "Node.js"],
        goals: ["senior-роль"],
        summary: "Досвідчений backend-розробник",
        confirmedAt: new Date(),
      },
    });

    if (!interview.liveSession) {
      await prisma.liveSession.create({ data: { interviewId: interview.id } });
    }

    const candidate = await prisma.user.findUnique({ where: { id: candidateUserId } });
    return { interview, candidateEmail: candidate?.email ?? "candidate@test.com" };
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function captureHrScreenshots(page, interviewId) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', HR_EMAIL);
  await page.fill('input[type="password"]', HR_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/", { timeout: 10_000 });

  await page.goto(`${BASE_URL}/interviews`);
  await page.waitForSelector('h1:has-text("Співбесіди")', { timeout: 10_000 });
  const listPath = path.join(OUT_DIR, "day15-hr-interviews-list.png");
  await page.screenshot({ path: listPath, fullPage: true });
  console.log("Saved:", listPath);

  await page.click('button:has-text("Створити зустріч")');
  await page.waitForSelector('h2:has-text("Створити зустріч")', { timeout: 5_000 });
  const createModalPath = path.join(OUT_DIR, "day15-hr-create-interview-modal.png");
  await page.screenshot({ path: createModalPath, fullPage: true });
  console.log("Saved:", createModalPath);
  await page.keyboard.press("Escape");

  await page.goto(`${BASE_URL}/interviews/${interviewId}/room`);
  await page.waitForSelector('h1:has-text("Жива кімната")', { timeout: 10_000 });
  const hrRoomPath = path.join(OUT_DIR, "day15-hr-live-room.png");
  await page.screenshot({ path: hrRoomPath, fullPage: true });
  console.log("Saved:", hrRoomPath);
}

async function captureLiveWithArbiter(hrPage, candidatePage, interviewId, candidateEmail) {
  await candidatePage.goto(`${BASE_URL}/candidate/login`);
  await candidatePage.fill('input[type="email"]', candidateEmail);
  await candidatePage.fill('input[type="password"]', "123456");
  await candidatePage.click('button[type="submit"]');
  await candidatePage.waitForURL("**/candidate");

  await candidatePage.goto(`${BASE_URL}/candidate/interview/room`);
  await candidatePage.waitForSelector('h1:has-text("Жива кімната")', { timeout: 15_000 });

  await hrPage.goto(`${BASE_URL}/interviews/${interviewId}/room`);
  await hrPage.waitForSelector('h1:has-text("Жива кімната")', { timeout: 15_000 });
  await hrPage.waitForTimeout(1500);

  const liveBannerPath = path.join(OUT_DIR, "day16-live-room-both-joined.png");
  await hrPage.screenshot({ path: liveBannerPath, fullPage: true });
  console.log("Saved:", liveBannerPath);

  const hrComposer = hrPage.locator("textarea.composer-input");
  await hrComposer.fill("Розкажіть про ваш досвід з TypeScript");
  await hrPage.click('button:has-text("Надіслати")');

  try {
    await hrPage.waitForSelector(".thinking", { timeout: 5000 });
    const thinkingPath = path.join(OUT_DIR, "day16-arbiter-thinking.png");
    await hrPage.screenshot({ path: thinkingPath, fullPage: true });
    console.log("Saved:", thinkingPath);
  } catch {
    console.log("Thinking indicator not captured (timeout)");
  }

  await hrPage.waitForSelector('.message.agent:has-text("Arbiter")', { timeout: 12000 });
  await candidatePage.waitForSelector('.message.agent:has-text("Arbiter")', { timeout: 12000 });

  const arbiterReplyPath = path.join(OUT_DIR, "day16-arbiter-stub-reply.png");
  await hrPage.screenshot({ path: arbiterReplyPath, fullPage: true });
  console.log("Saved:", arbiterReplyPath);

  const candidateReplyPath = path.join(OUT_DIR, "day16-candidate-sees-arbiter.png");
  await candidatePage.screenshot({ path: candidateReplyPath, fullPage: true });
  console.log("Saved:", candidateReplyPath);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const hrToken = await login(HR_EMAIL, HR_PASSWORD);
  void hrToken;

  const { interview, candidateEmail } = await ensureReadyInterview();
  console.log("Using interview:", interview.id, "candidate:", candidateEmail);

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const hrContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const candidateContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const hrPage = await hrContext.newPage();
  const candidatePage = await candidateContext.newPage();

  await captureHrScreenshots(hrPage, interview.id);
  await captureLiveWithArbiter(hrPage, candidatePage, interview.id, candidateEmail);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

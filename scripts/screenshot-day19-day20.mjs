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
      include: { candidateProfile: true, liveSession: true, finalReport: true },
    });
    if (!interview) throw new Error(`Interview ${JOIN_CODE} not found`);

    if (interview.finalReport) {
      await prisma.finalReport.delete({ where: { interviewId: interview.id } });
    }
    await prisma.liveMessage.deleteMany({ where: { session: { interviewId: interview.id } } });

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

async function loginHr(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', HR_EMAIL);
  await page.fill('input[type="password"]', HR_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/", { timeout: 10_000 });
}

async function loginCandidate(page, email) {
  await page.goto(`${BASE_URL}/candidate/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/candidate", { timeout: 10_000 });
}

async function save(page, filename) {
  const filePath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log("Saved:", filePath);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await login(HR_EMAIL, HR_PASSWORD);

  const { interview, candidateEmail } = await ensureReadyInterview();
  console.log("Using interview:", interview.id, "candidate:", candidateEmail);

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const hrContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const candidateContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const hrPage = await hrContext.newPage();
  const candidatePage = await candidateContext.newPage();

  // 1. HR list — кнопка «Увійти в співбесіду» при READY
  await loginHr(hrPage);
  await hrPage.goto(`${BASE_URL}/interviews`);
  await hrPage.waitForSelector('h1:has-text("Співбесіди")', { timeout: 10_000 });
  await hrPage.waitForSelector('button:has-text("Увійти в співбесіду")', { timeout: 10_000 });
  await save(hrPage, "day19-hr-interviews-join-button.png");

  // 2. Кандидат — кнопка «Увійти в співбесіду»
  await loginCandidate(candidatePage, candidateEmail);
  await candidatePage.goto(`${BASE_URL}/candidate/interview`);
  await candidatePage.waitForSelector('button:has-text("Увійти в співбесіду")', { timeout: 10_000 });
  await save(candidatePage, "day19-candidate-join-button.png");

  // 3. Обидва в кімнаті → LIVE, кольорові повідомлення
  await candidatePage.goto(`${BASE_URL}/candidate/interview/room`);
  await candidatePage.waitForSelector('h1:has-text("Жива кімната")', { timeout: 15_000 });

  await hrPage.goto(`${BASE_URL}/interviews/${interview.id}/room`);
  await hrPage.waitForSelector('h1:has-text("Жива кімната")', { timeout: 15_000 });
  await hrPage.waitForTimeout(2000);

  const hrComposer = hrPage.locator("textarea.composer-input");
  await hrComposer.fill("Розкажіть про ваш досвід з TypeScript і Node.js");
  await hrPage.click('button:has-text("Надіслати")');

  const candidateComposer = candidatePage.locator("textarea.composer-input");
  await candidatePage.waitForTimeout(1000);
  await candidateComposer.fill("Маю 3 роки досвіду з TypeScript, працював з Express і Prisma");
  await candidatePage.click('button:has-text("Надіслати")');

  await hrPage.waitForTimeout(4000);
  await save(hrPage, "day19-live-room-hr-colored-messages.png");
  await save(candidatePage, "day19-live-room-candidate-colored-messages.png");

  // 4. Кнопка «Завершити співбесіду» (HR, LIVE)
  await hrPage.waitForSelector('button:has-text("Завершити співбесіду")', { timeout: 10_000 });
  await save(hrPage, "day19-hr-end-interview-button.png");

  // 5. Завершення → фінальний звіт
  hrPage.on("dialog", (dialog) => dialog.accept());
  await hrPage.click('button:has-text("Завершити співбесіду")');
  await hrPage.waitForSelector(".success-banner", { timeout: 120_000 });
  await save(hrPage, "day19-interview-ended-success-banner.png");

  // 6. HR список — рекомендація в колонці «Звіт»
  await hrPage.goto(`${BASE_URL}/interviews`);
  await hrPage.waitForSelector('h1:has-text("Співбесіди")', { timeout: 10_000 });
  await hrPage.waitForSelector("td:has-text('HIRE'), td:has-text('MAYBE'), td:has-text('REJECT')", {
    timeout: 10_000,
  });
  await save(hrPage, "day19-hr-report-recommendation.png");

  await browser.close();
  console.log("Day 19+20 screenshots complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

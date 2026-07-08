import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "http://localhost:5173";
const OUT_DIR = path.resolve("reports/screenshots");
const CHROME =
  "/Users/iruna/interview-platform-1/node_modules/playwright-core/.local-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const CANDIDATE_EMAIL = `candidate-day10-${Date.now()}@test.com`;
const CANDIDATE_PASSWORD = "123456";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  // --- Day 9: HR dashboard ---
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', "hr@test.com");
  await page.fill('input[type="password"]', "123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.waitForSelector(".overview-cards, .dashboard", { timeout: 10_000 }).catch(() =>
    page.waitForSelector("h1", { timeout: 10_000 })
  );

  const day9HomePath = path.join(OUT_DIR, "day9-hr-overview.png");
  await page.screenshot({ path: day9HomePath, fullPage: true });
  console.log("Saved:", day9HomePath);

  await page.click('a[href="/vacancies"], nav a:has-text("Анкети")');
  await page.waitForURL("**/vacancies");
  await page.waitForSelector("table, .vacancy-list, h1", { timeout: 10_000 });

  const day9VacanciesPath = path.join(OUT_DIR, "day9-vacancies-list.png");
  await page.screenshot({ path: day9VacanciesPath, fullPage: true });
  console.log("Saved:", day9VacanciesPath);

  await page.click('a[href="/interviews"], nav a:has-text("Співбесіди")');
  await page.waitForURL("**/interviews");
  await page.waitForSelector("table, .interview-list, h1", { timeout: 10_000 });

  const day9InterviewsPath = path.join(OUT_DIR, "day9-interviews-list.png");
  await page.screenshot({ path: day9InterviewsPath, fullPage: true });
  console.log("Saved:", day9InterviewsPath);

  await page.click('button:has-text("Вийти")');
  await page.waitForURL("**/login");

  // --- Day 10: Candidate auth ---
  const day10RegisterPath = path.join(OUT_DIR, "day10-candidate-register.png");
  await page.goto(`${BASE_URL}/candidate/register`);
  await page.waitForSelector('h1:has-text("Реєстрація кандидата")');
  await page.screenshot({ path: day10RegisterPath, fullPage: true });
  console.log("Saved:", day10RegisterPath);

  await page.fill('input[type="email"]', CANDIDATE_EMAIL);
  await page.fill('input[type="password"]', CANDIDATE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/candidate");

  const day10HomePath = path.join(OUT_DIR, "day10-candidate-home.png");
  await page.waitForSelector('h1:has-text("Кабінет кандидата")');
  await page.screenshot({ path: day10HomePath, fullPage: true });
  console.log("Saved:", day10HomePath);

  await page.click('button:has-text("Вийти")');
  await page.waitForURL("**/candidate/login");

  const day10LoginPath = path.join(OUT_DIR, "day10-candidate-login.png");
  await page.waitForSelector('h1:has-text("Вхід кандидата")');
  await page.screenshot({ path: day10LoginPath, fullPage: true });
  console.log("Saved:", day10LoginPath);

  await page.fill('input[type="email"]', CANDIDATE_EMAIL);
  await page.fill('input[type="password"]', CANDIDATE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/candidate");

  // Role isolation: HR account on candidate login
  await page.click('button:has-text("Вийти")');
  await page.waitForURL("**/candidate/login");
  await page.fill('input[type="email"]', "hr@test.com");
  await page.fill('input[type="password"]', "123456");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".error", { timeout: 5_000 });

  const day10RoleBlockPath = path.join(OUT_DIR, "day10-hr-blocked-on-candidate-login.png");
  await page.screenshot({ path: day10RoleBlockPath, fullPage: true });
  console.log("Saved:", day10RoleBlockPath);

  await browser.close();
  console.log("Candidate test account:", CANDIDATE_EMAIL, CANDIDATE_PASSWORD);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

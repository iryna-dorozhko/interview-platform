/**
 * Live headed browser walkthrough — visible Chromium window for manual observation.
 */
import { chromium } from "playwright";

const UI = "http://localhost:5173";
const HR_EMAIL = "hr@test.com";
const HR_PASSWORD = "123456";
const PAUSE_MS = 2500;

const CHROME =
  "/Users/iruna/interview-platform-1/node_modules/playwright-core/.local-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

async function pause(page, label) {
  console.log(`→ ${label}`);
  await page.waitForTimeout(PAUSE_MS);
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 400,
    executablePath: CHROME,
    args: ["--start-maximized"],
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  console.log("Відкриваю HR login…");
  await page.goto(`${UI}/login`);
  await pause(page, "Сторінка входу HR");

  await page.getByLabel("Email").fill(HR_EMAIL);
  await page.getByLabel("Пароль").fill(HR_PASSWORD);
  await pause(page, "Заповнено email і пароль");

  await page.getByRole("button", { name: "Увійти" }).click();
  await page.waitForURL(/\/(?!login)/, { timeout: 15_000 });
  await pause(page, "Увійшли як HR — домашня сторінка");

  const appsLink = page.getByRole("link", { name: /заявк|applications|inbox/i }).first();
  if (await appsLink.isVisible().catch(() => false)) {
    await appsLink.click();
    await pause(page, "Inbox заявок HR");
  }

  const vacanciesLink = page.getByRole("link", { name: /ваканс|vacanc/i }).first();
  if (await vacanciesLink.isVisible().catch(() => false)) {
    await vacanciesLink.click();
    await pause(page, "Список вакансій");
  }

  console.log("Переходжу на candidate login…");
  await page.goto(`${UI}/candidate/login`);
  await pause(page, "Сторінка входу кандидата");

  const candidateLink = page.getByRole("link", { name: /реєстр|register|створити/i }).first();
  if (await candidateLink.isVisible().catch(() => false)) {
    await candidateLink.click();
    await pause(page, "Реєстрація кандидата");
  }

  console.log("Live walkthrough завершено. Браузер залишається відкритим 2 хв — дивіться на екран.");
  await page.waitForTimeout(120_000);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

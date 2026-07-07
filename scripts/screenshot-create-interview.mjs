import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "http://localhost:5173";
const OUT_DIR = path.resolve("reports/screenshots");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Users/iruna/interview-platform-1/node_modules/playwright-core/.local-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', "hr@test.com");
  await page.fill('input[type="password"]', "123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.waitForSelector('button:has-text("Створити співбесіду")');

  await page.click('button:has-text("Створити співбесіду")');
  await page.waitForSelector(".created-banner", { timeout: 10_000 });

  const firstCode = (await page.locator(".created-code").textContent())?.trim();
  console.log("First created code:", firstCode);

  const bannerPath = path.join(OUT_DIR, "day8-create-interview-banner.png");
  await page.screenshot({ path: bannerPath, fullPage: true });
  console.log("Saved banner screenshot:", bannerPath);

  await page.click('button:has-text("Створити співбесіду")');
  await page.waitForFunction(
    (prevCode) => document.querySelector(".created-code")?.textContent?.trim() !== prevCode,
    firstCode,
    { timeout: 10_000 }
  );
  const secondCode = (await page.locator(".created-code").textContent())?.trim();
  console.log("Second created code:", secondCode);

  if (secondCode === firstCode) {
    throw new Error(`Expected a different code on second click, got the same: ${secondCode}`);
  }

  await page.click('button:has-text("Перейти до анкети")');
  await page.waitForURL("**/prep/**");
  await page.waitForSelector(".message.assistant, .message-text", { timeout: 90_000 });

  const prepPath = path.join(OUT_DIR, "day8-navigated-to-prep.png");
  await page.screenshot({ path: prepPath, fullPage: true });
  console.log("Saved prep-navigation screenshot:", prepPath);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

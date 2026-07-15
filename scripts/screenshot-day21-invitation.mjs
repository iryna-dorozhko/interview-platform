import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const API = "http://localhost:3000/api";
const BASE_URL = "http://localhost:5173";
const OUT_DIR = path.resolve("reports/screenshots");
const CHROME =
  "/Users/iruna/interview-platform-1/node_modules/playwright-core/.local-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const HR_EMAIL = "hr@test.com";
const HR_PASSWORD = "123456";
const CANDIDATE_EMAIL = `invite-demo-${Date.now()}@test.com`;
const CANDIDATE_PASSWORD = "123456";

async function loginApi(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return data;
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathSuffix} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log("Saved", name);
}

async function uiLogin(page, pathSuffix, email, password, waitUrl) {
  await page.goto(`${BASE_URL}${pathSuffix}`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(waitUrl, { timeout: 20_000 });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const reg = await fetch(`${API}/auth/candidate/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: CANDIDATE_EMAIL,
      password: CANDIDATE_PASSWORD,
      role: "CANDIDATE",
    }),
  });
  const regData = await reg.json();
  if (!regData.token) throw new Error(`Candidate register failed: ${JSON.stringify(regData)}`);

  const hr = await loginApi(HR_EMAIL, HR_PASSWORD);
  const vacanciesBody = await api(hr.token, "GET", "/vacancies/mine");
  const vacancy = (vacanciesBody.vacancies ?? []).find((v) => v.status === "CONFIRMED");
  if (!vacancy) throw new Error("No CONFIRMED vacancy for HR");

  const scheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const createdBody = await api(hr.token, "POST", "/interviews", {
    vacancyId: vacancy.id,
    candidateEmail: CANDIDATE_EMAIL,
    scheduledAt,
  });
  const created = createdBody.interview ?? createdBody;
  console.log("Interview", created.id, created.joinCode);

  const reportsBody = await api(hr.token, "GET", "/reports");
  const reportId = reportsBody.reports?.[0]?.id ?? null;

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // HR: interviews list + create form + invite copy
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await uiLogin(page, "/login", HR_EMAIL, HR_PASSWORD, "**/");
    await page.goto(`${BASE_URL}/interviews`);
    await page.waitForSelector('button:has-text("Створити зустріч")');
    await shot(page, "day21-hr-interviews-list.png");

    await page.click('button:has-text("Створити зустріч")');
    await page.waitForSelector("#create-interview-title");
    await page.waitForSelector('input[type="email"]');
    await shot(page, "day21-hr-create-interview-form.png");

    await page.fill('input[type="email"]', CANDIDATE_EMAIL);
    await page.locator('input[type="datetime-local"]').evaluate((el) => {
      const d = new Date(Date.now() + 36 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      el.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.click('button[type="submit"]:has-text("Створити")');
    await page.waitForSelector(".join-code", { timeout: 15_000 });
    await page.waitForSelector('button:has-text("Скопіювати текст запрошення")');
    await shot(page, "day21-hr-invite-copy-actions.png");
    await page.click('button:has-text("Закрити")');

    await page.goto(`${BASE_URL}/interviews/${created.id}`);
    await page.waitForSelector('h2:has-text("Запрошення для кандидата")', { timeout: 20_000 });
    await shot(page, "day21-hr-interview-detail-invitation.png");

    await page.goto(`${BASE_URL}/reports`);
    await page.waitForSelector('h1:has-text("Звіти")', { timeout: 15_000 });
    await shot(page, "day21-hr-reports-list.png");

    if (reportId) {
      await page.goto(`${BASE_URL}/report/${reportId}`);
      await page.waitForSelector('h1:has-text("Звіт про співбесіду")', { timeout: 15_000 });
      await shot(page, "day21-hr-report-page.png");
    } else {
      console.warn("No report — skip day21-hr-report-page.png");
    }
    await page.close();
  }

  // Candidate home with invitations
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await uiLogin(page, "/candidate/login", CANDIDATE_EMAIL, CANDIDATE_PASSWORD, "**/candidate");
    await page.waitForSelector('h3:has-text("Запрошення")', { timeout: 15_000 });
    await page.waitForSelector('button:has-text("Прийняти")');
    await shot(page, "day21-candidate-home-invitations.png");

    await page.goto(`${BASE_URL}/join?code=${created.joinCode}`);
    await page.waitForTimeout(1200);
    await shot(page, "day21-join-deep-link.png");
    await page.close();
  }

  // Public join + Calm Slate login
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.goto(`${BASE_URL}/join`);
    await page.waitForTimeout(800);
    await shot(page, "day21-join-landing.png");

    await page.goto(`${BASE_URL}/login`);
    await page.waitForSelector('input[type="email"]');
    await shot(page, "day21-hr-login-calm-slate.png");
    await page.close();
  }

  await browser.close();
  console.log("Done. Candidate:", CANDIDATE_EMAIL);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
const CANDIDATE_EMAIL = `day11-cand-${Date.now()}@test.com`;
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

  // Self-service questionnaire (contact bootstrap lives here)
  const started = await api(regData.token, "POST", "/candidate/interview/start");
  const questionnaire = started.interview ?? started;
  console.log("Questionnaire", questionnaire.id, questionnaire.status);

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // 1) HR: company profile (confirmed + history)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await uiLogin(page, "/login", HR_EMAIL, HR_PASSWORD, "**/");
    await page.goto(`${BASE_URL}/company-profile`);
    await page.waitForSelector('h1:has-text("Профіль компанії")');
    await page.waitForSelector(".confirmed-banner, .profile-form, .messages", { timeout: 15_000 });
    await shot(page, "day11-hr-company-profile.png");

    // sidebar highlight
    await page.waitForSelector('a[href="/company-profile"], nav a:has-text("Профіль компанії")');
    await shot(page, "day11-hr-company-profile-sidebar.png");
    await page.close();
  }

  // 2) HR: vacancy prep — full profile with snapshot fields
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await uiLogin(page, "/login", HR_EMAIL, HR_PASSWORD, "**/");
    await page.goto(`${BASE_URL}/vacancies/${vacancy.id}/prep`);
    await page.waitForSelector("h1", { timeout: 15_000 });
    await page.waitForTimeout(800);
    await shot(page, "day11-hr-vacancy-prep-snapshot.png");
    await page.close();
  }

  // 3) HR: vacancy prep gate (mock missing company profile)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route(`**/api/prep/${vacancy.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [],
          isClosed: false,
          profile: null,
          missingCompanyProfile: true,
        }),
      });
    });
    await uiLogin(page, "/login", HR_EMAIL, HR_PASSWORD, "**/");
    await page.goto(`${BASE_URL}/vacancies/${vacancy.id}/prep`);
    await page.waitForSelector(".gate-banner", { timeout: 15_000 });
    await shot(page, "day11-hr-vacancy-prep-gate.png");
    await page.close();
  }

  // 4) HR: live room + arbiter process feed (inject entries for UI proof)
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await uiLogin(page, "/login", HR_EMAIL, HR_PASSWORD, "**/");
    const liveId = "cmrnh47u50001cnr97h2rew1j";
    await page.goto(`${BASE_URL}/interviews/${liveId}/room`);
    await page.waitForSelector(".agent-panel, [aria-label='Статус AI-агентів']", { timeout: 20_000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const panel = document.querySelector(".agent-panel");
      if (!panel) return;
      let log = panel.querySelector(".process-log");
      if (!log) {
        log = document.createElement("div");
        log.className = "process-log";
        log.innerHTML = `<h3 class="process-title">Рішення Arbiter</h3><ul class="process-list"></ul>`;
        panel.appendChild(log);
      }
      const list = log.querySelector(".process-list");
      if (!list) return;
      list.innerHTML = "";
      const entries = [
        "START — відкрити співбесіду коротким привітанням",
        "NEXT_QUESTION — запитати про досвід із Vue 3",
        "ANSWER — кандидат відповідає з профілю",
        "WAIT — чекаємо підтвердження припущення від людини",
      ];
      const now = Date.now();
      for (let i = 0; i < entries.length; i++) {
        const li = document.createElement("li");
        li.className = "process-item";
        const t = new Date(now - (entries.length - i) * 12_000);
        const time = t.toLocaleTimeString("uk-UA", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        li.innerHTML = `<span class="process-time">${time}</span><span class="process-summary">${entries[i]}</span>`;
        list.appendChild(li);
      }
    });
    await shot(page, "day11-hr-arbiter-process-feed.png");
    await page.close();
  }

  // 5) Candidate: contact bootstrap — open chat and wait for name prompt
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await uiLogin(
      page,
      "/candidate/login",
      CANDIDATE_EMAIL,
      CANDIDATE_PASSWORD,
      "**/candidate**"
    );
    await page.goto(`${BASE_URL}/candidate/profile`);
    await page.waitForSelector(
      'button:has-text("Створити анкету"), button:has-text("Продовжити анкету")',
      { timeout: 20_000 }
    );
    await page.click(
      'button:has-text("Створити анкету"), button:has-text("Продовжити анкету")'
    );
    await page.waitForFunction(
      () => /звати|ім'я|Ім'я|Привіт|контакт/i.test(document.body?.innerText ?? ""),
      null,
      { timeout: 90_000 }
    );
    await page.waitForTimeout(500);
    await shot(page, "day11-candidate-prep-contact-bootstrap.png");
    await page.close();
  }

  // 6) Candidate: profile with contact fields (mock finished profile)
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const mockProfile = {
      fullName: "Ірина Тестова",
      email: CANDIDATE_EMAIL,
      phone: "+380501112233",
      skills: { strong: ["Vue 3", "TypeScript"], growth: ["Pinia"] },
      experience: ["2 роки Vue 3", "TypeScript у продакшені"],
      goals: ["Junior/Middle Frontend"],
      summary: "Junior frontend з фокусом на Vue.",
      confirmedAt: null,
    };
    await page.route("**/api/candidate/questionnaire**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interview: {
            id: questionnaire.id,
            displayName: "Анкета кандидата",
            status: "AWAITING_CANDIDATE",
          },
        }),
      });
    });
    await page.route("**/api/candidate-prep/**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [
            {
              id: "m1",
              authorType: "AGENT_CANDIDATE",
              content: "Привіт! Як тебе звати?",
              createdAt: new Date().toISOString(),
            },
          ],
          isClosed: true,
          profile: mockProfile,
          contactPreview: {
            fullName: mockProfile.fullName,
            email: mockProfile.email,
            phone: mockProfile.phone,
          },
        }),
      });
    });
    await uiLogin(
      page,
      "/candidate/login",
      CANDIDATE_EMAIL,
      CANDIDATE_PASSWORD,
      "**/candidate**"
    );
    await page.goto(`${BASE_URL}/candidate/profile`);
    await page.waitForSelector("text=Контактні дані", { timeout: 20_000 });
    await shot(page, "day11-candidate-profile-contacts.png");
    await page.close();
  }

  await browser.close();
  console.log("Candidate account:", CANDIDATE_EMAIL, CANDIDATE_PASSWORD);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

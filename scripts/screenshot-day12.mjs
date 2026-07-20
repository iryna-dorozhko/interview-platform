import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const API = "http://localhost:3000/api";
/** Worktree frontend with vacancy-match UI */
const MATCH_UI = "http://localhost:5174";
/** Main frontend (deep prep already on main) */
const MAIN_UI = "http://localhost:5173";
const OUT_DIR = path.resolve("reports/screenshots");
const CHROME =
  "/Users/iruna/interview-platform-1/node_modules/playwright-core/.local-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const HR_EMAIL = "hr@test.com";
const HR_PASSWORD = "123456";
const CANDIDATE_EMAIL = `day12-cand-${Date.now()}@test.com`;
const CANDIDATE_PASSWORD = "123456";

const MOCK_APP = {
  id: "app-day12-1",
  vacancyId: "vac-day12-1",
  vacancyTitle: "Junior Frontend Engineer",
  matchScore: 87,
  candidateSummary:
    "Кандидат з ~2 роками Vue 3/TypeScript, шукає remote full-time. Сильні сторони — компоненти та TypeScript; зона росту — Pinia. Очікування: remote, від $1800 net, повний день, без релокації.",
  status: "PENDING",
  interviewId: null,
  createdAt: new Date().toISOString(),
  candidate: {
    fullName: "Ірина Тестова",
    email: CANDIDATE_EMAIL,
  },
};

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

async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log("Saved", name);
}

async function uiLogin(page, base, pathSuffix, email, password, waitUrl) {
  await page.goto(`${base}${pathSuffix}`);
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
  console.log("Registered", CANDIDATE_EMAIL);

  // Ensure HR login works (auth via main backend through proxy)
  await loginApi(HR_EMAIL, HR_PASSWORD);

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // 1) Deep prep: chat showing work-conditions block
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const started = await fetch(`${API}/candidate/interview/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${regData.token}`,
        "Content-Type": "application/json",
      },
    });
    const startedBody = await started.json();
    const interview = startedBody.interview ?? startedBody;

    await page.route("**/api/candidate/questionnaire**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interview: {
            id: interview.id,
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
              content:
                "Дякую, Ірино. Тепер про умови роботи: який формат тобі підходить — офіс, гібрид чи remote?",
              createdAt: new Date(Date.now() - 120_000).toISOString(),
            },
            {
              id: "m2",
              authorType: "HUMAN_CANDIDATE",
              content: "Remote, інколи можу заїхати в офіс 1 день на тиждень.",
              createdAt: new Date(Date.now() - 90_000).toISOString(),
            },
            {
              id: "m3",
              authorType: "AGENT_CANDIDATE",
              content:
                "Зрозуміло. Які зарплатні очікування — діапазон або мінімум, і в якій валюті?",
              createdAt: new Date(Date.now() - 60_000).toISOString(),
            },
            {
              id: "m4",
              authorType: "HUMAN_CANDIDATE",
              content: "Від 1800 доларів net.",
              createdAt: new Date(Date.now() - 30_000).toISOString(),
            },
            {
              id: "m5",
              authorType: "AGENT_CANDIDATE",
              content:
                "Дякую. Який графік тобі зручний — повний день, part-time чи гнучкий?",
              createdAt: new Date().toISOString(),
            },
          ],
          isClosed: false,
          profile: null,
          contactPreview: null,
        }),
      });
    });

    await uiLogin(
      page,
      MAIN_UI,
      "/candidate/login",
      CANDIDATE_EMAIL,
      CANDIDATE_PASSWORD,
      "**/candidate**"
    );
    await page.goto(`${MAIN_UI}/candidate/prep/${interview.id}`);
    await page.waitForSelector("text=умови роботи", { timeout: 20_000 });
    await page.waitForTimeout(400);
    await shot(page, "day12-candidate-prep-work-conditions.png");
    await page.close();
  }

  // 2) Profile with work-condition prefixes in goals
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const mockProfile = {
      fullName: "Ірина Тестова",
      email: CANDIDATE_EMAIL,
      phone: "+380501112233",
      skills: { strong: ["Vue 3", "TypeScript"], growth: ["Pinia"] },
      experience: ["2 роки Vue 3", "TypeScript у продакшені"],
      goals: [
        "Формат: remote (1 день офіс за потреби)",
        "Зарплата: від $1800 net",
        "Графік: повний день",
        "Релокація: не вказано",
        "Junior/Middle Frontend у продуктових командах",
      ],
      summary: "Junior frontend з фокусом на Vue; шукає remote full-time.",
      confirmedAt: new Date().toISOString(),
    };
    await page.route("**/api/candidate/questionnaire**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interview: {
            id: "q-day12",
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
              content: "Дякую за відповіді. Анкету зібрано — перевір і підтвердь профіль.",
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
      MAIN_UI,
      "/candidate/login",
      CANDIDATE_EMAIL,
      CANDIDATE_PASSWORD,
      "**/candidate**"
    );
    await page.goto(`${MAIN_UI}/candidate/profile`);
    await page.waitForSelector("text=Підтверджено", { timeout: 20_000 });
    await page.waitForSelector("text=Зарплата:", { timeout: 10_000 });
    await shot(page, "day12-candidate-profile-work-conditions.png");
    await page.close();
  }

  // 3) Candidate matches — offer card (worktree UI)
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.route("**/api/candidate/applications/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ application: null }),
      });
    });
    await page.route("**/api/candidate/matches/next", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          vacancyId: MOCK_APP.vacancyId,
          title: MOCK_APP.vacancyTitle,
          matchScore: MOCK_APP.matchScore,
        }),
      });
    });
    await uiLogin(
      page,
      MATCH_UI,
      "/candidate/login",
      CANDIDATE_EMAIL,
      CANDIDATE_PASSWORD,
      "**/candidate**"
    );
    await page.goto(`${MATCH_UI}/candidate/matches`);
    await page.waitForSelector("text=Відповідність:", { timeout: 20_000 });
    await page.waitForSelector("text=Прийняти");
    await shot(page, "day12-candidate-matches-offer.png");
    await page.close();
  }

  // 4) Candidate matches — pending after accept
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.route("**/api/candidate/applications/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          application: {
            id: MOCK_APP.id,
            vacancyId: MOCK_APP.vacancyId,
            matchScore: MOCK_APP.matchScore,
            status: "PENDING",
            vacancyTitle: MOCK_APP.vacancyTitle,
          },
        }),
      });
    });
    await uiLogin(
      page,
      MATCH_UI,
      "/candidate/login",
      CANDIDATE_EMAIL,
      CANDIDATE_PASSWORD,
      "**/candidate**"
    );
    await page.goto(`${MATCH_UI}/candidate/matches`);
    await page.waitForSelector("text=Очікуйте відповіді HR", { timeout: 20_000 });
    await shot(page, "day12-candidate-matches-pending.png");
    await page.close();
  }

  // 5) Candidate home — «Підібрати вакансію» CTA
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.route("**/api/candidate/questionnaire**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interview: {
            id: "q-day12-home",
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
              content: "Анкета готова.",
              createdAt: new Date().toISOString(),
            },
          ],
          isClosed: true,
          profile: {
            fullName: "Ірина Тестова",
            email: CANDIDATE_EMAIL,
            phone: "+380501112233",
            skills: { strong: ["Vue 3"], growth: ["Pinia"] },
            experience: ["2 роки Vue 3"],
            goals: ["Формат: remote", "Зарплата: від $1800 net"],
            summary: "Junior frontend",
            confirmedAt: new Date().toISOString(),
          },
          contactPreview: {
            fullName: "Ірина Тестова",
            email: CANDIDATE_EMAIL,
            phone: "+380501112233",
          },
        }),
      });
    });
    await page.route("**/api/candidate/interview**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ interview: null }),
      });
    });
    await page.route("**/api/candidate/invitations**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invitations: [] }),
      });
    });
    await uiLogin(
      page,
      MATCH_UI,
      "/candidate/login",
      CANDIDATE_EMAIL,
      CANDIDATE_PASSWORD,
      "**/candidate**"
    );
    await page.goto(`${MATCH_UI}/candidate`);
    await page.waitForSelector('button:has-text("Підібрати вакансію")', {
      timeout: 20_000,
    });
    await shot(page, "day12-candidate-home-match-cta.png");
    await page.close();
  }

  // 6) HR applications inbox + detail + create interview
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("**/api/hr/notifications**", async (route) => {
      const url = route.request().url();
      if (url.includes("/read")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            notification: {
              id: "n1",
              type: "VACANCY_APPLICATION",
              payload: {},
              readAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [
            {
              id: "n1",
              type: "VACANCY_APPLICATION",
              payload: {
                applicationId: MOCK_APP.id,
                candidateName: MOCK_APP.candidate.fullName,
                email: MOCK_APP.candidate.email,
                vacancyTitle: MOCK_APP.vacancyTitle,
                matchScore: MOCK_APP.matchScore,
              },
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });
    await page.route("**/api/hr/applications/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ application: MOCK_APP }),
      });
    });
    await page.route("**/api/hr/applications", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          applications: [
            {
              id: MOCK_APP.id,
              vacancyId: MOCK_APP.vacancyId,
              vacancyTitle: MOCK_APP.vacancyTitle,
              matchScore: MOCK_APP.matchScore,
              candidateSummary: MOCK_APP.candidateSummary,
              status: MOCK_APP.status,
              interviewId: null,
              createdAt: MOCK_APP.createdAt,
            },
          ],
        }),
      });
    });

    await uiLogin(page, MATCH_UI, "/login", HR_EMAIL, HR_PASSWORD, "**/");
    await page.goto(`${MATCH_UI}/applications`);
    await page.waitForSelector("text=Заявки кандидатів", { timeout: 20_000 });
    await page.waitForSelector("text=Створити співбесіду", { timeout: 20_000 });
    await shot(page, "day12-hr-applications-inbox.png");

    // sidebar highlight
    await page.waitForSelector('a[href="/applications"], nav a:has-text("Заявки")');
    await shot(page, "day12-hr-applications-sidebar.png");
    await page.close();
  }

  // 7) HR home — link to applications
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route("**/api/hr/notifications**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [
            {
              id: "n1",
              type: "VACANCY_APPLICATION",
              payload: {
                applicationId: MOCK_APP.id,
                candidateName: MOCK_APP.candidate.fullName,
                email: MOCK_APP.candidate.email,
                vacancyTitle: MOCK_APP.vacancyTitle,
                matchScore: MOCK_APP.matchScore,
              },
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });
    await page.route("**/api/vacancies/mine**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ vacancies: [] }),
      });
    });
    await page.route("**/api/interviews**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ interviews: [] }),
      });
    });
    await uiLogin(page, MATCH_UI, "/login", HR_EMAIL, HR_PASSWORD, "**/");
    await page.goto(`${MATCH_UI}/`);
    await page.waitForSelector('a:has-text("Заявки кандидатів")', { timeout: 20_000 });
    await shot(page, "day12-hr-home-applications-link.png");
    await context.close();
  }

  await browser.close();
  console.log("Candidate account:", CANDIDATE_EMAIL, CANDIDATE_PASSWORD);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

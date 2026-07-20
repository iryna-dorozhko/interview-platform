/**
 * Recreate HR vacancies through full prep chat flow:
 * - delete interviews/vacancies
 * - create vacancy
 * - prep chat with agent
 * - finish + confirm
 */
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const API = process.env.API_BASE ?? "http://localhost:3000/api";
const HR_EMAIL = "hr@test.com";
const HR_PASSWORD = "123456";

const VACANCIES = [
  {
    title: "Middle Backend Developer",
    answers: [
      "Шукаємо Middle Backend Developer у продуктову команду платіжного сервісу. Людина працюватиме над API для B2B-клієнтів у команді з backend/frontend/QA.",
      "Обов'язково: TypeScript, Node.js, PostgreSQL, досвід із REST API від трьох років. Бажано: Docker, базове розуміння AWS, досвід із мікросервісами.",
      "Культура: remote-first, відкритий фідбек, code review, відповідальність за сервіс. Синхронні зустрічі двічі на тиждень, решта асинхронно в Slack.",
      "Перший місяць — онбординг із ментором. До третього місяця очікуємо самостійне ведення одного мікросервісу та участь у плануванні.",
    ],
  },
  {
    title: "Senior Frontend Developer (React)",
    answers: [
      "Шукаємо Senior Frontend Developer (React) у продуктову команду. Основна зона відповідальності — frontend-архітектура ключового модуля.",
      "Вимоги: React 18+, TypeScript, досвід зі state management (Redux або Zustand), 5+ років комерційної розробки, тестування через Vitest/Playwright.",
      "Культура: тісна співпраця з дизайном та продуктом, підтримка design system, регулярні архітектурні обговорення, парне програмування за потреби.",
      "Очікуємо, що людина менторить middle-розробників, веде технічні рішення у модулі та підвищує якість і швидкість релізів.",
    ],
  },
  {
    title: "QA Engineer",
    answers: [
      "Шукаємо QA Engineer у web-продуктову команду. Роль включає ручне й автоматизоване тестування функціоналу перед релізами.",
      "Вимоги: досвід у web-продуктах від двох років, Playwright або Cypress, базове API-тестування, вміння писати та підтримувати тестові сценарії.",
      "Культура: shift-left, раннє залучення QA до задач, співпраця з dev/product/design, прозора комунікація ризиків якості.",
      "Очікування: володіння регресією, підтримка e2e-набору в CI, системне покриття критичних user-flow та контроль стабільності релізів.",
    ],
  },
  {
    title: "DevOps Engineer",
    answers: [
      "Шукаємо DevOps Engineer для підтримки та розвитку production-інфраструктури SaaS-продукту.",
      "Вимоги: Kubernetes, Docker, CI/CD (GitHub Actions), досвід з AWS або GCP, Terraform, моніторинг через Grafana/Prometheus.",
      "Культура: infrastructure as code, on-call ротація, blameless postmortems, автоматизація повторюваних операцій і фокус на reliability.",
      "Очікування: стабільна робота production, оптимізація cloud-витрат, покращення observability і швидкості delivery pipeline.",
    ],
  },
  {
    title: "Product Manager",
    answers: [
      "Шукаємо Product Manager у B2B SaaS. Роль відповідає за продуктовий цикл від discovery до delivery і результат у ключових метриках.",
      "Вимоги: 3+ роки product-ролі в B2B SaaS, досвід із backlog/roadmap, аналітика retention/conversion, англійська на рівні upper-intermediate.",
      "Культура: data-driven рішення, регулярне customer discovery, партнерство з engineering/design/sales і прозора пріоритезація.",
      "Очікування: формування квартальних пріоритетів, якісні product-spec, проведення демо стейкхолдерам і контроль impact після релізу.",
    ],
  },
];

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function short(text, max = 140) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function getPrisma() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }), pool };
}

async function purgeVacancyRelations(vacancyId) {
  const { prisma, pool } = await getPrisma();
  try {
    const interviews = await prisma.interview.findMany({
      where: { vacancyId },
      select: { id: true },
    });
    const interviewIds = interviews.map((item) => item.id);

    if (interviewIds.length > 0) {
      const liveSessions = await prisma.liveSession.findMany({
        where: { interviewId: { in: interviewIds } },
        select: { id: true },
      });
      const liveSessionIds = liveSessions.map((item) => item.id);

      const prepSessions = await prisma.prepSessionCandidate.findMany({
        where: { interviewId: { in: interviewIds } },
        select: { id: true },
      });
      const prepSessionIds = prepSessions.map((item) => item.id);

      if (liveSessionIds.length > 0) {
        await prisma.liveMessage.deleteMany({ where: { sessionId: { in: liveSessionIds } } });
      }
      if (prepSessionIds.length > 0) {
        await prisma.prepMessageCandidate.deleteMany({ where: { sessionId: { in: prepSessionIds } } });
      }
      await prisma.finalReport.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await prisma.candidateProfile.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await prisma.prepSessionCandidate.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await prisma.liveSession.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await prisma.invitation.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await prisma.vacancyApplication.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await prisma.interview.deleteMany({ where: { id: { in: interviewIds } } });
    }

    await prisma.hrNotification.deleteMany({
      where: {
        type: "VACANCY_APPLICATION",
        payload: { path: ["vacancyId"], equals: vacancyId },
      },
    });
    await prisma.vacancyApplication.deleteMany({ where: { vacancyId } });
    await prisma.vacancyOfferDecision.deleteMany({ where: { vacancyId } });
    await prisma.vacancyMatchScore.deleteMany({ where: { vacancyId } });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function ensureDeepCompanyProfile(token) {
  const state = await api("GET", "/company-prep", { token });
  if (!state.ok) {
    throw new Error(`GET /company-prep failed: ${JSON.stringify(state.data)}`);
  }
  if (state.data?.profile?.confirmedAt) {
    console.log("company-prep: already confirmed, reuse existing deep profile");
    return;
  }

  const answers = [
    "Наша культура: прямий фідбек, ownership і відповідальність за результат. Працюємо remote-first, але підтримуємо регулярні синхронізації та ретро.",
    "Напрям компанії: B2B SaaS для автоматизації рекрутингу, фокус на швидкості найму й якості підбору. Стратегія — масштабувати продукт на ринки ЄС.",
    "Політики: прозора комунікація, security-by-default, code review як обов'язковий етап, документування рішень у Notion/ADR.",
    "Формат роботи: гнучкий графік із core hours 11:00–17:00, remote-first, офлайн-зустрічі за потреби. Відпустки плануються завчасно.",
    "Онбординг: 30-60-90 план, ментор на перші 2 місяці, щотижневі check-in, технічні й продуктові матеріали в onboarding wiki.",
  ];

  let first = await api("POST", "/company-prep/message", { token, body: {} });
  if (!first.ok) throw new Error(`company-prep greeting failed: ${JSON.stringify(first.data)}`);
  console.log(`company-prep agent: ${short(first.data.message)}`);

  let ready = Boolean(first.data.readyForConfirmation);
  for (const answer of answers) {
    const res = await api("POST", "/company-prep/message", { token, body: { message: answer } });
    if (!res.ok) throw new Error(`company-prep message failed: ${JSON.stringify(res.data)}`);
    ready = Boolean(res.data.readyForConfirmation);
    console.log(`company-prep agent: ready=${ready} ${short(res.data.message)}`);
  }
  if (!ready) {
    const extra = await api("POST", "/company-prep/message", {
      token,
      body: {
        message:
          "Додатково: очікуємо проактивність, системне мислення та здатність ефективно працювати в кросфункціональних командах.",
      },
    });
    if (!extra.ok) throw new Error(`company-prep extra failed: ${JSON.stringify(extra.data)}`);
  }

  const finish = await api("POST", "/company-prep/finish", { token, body: {} });
  if (!finish.ok) throw new Error(`company-prep finish failed: ${JSON.stringify(finish.data)}`);
  const confirm = await api("POST", "/company-prep/confirm", { token, body: {} });
  if (!confirm.ok) throw new Error(`company-prep confirm failed: ${JSON.stringify(confirm.data)}`);
  console.log("company-prep: confirmed");
}

async function deleteAllInterviews(token) {
  const list = await api("GET", "/interviews/mine", { token });
  if (!list.ok) throw new Error(`GET /interviews/mine failed: ${JSON.stringify(list.data)}`);
  const interviews = list.data.interviews ?? [];
  for (const item of interviews) {
    const del = await api("DELETE", `/interviews/${item.id}`, { token });
    if (!del.ok) {
      throw new Error(`delete interview ${item.id} failed: ${JSON.stringify(del.data)}`);
    }
    console.log(`deleted interview: ${item.id}`);
  }
}

async function deleteAllVacancies(token) {
  const list = await api("GET", "/vacancies/mine", { token });
  if (!list.ok) throw new Error(`GET /vacancies/mine failed: ${JSON.stringify(list.data)}`);
  const vacancies = list.data.vacancies ?? [];
  for (const item of vacancies) {
    let del = await api("DELETE", `/vacancies/${item.id}`, { token });
    if (!del.ok && del.status === 409) {
      console.log(`vacancy ${item.id}: has linked interviews, purging dependencies`);
      await purgeVacancyRelations(item.id);
      del = await api("DELETE", `/vacancies/${item.id}`, { token });
    }
    if (!del.ok) {
      throw new Error(`delete vacancy ${item.id} failed: ${JSON.stringify(del.data)}`);
    }
    console.log(`deleted vacancy: ${item.title} (${item.id})`);
  }
}

async function runVacancyPrep(token, vacancyId, answers) {
  let first = await api("POST", `/prep/${vacancyId}/message`, { token, body: {} });
  if (!first.ok) throw new Error(`prep greeting failed: ${JSON.stringify(first.data)}`);
  console.log(`prep agent: ${short(first.data.message)}`);

  let ready = Boolean(first.data.readyForConfirmation);
  for (const answer of answers) {
    const res = await api("POST", `/prep/${vacancyId}/message`, {
      token,
      body: { message: answer },
    });
    if (!res.ok) throw new Error(`prep message failed: ${JSON.stringify(res.data)}`);
    ready = Boolean(res.data.readyForConfirmation);
    console.log(`prep agent: ready=${ready} ${short(res.data.message)}`);
  }

  if (!ready) {
    const extra = await api("POST", `/prep/${vacancyId}/message`, {
      token,
      body: {
        message:
          "Додатково: потрібна людина, яка вміє аргументувати технічні рішення, ефективно комунікує та самостійно доводить задачі до результату.",
      },
    });
    if (!extra.ok) throw new Error(`prep extra failed: ${JSON.stringify(extra.data)}`);
  }

  const finish = await api("POST", `/prep/${vacancyId}/finish`, { token, body: {} });
  if (!finish.ok) throw new Error(`prep finish failed: ${JSON.stringify(finish.data)}`);

  const confirm = await api("POST", `/prep/${vacancyId}/confirm`, { token, body: {} });
  if (!confirm.ok) throw new Error(`prep confirm failed: ${JSON.stringify(confirm.data)}`);
}

async function main() {
  const login = await api("POST", "/auth/login", {
    body: { email: HR_EMAIL, password: HR_PASSWORD },
  });
  if (!login.ok || !login.data.token) {
    throw new Error(`HR login failed: ${JSON.stringify(login.data)}`);
  }
  const token = login.data.token;
  console.log("HR login: ok");

  await ensureDeepCompanyProfile(token);
  await deleteAllInterviews(token);
  await deleteAllVacancies(token);

  const created = [];
  for (const spec of VACANCIES) {
    const create = await api("POST", "/vacancies", {
      token,
      body: { title: spec.title },
    });
    if (!create.ok) {
      throw new Error(`create ${spec.title}: ${JSON.stringify(create.data)}`);
    }
    const vacancyId = create.data.vacancy.id;
    console.log(`created: ${spec.title} (${vacancyId})`);

    await runVacancyPrep(token, vacancyId, spec.answers);
    const detail = await api("GET", `/vacancies/${vacancyId}`, { token });
    if (!detail.ok) {
      throw new Error(`detail ${spec.title}: ${JSON.stringify(detail.data)}`);
    }
    const vacancy = detail.data.vacancy;
    console.log(`confirmed: ${vacancy.title} [${vacancy.status}]`);
    created.push(vacancy);
  }

  console.log("\n=== Підсумок ===");
  for (const v of created) {
    if (v) {
      console.log(`- ${v.title} (${v.status}) id=${v.id}`);
      console.log("  prep: finished via agent chat, profile confirmed");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

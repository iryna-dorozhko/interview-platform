import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const API = "http://localhost:3000/api";
const BASE_URL = "http://localhost:5173";
const INTERVIEW_ID = "cmr949qn80001vdr97g7k1475";
const OUT_DIR = path.resolve("reports/screenshots");

const ANSWERS = [
  "Шукаємо Senior Backend Developer у продуктову команду платформи співбесід. Команда з 5 розробників, рівень — senior.",
  "Обов'язково: TypeScript, Node.js, PostgreSQL, REST API, 4+ роки комерційного досвіду. Бажано: Docker, Redis, досвід з LLM-інтеграціями.",
  "Культура: remote-first, асинхронна комунікація, code review обов'язковий, щотижневі демо. Формат — повністю віддалено, офісу немає.",
  "У перші 3 місяці очікуємо: розібратися в кодовій базі, закрити 2–3 фічі в prep-модулі, налаштувати CI для нових сервісів і провести онбординг для junior-розробника.",
  "Так, усе вірно — можна формувати профіль.",
];

const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const CYRILLIC_PATTERN = /[а-яА-ЯіїєґІЇЄҐ]/;

function isUkrainianAgentReply(text) {
  if (!text || CJK_PATTERN.test(text)) return false;
  const letters = text.replace(/[^a-zA-Zа-яА-ЯіїєґІЇЄҐ]/g, "");
  if (!letters) return false;
  const cyrillicCount = (text.match(/[а-яА-ЯіїєґІЇЄҐ]/g) ?? []).length;
  return cyrillicCount / letters.length >= 0.7;
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Login failed: ${JSON.stringify(data)}`);
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

async function sendMessage(token, message) {
  const body = message === undefined ? {} : { message };
  return api(token, "POST", `/prep/${INTERVIEW_ID}/message`, body);
}

async function runConversation(token) {
  await api(token, "DELETE", `/prep/${INTERVIEW_ID}`);

  const greeting = await sendMessage(token);
  if (!isUkrainianAgentReply(greeting.message)) {
    throw new Error(`Non-Ukrainian greeting: ${greeting.message?.slice(0, 120)}`);
  }

  for (const answer of ANSWERS) {
    const reply = await sendMessage(token, answer);
    if (!isUkrainianAgentReply(reply.message)) {
      throw new Error(`Non-Ukrainian reply: ${reply.message?.slice(0, 120)}`);
    }
  }

  return api(token, "POST", `/prep/${INTERVIEW_ID}/finish`);
}

async function completePrepViaApi(maxAttempts = 5) {
  const token = await login();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`API conversation attempt ${attempt}/${maxAttempts}…`);
      const result = await runConversation(token);
      console.log("Conversation completed, profile role:", result.profile?.role);
      return token;
    } catch (error) {
      console.warn(`Attempt ${attempt} failed:`, error instanceof Error ? error.message : error);
      await api(token, "DELETE", `/prep/${INTERVIEW_ID}`).catch(() => {});
      if (attempt === maxAttempts) throw error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  throw new Error("Unreachable");
}

async function captureScreenshots() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', "hr@test.com");
  await page.fill('input[type="password"]', "123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.goto(`${BASE_URL}/prep/${INTERVIEW_ID}`);
  await page.waitForSelector("h2:has-text('Зібраний профіль вакансії')", { timeout: 30_000 });

  const beforeConfirmPath = path.join(OUT_DIR, "day7-profile-before-confirm.png");
  await page.screenshot({ path: beforeConfirmPath, fullPage: true });
  console.log("Saved before-confirm screenshot:", beforeConfirmPath);

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.click('button:has-text("Підтвердити профіль")');
  await page.waitForSelector(".confirmed-banner", { timeout: 10_000 });
  await page.waitForFunction(() => {
    const deleteButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Видалити чат"
    );
    return deleteButton ? deleteButton.hasAttribute("disabled") : false;
  });

  const afterConfirmPath = path.join(OUT_DIR, "day7-profile-confirmed.png");
  await page.screenshot({ path: afterConfirmPath, fullPage: true });
  console.log("Saved confirmed screenshot:", afterConfirmPath);

  if (process.env.SKIP_CHAT_SCREENSHOTS !== "1") {
    await page.click('button:has-text("Назад до чату")');
    await page.waitForSelector(".message.assistant", { timeout: 10_000 });

    const agentTexts = await page.locator(".message.assistant .message-text").allTextContents();
    const bad = agentTexts.filter((t) => !isUkrainianAgentReply(t));
    if (bad.length > 0) {
      await browser.close();
      throw new Error(`UI still has non-Ukrainian agent messages: ${bad[0].slice(0, 80)}`);
    }

    const chatPath = path.join(OUT_DIR, "prep-chat.png");
    await page.screenshot({ path: chatPath, fullPage: true });
    console.log("Saved chat screenshot:", chatPath);

    await page.click('button:has-text("Показати профіль")');
    await page.waitForSelector("h2:has-text('Зібраний профіль вакансії')", { timeout: 10_000 });

    const profilePath = path.join(OUT_DIR, "prep-profile.png");
    await page.screenshot({ path: profilePath, fullPage: true });
    console.log("Saved profile screenshot:", profilePath);
  }

  await browser.close();
}

async function main() {
  if (process.env.SKIP_PREP_CONVERSATION !== "1") {
    await completePrepViaApi();
  }
  await captureScreenshots();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

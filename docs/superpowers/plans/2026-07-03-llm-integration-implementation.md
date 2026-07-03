# Day 2 LLM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати плагінований LLM-шар (omlx локально + Gemini зовні), тестовий endpoint `POST /api/llm/complete` і CLI `npm run llm:test` для DoD Дня 2.

**Architecture:** Інтерфейс `LlmProvider` з двома реалізаціями: `OmlxProvider` (fetch → OpenAI-compatible `/v1/chat/completions`) і `GeminiProvider` (`@google/generative-ai`). Factory читає `LLM_PROVIDER` з env. Express router приймає `message` або `messages`, делегує провайдеру, повертає `{ text, provider }`.

**Tech Stack:** Express 4, TypeScript, node:test, tsx, `@google/generative-ai`, omlx (окремий процес на хості).

**Spec:** `docs/superpowers/specs/2026-07-03-llm-integration-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/llm/types.ts` | `ChatMessage`, `LlmProvider`, `LlmConfig` types |
| `backend/src/llm/errors.ts` | `LlmError` hierarchy for HTTP mapping |
| `backend/src/llm/omlx.provider.ts` | OpenAI-compatible fetch client for omlx |
| `backend/src/llm/omlx.provider.test.ts` | Unit tests with mocked `fetch` |
| `backend/src/llm/gemini.provider.ts` | Google Generative AI SDK wrapper |
| `backend/src/llm/factory.ts` | `createLlmProvider()` from env |
| `backend/src/llm/factory.test.ts` | Factory env selection tests |
| `backend/src/routes/llm.ts` | `POST /llm/complete` router |
| `backend/src/routes/llm.test.ts` | Route unit tests with fake provider |
| `backend/scripts/llm-test.ts` | CLI smoke test |
| `backend/src/server.ts` | Mount LLM router |
| `backend/package.json` | Add dep + scripts |
| `backend/.env.example` | LLM env vars |
| `README.md` | Day 2 section update |

---

### Task 1: LLM types and errors

**Files:**
- Create: `backend/src/llm/types.ts`
- Create: `backend/src/llm/errors.ts`

- [ ] **Step 1: Create types**

Create `backend/src/llm/types.ts`:

```typescript
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface LlmEnvConfig {
  provider: "omlx" | "gemini";
  omlxBaseUrl: string;
  omlxModel: string;
  geminiApiKey?: string;
  geminiModel: string;
}
```

- [ ] **Step 2: Create error classes**

Create `backend/src/llm/errors.ts`:

```typescript
export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "empty_response" | "invalid_request"
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export class LlmUnavailableError extends LlmError {
  constructor(message: string) {
    super(message, "unavailable");
    this.name = "LlmUnavailableError";
  }
}

export class LlmEmptyResponseError extends LlmError {
  constructor(message = "empty response from LLM") {
    super(message, "empty_response");
    this.name = "LlmEmptyResponseError";
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm --workspace backend run lint`  
Expected: PASS (no new errors beyond existing baseline).

- [ ] **Step 4: Commit**

```bash
git add backend/src/llm/types.ts backend/src/llm/errors.ts
git commit -m "feat(backend): add LLM types and error classes"
```

---

### Task 2: OmlxProvider with tests

**Files:**
- Create: `backend/src/llm/omlx.provider.ts`
- Create: `backend/src/llm/omlx.provider.test.ts`
- Modify: `backend/package.json` (add test file to `test` script)

- [ ] **Step 1: Write the failing test**

Create `backend/src/llm/omlx.provider.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { createOmlxProvider } from "./omlx.provider";
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("createOmlxProvider returns assistant content from chat completions", async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Привіт!" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const provider = createOmlxProvider({
    baseUrl: "http://127.0.0.1:8000",
    model: "Qwen2.5-7B-Instruct-4bit",
  });

  const text = await provider.complete([{ role: "user", content: "Hi" }]);

  assert.equal(text, "Привіт!");
  assert.equal(provider.name, "omlx");
});

test("createOmlxProvider throws LlmEmptyResponseError when content missing", async () => {
  global.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const provider = createOmlxProvider({
    baseUrl: "http://127.0.0.1:8000",
    model: "Qwen2.5-7B-Instruct-4bit",
  });

  await assert.rejects(
    () => provider.complete([{ role: "user", content: "Hi" }]),
    LlmEmptyResponseError
  );
});

test("createOmlxProvider throws LlmUnavailableError on connection failure", async () => {
  global.fetch = async () => {
    throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };

  const provider = createOmlxProvider({
    baseUrl: "http://127.0.0.1:8000",
    model: "Qwen2.5-7B-Instruct-4bit",
  });

  await assert.rejects(
    () => provider.complete([{ role: "user", content: "Hi" }]),
    (err: unknown) => err instanceof LlmUnavailableError
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run test -- src/llm/omlx.provider.test.ts`  
Expected: FAIL — `createOmlxProvider` not found.

- [ ] **Step 3: Implement OmlxProvider**

Create `backend/src/llm/omlx.provider.ts`:

```typescript
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";
import type { ChatMessage, LlmProvider } from "./types";

const REQUEST_TIMEOUT_MS = 120_000;

type OmlxConfig = {
  baseUrl: string;
  model: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export function createOmlxProvider(config: OmlxConfig): LlmProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  return {
    name: "omlx",

    async complete(messages: ChatMessage[]): Promise<string> {
      const url = `${baseUrl}/v1/chat/completions`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: false,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const causeCode =
          typeof error === "object" &&
          error !== null &&
          "cause" in error &&
          typeof (error as { cause?: { code?: string } }).cause?.code === "string"
            ? (error as { cause: { code: string } }).cause.code
            : undefined;

        if (causeCode === "ECONNREFUSED" || detail.includes("ECONNREFUSED")) {
          throw new LlmUnavailableError(
            `omlx server not reachable at ${baseUrl}`
          );
        }

        if (error instanceof Error && error.name === "TimeoutError") {
          throw new LlmUnavailableError("LLM request timed out");
        }

        throw new LlmUnavailableError(detail);
      }

      if (!response.ok) {
        const body = await response.text();
        throw new LlmUnavailableError(
          `omlx request failed (${response.status}): ${body}`
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new LlmEmptyResponseError();
      }

      return content;
    },
  };
}
```

- [ ] **Step 4: Add test file to package.json test script**

In `backend/package.json`, append to the `test` script:

```
src/llm/omlx.provider.test.ts
```

- [ ] **Step 5: Run tests**

Run: `npm --workspace backend run test -- src/llm/omlx.provider.test.ts`  
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/llm/omlx.provider.ts backend/src/llm/omlx.provider.test.ts backend/package.json
git commit -m "feat(backend): add OmlxProvider with unit tests"
```

---

### Task 3: GeminiProvider

**Files:**
- Create: `backend/src/llm/gemini.provider.ts`
- Modify: `backend/package.json` (add `@google/generative-ai`)

- [ ] **Step 1: Install dependency**

Run: `npm install @google/generative-ai --workspace backend`

- [ ] **Step 2: Implement GeminiProvider**

Create `backend/src/llm/gemini.provider.ts`:

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { LlmEmptyResponseError } from "./errors";
import type { ChatMessage, LlmProvider } from "./types";

type GeminiConfig = {
  apiKey: string;
  model: string;
};

export function createGeminiProvider(config: GeminiConfig): LlmProvider {
  return {
    name: "gemini",

    async complete(messages: ChatMessage[]): Promise<string> {
      if (messages.length === 0) {
        throw new Error("at least one message required");
      }

      const systemInstruction = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n");

      const chatMessages = messages.filter((message) => message.role !== "system");

      if (chatMessages.length === 0) {
        throw new Error("at least one user or assistant message required");
      }

      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage.role !== "user") {
        throw new Error("last message must be from user");
      }

      const genAI = new GoogleGenerativeAI(config.apiKey);
      const model = genAI.getGenerativeModel({
        model: config.model,
        ...(systemInstruction ? { systemInstruction } : {}),
      });

      const history = chatMessages.slice(0, -1).map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage.content);
      const text = result.response.text().trim();

      if (!text) {
        throw new LlmEmptyResponseError();
      }

      return text;
    },
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm --workspace backend run lint`  
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/llm/gemini.provider.ts backend/package.json package-lock.json
git commit -m "feat(backend): add GeminiProvider"
```

---

### Task 4: Factory with tests

**Files:**
- Create: `backend/src/llm/factory.ts`
- Create: `backend/src/llm/factory.test.ts`
- Modify: `backend/package.json` (add test file)

- [ ] **Step 1: Write the failing test**

Create `backend/src/llm/factory.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { createLlmProvider, readLlmEnvConfig } from "./factory";

test("readLlmEnvConfig defaults to omlx", () => {
  const config = readLlmEnvConfig({
    LLM_PROVIDER: undefined,
    OMLX_BASE_URL: undefined,
    OMLX_MODEL: undefined,
    GEMINI_API_KEY: undefined,
    GEMINI_MODEL: undefined,
  });

  assert.equal(config.provider, "omlx");
  assert.equal(config.omlxBaseUrl, "http://127.0.0.1:8000");
  assert.equal(config.omlxModel, "Qwen2.5-7B-Instruct-4bit");
  assert.equal(config.geminiModel, "gemini-2.0-flash");
});

test("createLlmProvider returns omlx provider by default", () => {
  const provider = createLlmProvider({
    LLM_PROVIDER: "omlx",
    OMLX_BASE_URL: "http://127.0.0.1:8000",
    OMLX_MODEL: "Qwen2.5-7B-Instruct-4bit",
  });

  assert.equal(provider.name, "omlx");
});

test("createLlmProvider throws when gemini selected without API key", () => {
  assert.throws(
    () =>
      createLlmProvider({
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: undefined,
      }),
    /GEMINI_API_KEY is required/
  );
});

test("createLlmProvider returns gemini provider when configured", () => {
  const provider = createLlmProvider({
    LLM_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "gemini-2.0-flash",
  });

  assert.equal(provider.name, "gemini");
});

test("createLlmProvider throws on unknown provider", () => {
  assert.throws(
    () =>
      createLlmProvider({
        LLM_PROVIDER: "ollama",
      }),
    /LLM_PROVIDER must be one of: omlx, gemini/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run test -- src/llm/factory.test.ts`  
Expected: FAIL — module not found.

- [ ] **Step 3: Implement factory**

Create `backend/src/llm/factory.ts`:

```typescript
import { createGeminiProvider } from "./gemini.provider";
import { createOmlxProvider } from "./omlx.provider";
import type { LlmEnvConfig, LlmProvider } from "./types";

type EnvSource = Record<string, string | undefined>;

const ALLOWED_PROVIDERS = ["omlx", "gemini"] as const;

export function readLlmEnvConfig(env: EnvSource = process.env): LlmEnvConfig {
  const providerRaw = (env.LLM_PROVIDER ?? "omlx").toLowerCase();

  if (!ALLOWED_PROVIDERS.includes(providerRaw as (typeof ALLOWED_PROVIDERS)[number])) {
    throw new Error(`LLM_PROVIDER must be one of: ${ALLOWED_PROVIDERS.join(", ")}`);
  }

  return {
    provider: providerRaw as LlmEnvConfig["provider"],
    omlxBaseUrl: env.OMLX_BASE_URL ?? "http://127.0.0.1:8000",
    omlxModel: env.OMLX_MODEL ?? "Qwen2.5-7B-Instruct-4bit",
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? "gemini-2.0-flash",
  };
}

export function createLlmProvider(env: EnvSource = process.env): LlmProvider {
  const config = readLlmEnvConfig(env);

  if (config.provider === "gemini") {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
    }

    return createGeminiProvider({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
    });
  }

  return createOmlxProvider({
    baseUrl: config.omlxBaseUrl,
    model: config.omlxModel,
  });
}
```

- [ ] **Step 4: Add test file to package.json and run tests**

Run: `npm --workspace backend run test -- src/llm/factory.test.ts`  
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/factory.ts backend/src/llm/factory.test.ts backend/package.json
git commit -m "feat(backend): add LLM provider factory with tests"
```

---

### Task 5: LLM route with tests

**Files:**
- Create: `backend/src/routes/llm.ts`
- Create: `backend/src/routes/llm.test.ts`
- Modify: `backend/package.json` (add test file)

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/llm.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createLlmRouter, normalizeLlmMessages } from "./llm";
import { LlmUnavailableError } from "../llm/errors";
import type { ChatMessage, LlmProvider } from "../llm/types";

test("normalizeLlmMessages wraps single message string", () => {
  const messages = normalizeLlmMessages({ message: "Привіт" });
  assert.deepEqual(messages, [{ role: "user", content: "Привіт" }]);
});

test("normalizeLlmMessages accepts messages array", () => {
  const input: ChatMessage[] = [{ role: "user", content: "Hi" }];
  const messages = normalizeLlmMessages({ messages: input });
  assert.deepEqual(messages, input);
});

test("normalizeLlmMessages returns null when input invalid", () => {
  assert.equal(normalizeLlmMessages({}), null);
  assert.equal(normalizeLlmMessages({ message: "" }), null);
});

test("POST /llm/complete returns text from provider", async () => {
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Відповідь";
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", createLlmRouter(() => fakeProvider));

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/llm/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { text: "Відповідь", provider: "omlx" });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("POST /llm/complete returns 503 when provider unavailable", async () => {
  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      throw new LlmUnavailableError("omlx server not reachable");
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", createLlmRouter(() => fakeProvider));

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/llm/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "LLM unavailable");
    assert.match(body.detail, /not reachable/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace backend run test -- src/routes/llm.test.ts`  
Expected: FAIL — module not found.

- [ ] **Step 3: Implement route**

Create `backend/src/routes/llm.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import { LlmError, LlmUnavailableError } from "../llm/errors";
import type { ChatMessage, LlmProvider } from "../llm/types";

type CompleteBody = {
  message?: unknown;
  messages?: unknown;
};

export function normalizeLlmMessages(body: CompleteBody): ChatMessage[] | null {
  if (typeof body.message === "string" && body.message.trim()) {
    return [{ role: "user", content: body.message.trim() }];
  }

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const messages: ChatMessage[] = [];
    for (const item of body.messages) {
      if (
        typeof item === "object" &&
        item !== null &&
        (item as ChatMessage).role &&
        typeof (item as ChatMessage).content === "string"
      ) {
        const role = (item as ChatMessage).role;
        if (role === "system" || role === "user" || role === "assistant") {
          messages.push({
            role,
            content: (item as ChatMessage).content.trim(),
          });
        }
      }
    }
    return messages.length > 0 ? messages : null;
  }

  return null;
}

export function createLlmRouter(getProvider: () => LlmProvider): Router {
  const router = Router();

  router.post("/llm/complete", async (req: Request, res: Response) => {
    const messages = normalizeLlmMessages(req.body ?? {});

    if (!messages) {
      res.status(400).json({ error: "message or messages required" });
      return;
    }

    let provider: LlmProvider;
    try {
      provider = getProvider();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[llm] provider init failed:", detail);
      res.status(503).json({ error: "LLM unavailable", detail });
      return;
    }

    try {
      const text = await provider.complete(messages);
      res.status(200).json({ text, provider: provider.name });
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        console.error(`[llm:${provider.name}] unavailable:`, error.message);
        res.status(503).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      if (error instanceof LlmError && error.code === "empty_response") {
        console.error(`[llm:${provider.name}] empty response`);
        res.status(502).json({ error: "LLM unavailable", detail: error.message });
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[llm:${provider.name}] unexpected error:`, detail);
      res.status(503).json({ error: "LLM unavailable", detail });
    }
  });

  return router;
}
```

- [ ] **Step 4: Add test file to package.json and run tests**

Run: `npm --workspace backend run test -- src/routes/llm.test.ts`  
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/llm.ts backend/src/routes/llm.test.ts backend/package.json
git commit -m "feat(backend): add POST /api/llm/complete route"
```

---

### Task 6: Wire server, env example, CLI script

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `backend/.env.example`
- Create: `backend/scripts/llm-test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Mount router in server**

Update `backend/src/server.ts`:

```typescript
import "dotenv/config";
import cors from "cors";
import express from "express";
import { prisma } from "./db/prisma";
import { createLlmProvider } from "./llm/factory";
import { createHealthRouter } from "./routes/health";
import { createLlmRouter } from "./routes/llm";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json());

app.use("/api", createHealthRouter(() => prisma));
app.use("/api", createLlmRouter(() => createLlmProvider()));

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
```

- [ ] **Step 2: Update .env.example**

Append to `backend/.env.example`:

```
# LLM (Day 2)
LLM_PROVIDER=omlx
OMLX_BASE_URL=http://127.0.0.1:8000
OMLX_MODEL=Qwen2.5-7B-Instruct-4bit
# GEMINI_API_KEY=
# GEMINI_MODEL=gemini-2.0-flash
```

- [ ] **Step 3: Create CLI script**

Create `backend/scripts/llm-test.ts`:

```typescript
import "dotenv/config";
import { createLlmProvider } from "../src/llm/factory";

function readMessageArg(): string {
  const messageIndex = process.argv.indexOf("--message");
  if (messageIndex !== -1 && process.argv[messageIndex + 1]) {
    return process.argv[messageIndex + 1];
  }
  return "Скажи одне речення українською.";
}

async function main(): Promise<void> {
  const message = readMessageArg();
  const provider = createLlmProvider();

  console.log(`Provider: ${provider.name}`);
  console.log(`Prompt: ${message}`);

  const text = await provider.complete([{ role: "user", content: message }]);
  console.log(`Response: ${text}`);
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`LLM test failed: ${detail}`);
  process.exit(1);
});
```

- [ ] **Step 4: Add llm:test script to package.json**

In `backend/package.json` scripts:

```json
"llm:test": "tsx scripts/llm-test.ts"
```

- [ ] **Step 5: Verify build and all tests**

Run:
```bash
npm --workspace backend run lint
npm --workspace backend run test
npm --workspace backend run build
npm run build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/server.ts backend/.env.example backend/scripts/llm-test.ts backend/package.json
git commit -m "feat(backend): wire LLM router, env vars, and llm:test script"
```

---

### Task 7: README Day 2 documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace Day 2 section**

In `README.md`, update the Day 2 block (`## День 2 — Підключення AI`) to:

```markdown
## День 2 — Підключення AI

**Задача:** навчити сервер розмовляти з локальною моделлю (omlx) або Gemini.

**Що робиш:**
- Запускаєш omlx: `omlx serve --port 8000` (модель `Qwen2.5-7B-Instruct-4bit` у `~/.omlx/models`)
- Backend викликає `POST /api/llm/complete` через плагінований `LlmProvider`
- Перевірка: curl або `npm run llm:test --workspace backend`

**Definition of Done:**
- [ ] Демонстрація: тестовий endpoint або скрипт повертає текст від LLM
- [ ] Сценарій: curl/Postman на LLM endpoint — осмислена відповідь українською або англійською
- [ ] Збірка: `npm run build` проходить
- [ ] README: env-змінні, запуск omlx, приклад curl

### LLM Quick Start (Day 2)

**1. Запустити omlx (окремий термінал):**

```bash
omlx serve --port 8000
```

**2. Налаштувати env** (`backend/.env`):

```
LLM_PROVIDER=omlx
OMLX_BASE_URL=http://127.0.0.1:8000
OMLX_MODEL=Qwen2.5-7B-Instruct-4bit
```

Для Gemini:

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.0-flash
```

**3. Перевірка endpoint:**

```bash
curl -X POST http://localhost:3000/api/llm/complete \
  -H "Content-Type: application/json" \
  -d '{"message":"Привіт! Скажи одне речення українською."}'
```

Очікувана відповідь:

```json
{"text":"...","provider":"omlx"}
```

**4. Перевірка CLI:**

```bash
npm run llm:test --workspace backend
npm run llm:test --workspace backend -- --message "Hello"
```
```

Also update later README references from `OLLAMA_*` to `OMLX_*` / `GEMINI_*` only if they appear in Day 2 scope (leave Day 22 LiteLLM section unchanged for now).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for Day 2 LLM integration (omlx + Gemini)"
```

---

### Task 8: Manual integration verification

**Files:** none (verification only)

- [ ] **Step 1: Start omlx**

Run in separate terminal:

```bash
omlx serve --port 8000
```

Expected: server listening on `127.0.0.1:8000`.

- [ ] **Step 2: Run CLI test**

Run:

```bash
npm run llm:test --workspace backend
```

Expected: stdout shows `Provider: omlx` and a Ukrainian sentence response.

- [ ] **Step 3: Run endpoint test**

With `npm run dev` running:

```bash
curl -X POST http://localhost:3000/api/llm/complete \
  -H "Content-Type: application/json" \
  -d '{"message":"Привіт!"}'
```

Expected: HTTP 200 with `{ "text": "...", "provider": "omlx" }`.

- [ ] **Step 4: Final test suite and build**

Run:

```bash
npm --workspace backend run test
npm run build
```

Expected: all PASS.

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| `LlmProvider` interface | Task 1 |
| `omlx` provider (OpenAI-compatible) | Task 2 |
| `gemini` provider (SDK) | Task 3 |
| Factory `LLM_PROVIDER=omlx\|gemini` | Task 4 |
| `POST /api/llm/complete` | Task 5 |
| Error handling (503, 502, 400) | Task 5 |
| CLI `llm:test` script | Task 6 |
| Env vars in `.env.example` | Task 6 |
| README Day 2 docs | Task 7 |
| Manual integration verification | Task 8 |

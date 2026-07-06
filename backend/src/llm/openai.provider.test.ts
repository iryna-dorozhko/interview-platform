import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiProvider } from "./openai.provider";
import { LlmEmptyResponseError, LlmUnavailableError } from "./errors";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("createOpenAiProvider returns assistant content from chat completions", async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Привіт!" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const provider = createOpenAiProvider({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-test",
  });

  const text = await provider.complete([{ role: "user", content: "Hi" }]);

  assert.equal(text, "Привіт!");
  assert.equal(provider.name, "openai");
});

test("createOpenAiProvider sends Authorization header", async () => {
  let authHeader: string | null = null;
  let requestUrl: string | null = null;

  global.fetch = async (url, init) => {
    requestUrl = String(url);
    const headers = init?.headers as Record<string, string> | undefined;
    authHeader = headers?.Authorization ?? null;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const provider = createOpenAiProvider({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-secret",
  });

  await provider.complete([{ role: "user", content: "Hi" }]);
  assert.equal(authHeader, "Bearer sk-secret");
  assert.equal(requestUrl, "https://api.openai.com/v1/chat/completions");
});

test("createOpenAiProvider throws LlmEmptyResponseError when content missing", async () => {
  global.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const provider = createOpenAiProvider({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-test",
  });

  await assert.rejects(
    () => provider.complete([{ role: "user", content: "Hi" }]),
    LlmEmptyResponseError
  );
});

test("createOpenAiProvider throws LlmUnavailableError on HTTP error", async () => {
  global.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_api_key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  const provider = createOpenAiProvider({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-bad",
  });

  await assert.rejects(
    () => provider.complete([{ role: "user", content: "Hi" }]),
    (err: unknown) => err instanceof LlmUnavailableError
  );
});

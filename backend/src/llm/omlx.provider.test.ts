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

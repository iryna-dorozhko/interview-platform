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

test("createLlmProvider throws when openai selected without API key", () => {
  assert.throws(
    () =>
      createLlmProvider({
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: undefined,
      }),
    /OPENAI_API_KEY is required/
  );
});

test("createLlmProvider returns openai provider when configured", () => {
  const provider = createLlmProvider({
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "gpt-4o-mini",
  });

  assert.equal(provider.name, "openai");
});

test("createLlmProvider returns cursor-acp without an API key", () => {
  const provider = createLlmProvider({
    LLM_PROVIDER: "cursor-acp",
    CURSOR_ACP_CWD: "/tmp/cursor-acp-test",
  });

  assert.equal(provider.name, "cursor-acp");
  assert.equal(typeof provider.close, "function");
});

test("createLlmProvider does not cache cursor-acp instances", () => {
  const env = {
    LLM_PROVIDER: "cursor-acp",
    CURSOR_ACP_CWD: "/tmp/cursor-acp-test",
  };

  assert.notEqual(createLlmProvider(env), createLlmProvider(env));
});

test("createLlmProvider throws on unknown provider", () => {
  assert.throws(
    () =>
      createLlmProvider({
        LLM_PROVIDER: "ollama",
      }),
    /LLM_PROVIDER must be one of: omlx, gemini, openai, cursor-acp/
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requireAuth, requireHr } from "../auth/middleware";
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

test("POST /llm/complete returns 401 without auth when middleware applied", async () => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";

  const fakeProvider: LlmProvider = {
    name: "omlx",
    async complete() {
      return "Відповідь";
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth, requireHr, createLlmRouter(() => fakeProvider));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/llm/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "Unauthorized");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

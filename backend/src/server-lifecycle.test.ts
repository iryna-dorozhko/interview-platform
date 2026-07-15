import test from "node:test";
import assert from "node:assert/strict";
import { createGracefulShutdown } from "./server-lifecycle";

test("graceful shutdown is idempotent and closes resources in safe phases", async () => {
  const calls: string[] = [];
  let resolveHttp!: () => void;
  const httpClosed = new Promise<void>((resolve) => {
    resolveHttp = resolve;
  });

  const shutdown = createGracefulShutdown({
    stopHttp: () => {
      calls.push("http");
      return httpClosed;
    },
    closeSocketIo: async () => {
      calls.push("socket");
      resolveHttp();
    },
    closeOrchestrator: () => {
      calls.push("orchestrator");
    },
    closeLlm: async () => {
      calls.push("llm");
    },
    disconnectPrisma: async () => {
      calls.push("prisma");
    },
    logError: () => undefined,
    setExitCode: () => undefined,
  });

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  assert.equal(first, second);
  await first;
  assert.deepEqual(calls, [
    "http",
    "socket",
    "orchestrator",
    "llm",
    "prisma",
  ]);
});

test("graceful shutdown continues after failures and sets a failing exit code once", async () => {
  const calls: string[] = [];
  const errors: unknown[] = [];
  const exitCodes: number[] = [];
  const shutdown = createGracefulShutdown({
    stopHttp: async () => {
      calls.push("http");
      throw new Error("http failed");
    },
    closeSocketIo: async () => {
      calls.push("socket");
    },
    closeOrchestrator: () => {
      calls.push("orchestrator");
      throw new Error("orchestrator failed");
    },
    closeLlm: async () => {
      calls.push("llm");
    },
    disconnectPrisma: async () => {
      calls.push("prisma");
    },
    logError: (error) => {
      errors.push(error);
    },
    setExitCode: (code) => {
      exitCodes.push(code);
    },
  });

  await shutdown("SIGTERM");

  assert.deepEqual(calls, [
    "http",
    "socket",
    "orchestrator",
    "llm",
    "prisma",
  ]);
  assert.equal(errors.length, 2);
  assert.deepEqual(exitCodes, [1]);
});

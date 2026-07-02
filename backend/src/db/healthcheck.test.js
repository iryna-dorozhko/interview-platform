const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const { checkDatabaseHealth } = require("./healthcheck");

test("checkDatabaseHealth returns ok:true on successful query", async () => {
  const fakePrismaClient = {
    $queryRaw: async () => [{ "?column?": 1 }],
  };

  const result = await checkDatabaseHealth(fakePrismaClient);

  assert.deepEqual(result, { ok: true });
});

test("checkDatabaseHealth returns ok:false when query fails", async () => {
  const fakePrismaClient = {
    $queryRaw: async () => {
      throw new Error("db unavailable");
    },
  };

  const result = await checkDatabaseHealth(fakePrismaClient);

  assert.deepEqual(result, { ok: false, error: "db unavailable" });
});

test("checkDatabaseHealth returns ok:false when Prisma client initialization fails", async () => {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "@prisma/client") {
      return {
        PrismaClient: class PrismaClient {
          constructor() {
            throw new Error("init failed");
          }
        },
      };
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const result = await checkDatabaseHealth();
    assert.deepEqual(result, { ok: false, error: "init failed" });
  } finally {
    Module._load = originalLoad;
  }
});

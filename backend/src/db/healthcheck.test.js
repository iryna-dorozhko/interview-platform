const test = require("node:test");
const assert = require("node:assert/strict");

const { checkDatabaseHealth } = require("./healthcheck");

test("checkDatabaseHealth returns ok:true on successful query", async () => {
  const fakePrismaClient = {
    $queryRaw: async () => [{ "?column?": 1 }],
  };

  const result = await checkDatabaseHealth(fakePrismaClient);

  assert.deepEqual(result, { ok: true });
});

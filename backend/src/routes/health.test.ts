import test from "node:test";
import assert from "node:assert/strict";
import { buildHealthPayload, getHealthStatus } from "./health";

test("buildHealthPayload returns ok:true when database and seed are healthy", () => {
  const payload = buildHealthPayload(
    { ok: true },
    { ok: true, email: "hr@test.com" }
  );

  assert.deepEqual(payload, {
    ok: true,
    database: { ok: true },
    seed: { ok: true, email: "hr@test.com" },
  });
});

test("buildHealthPayload returns ok:false when database fails", () => {
  const payload = buildHealthPayload(
    { ok: false, error: "db down" },
    { ok: true, email: "hr@test.com" }
  );

  assert.deepEqual(payload, {
    ok: false,
    database: { ok: false },
    seed: { ok: true, email: "hr@test.com" },
  });
});

test("buildHealthPayload returns ok:false when seed fails", () => {
  const payload = buildHealthPayload(
    { ok: true },
    { ok: false, email: "hr@test.com" }
  );

  assert.deepEqual(payload, {
    ok: false,
    database: { ok: true },
    seed: { ok: false, email: "hr@test.com" },
  });
});

test("getHealthStatus aggregates database and seed checks", async () => {
  const fakePrisma = {
    $queryRaw: async () => [{ "?column?": 1 }],
    user: {
      findUnique: async () => ({ email: "hr@test.com", role: "HR" }),
    },
  };

  const payload = await getHealthStatus(fakePrisma);

  assert.equal(payload.ok, true);
  assert.equal(payload.database.ok, true);
  assert.equal(payload.seed.ok, true);
});

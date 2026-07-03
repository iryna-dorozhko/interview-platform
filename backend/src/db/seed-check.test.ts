import test from "node:test";
import assert from "node:assert/strict";
import { checkHrSeedUser } from "./seed-check";

test("checkHrSeedUser returns ok:true when HR user exists", async () => {
  const fakePrisma = {
    user: {
      findUnique: async () => ({ email: "hr@test.com", role: "HR" }),
    },
  };

  const result = await checkHrSeedUser(fakePrisma);

  assert.deepEqual(result, { ok: true, email: "hr@test.com" });
});

test("checkHrSeedUser returns ok:false when user is missing", async () => {
  const fakePrisma = {
    user: {
      findUnique: async () => null,
    },
  };

  const result = await checkHrSeedUser(fakePrisma);

  assert.deepEqual(result, { ok: false, email: "hr@test.com" });
});

test("checkHrSeedUser returns ok:false when role is not HR", async () => {
  const fakePrisma = {
    user: {
      findUnique: async () => ({ email: "hr@test.com", role: "CANDIDATE" }),
    },
  };

  const result = await checkHrSeedUser(fakePrisma);

  assert.deepEqual(result, { ok: false, email: "hr@test.com" });
});

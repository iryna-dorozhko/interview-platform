// backend/src/seed/hr-user.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED_HR_USER, hashPassword, seedHrUser } = require("./hr-user");

test("SEED_HR_USER has expected test credentials", () => {
  assert.deepEqual(SEED_HR_USER, {
    email: "hr@test.com",
    password: "123456",
    role: "HR",
  });
});

test("hashPassword returns sha256 hex digest", () => {
  const hash = hashPassword("123456");
  assert.equal(
    hash,
    "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
  );
});

test("seedHrUser upserts HR user with hashed password", async () => {
  const calls = [];

  const fakePrisma = {
    user: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "user_1", ...args.create };
      },
    },
  };

  const UserRole = { HR: "HR", CANDIDATE: "CANDIDATE" };
  const result = await seedHrUser(fakePrisma, { UserRole });

  assert.equal(result.email, "hr@test.com");
  assert.equal(result.id, "user_1");
  assert.equal(calls.length, 1);

  const upsertArgs = calls[0];
  assert.equal(upsertArgs.where.email, "hr@test.com");
  assert.equal(
    upsertArgs.create.passwordHash,
    "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
  );
  assert.equal(upsertArgs.create.role, UserRole.HR);
  assert.equal(upsertArgs.update.passwordHash, upsertArgs.create.passwordHash);
  assert.equal(upsertArgs.update.role, UserRole.HR);
});

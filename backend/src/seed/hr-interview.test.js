// backend/src/seed/hr-interview.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED_INTERVIEW, seedHrInterview } = require("./hr-interview");

test("SEED_INTERVIEW has fixed test join code", () => {
  assert.deepEqual(SEED_INTERVIEW, { joinCode: "TEST01" });
});

test("seedHrInterview upserts DRAFT interview for given HR user", async () => {
  const calls = [];
  const fakePrisma = {
    interview: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "interview_1", ...args.create };
      },
    },
  };

  const result = await seedHrInterview(fakePrisma, "user_hr_1");

  assert.equal(result.id, "interview_1");
  assert.equal(result.joinCode, "TEST01");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.joinCode, "TEST01");
  assert.equal(calls[0].create.hrUserId, "user_hr_1");
  assert.equal(calls[0].create.joinCode, "TEST01");
  assert.equal(calls[0].create.status, "DRAFT");
  assert.equal(calls[0].update.hrUserId, "user_hr_1");
});

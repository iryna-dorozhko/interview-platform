// backend/src/seed/hr-interview.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED_INTERVIEW, seedHrInterview } = require("./hr-interview");

test("SEED_INTERVIEW has fixed test join code", () => {
  assert.deepEqual(SEED_INTERVIEW, { joinCode: "TEST01" });
});

test("seedHrInterview upserts AWAITING_CANDIDATE interview for given HR user and vacancy", async () => {
  const calls = [];
  const fakePrisma = {
    interview: {
      upsert: async (args) => {
        calls.push(args);
        return { id: "interview_1", ...args.create };
      },
    },
  };

  const result = await seedHrInterview(fakePrisma, "user_hr_1", "vacancy_1");

  assert.equal(result.id, "interview_1");
  assert.equal(result.joinCode, "TEST01");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.joinCode, "TEST01");
  assert.equal(calls[0].create.hrUserId, "user_hr_1");
  assert.equal(calls[0].create.vacancyId, "vacancy_1");
  assert.equal(calls[0].create.displayName, "Test Position");
  assert.equal(calls[0].create.joinCode, "TEST01");
  assert.equal(calls[0].create.status, "AWAITING_CANDIDATE");
  assert.equal(calls[0].update.hrUserId, "user_hr_1");
  assert.equal(calls[0].update.vacancyId, "vacancy_1");
});

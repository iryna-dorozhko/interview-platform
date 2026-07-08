const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED_VACANCY, seedHrVacancy } = require("./hr-vacancy");

test("SEED_VACANCY has fixed test title", () => {
  assert.deepEqual(SEED_VACANCY, { title: "Test Position" });
});

test("seedHrVacancy creates CONFIRMED vacancy for given HR user when none exists", async () => {
  const calls = { findFirst: [], create: [] };
  const fakePrisma = {
    vacancy: {
      findFirst: async (args) => {
        calls.findFirst.push(args);
        return null;
      },
      create: async (args) => {
        calls.create.push(args);
        return { id: "vacancy_1", ...args.data };
      },
    },
  };

  const result = await seedHrVacancy(fakePrisma, "user_hr_1");

  assert.equal(result.id, "vacancy_1");
  assert.equal(result.title, "Test Position");
  assert.equal(calls.create[0].data.hrUserId, "user_hr_1");
  assert.equal(calls.create[0].data.status, "CONFIRMED");
});

test("seedHrVacancy returns existing vacancy when found", async () => {
  const fakePrisma = {
    vacancy: {
      findFirst: async () => ({ id: "existing_v", title: "Test Position" }),
      create: async () => {
        throw new Error("create should not be called");
      },
    },
  };

  const result = await seedHrVacancy(fakePrisma, "user_hr_1");

  assert.equal(result.id, "existing_v");
  assert.equal(result.title, "Test Position");
});

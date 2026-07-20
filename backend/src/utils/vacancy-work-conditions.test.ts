import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSalaryDisplay,
  formatWorkFormatDisplay,
  parseVacancyCompensation,
  parseWorkConditionsArray,
} from "./vacancy-work-conditions";

test("formatSalaryDisplay returns displayText when present", () => {
  assert.equal(
    formatSalaryDisplay({ displayText: "$3000–4500 gross, USD" }),
    "$3000–4500 gross, USD",
  );
});

test("formatSalaryDisplay returns null for missing or не вказано", () => {
  assert.equal(formatSalaryDisplay(null), null);
  assert.equal(formatSalaryDisplay({ displayText: "не вказано" }), null);
});

test("formatWorkFormatDisplay strips Формат prefix", () => {
  assert.equal(
    formatWorkFormatDisplay(["Формат: remote, 2 дні в офісі"]),
    "remote, 2 дні в офісі",
  );
});

test("formatWorkFormatDisplay returns null for не вказано", () => {
  assert.equal(formatWorkFormatDisplay(["Формат: не вказано"]), null);
});

test("parseVacancyCompensation requires displayText", () => {
  assert.deepEqual(parseVacancyCompensation({ displayText: "5000 USD gross" }), {
    displayText: "5000 USD gross",
  });
  assert.equal(parseVacancyCompensation({ min: 1000 }), null);
});

test("parseWorkConditionsArray validates string array", () => {
  assert.deepEqual(parseWorkConditionsArray(["Формат: remote"]), ["Формат: remote"]);
  assert.deepEqual(parseWorkConditionsArray([]), []);
});

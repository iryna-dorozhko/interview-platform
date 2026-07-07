import test from "node:test";
import assert from "node:assert/strict";
import { generateJoinCode } from "./joinCode";

test("generateJoinCode returns a 6-character code", () => {
  const code = generateJoinCode();
  assert.equal(code.length, 6);
});

test("generateJoinCode only uses the allowed alphabet (no 0/O/1/I)", () => {
  const code = generateJoinCode();
  assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
});

test("generateJoinCode produces different codes across many calls", () => {
  const codes = new Set(Array.from({ length: 50 }, () => generateJoinCode()));
  assert.ok(codes.size > 1, "expected at least some variation across 50 generated codes");
});

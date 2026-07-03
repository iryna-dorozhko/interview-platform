import test from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "./jwt";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
const ORIGINAL_EXPIRES = process.env.JWT_EXPIRES_IN;

test.before(() => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
  process.env.JWT_EXPIRES_IN = "24h";
});

test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_EXPIRES === undefined) delete process.env.JWT_EXPIRES_IN;
  else process.env.JWT_EXPIRES_IN = ORIGINAL_EXPIRES;
});

test("signToken and verifyToken round-trip payload", () => {
  const token = signToken({
    sub: "user_1",
    email: "hr@test.com",
    role: "HR",
  });

  const payload = verifyToken(token);
  assert.equal(payload.sub, "user_1");
  assert.equal(payload.email, "hr@test.com");
  assert.equal(payload.role, "HR");
});

test("verifyToken throws on invalid token", () => {
  assert.throws(() => verifyToken("not-a-jwt"), /Unauthorized|invalid/i);
});

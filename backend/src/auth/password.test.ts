import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "./password";

test("hashPassword returns sha256 hex digest matching seed", () => {
  const hash = hashPassword("123456");
  assert.equal(
    hash,
    "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
  );
});

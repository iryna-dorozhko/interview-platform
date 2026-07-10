import test from "node:test";
import assert from "node:assert/strict";
import { shouldTransitionToLive } from "./maybe-transition-live";

test("transitions when READY and both present", () => {
  assert.equal(
    shouldTransitionToLive("READY", { hrCount: 1, candidateCount: 1 }),
    true,
  );
});

test("no transition when only HR present", () => {
  assert.equal(
    shouldTransitionToLive("READY", { hrCount: 1, candidateCount: 0 }),
    false,
  );
});

test("no transition when AWAITING_CANDIDATE", () => {
  assert.equal(
    shouldTransitionToLive("AWAITING_CANDIDATE", { hrCount: 1, candidateCount: 1 }),
    false,
  );
});

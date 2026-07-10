import test from "node:test";
import assert from "node:assert/strict";
import { trackJoin, trackLeave, getPresence, resetPresenceForTests } from "./room-presence";

test("trackJoin increments role counts", () => {
  resetPresenceForTests();
  trackJoin("interview:int_1", "HR");
  trackJoin("interview:int_1", "CANDIDATE");
  assert.deepEqual(getPresence("interview:int_1"), { hrCount: 1, candidateCount: 1 });
});

test("trackLeave decrements without going negative", () => {
  resetPresenceForTests();
  trackJoin("interview:int_1", "HR");
  trackLeave("interview:int_1", "HR");
  trackLeave("interview:int_1", "HR");
  assert.deepEqual(getPresence("interview:int_1"), { hrCount: 0, candidateCount: 0 });
});

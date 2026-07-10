import test from "node:test";
import assert from "node:assert/strict";
import { canAccessInterviewRoom } from "./room-access";

const hrUser = { id: "hr_1", email: "hr@test.com", role: "HR" as const };
const candidateUser = { id: "cd_1", email: "c@test.com", role: "CANDIDATE" as const };
const otherHr = { id: "hr_2", email: "other@test.com", role: "HR" as const };

test("HR can access AWAITING_CANDIDATE (not read-only)", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: null, status: "AWAITING_CANDIDATE" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true, readOnly: false });
});

test("HR can access ENDED read-only", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "ENDED" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true, readOnly: true });
});

test("candidate rejected at AWAITING_CANDIDATE", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "AWAITING_CANDIDATE" },
    candidateUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Співбесіда ще не готова");
});

test("candidate can access READY", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    candidateUser,
  );
  assert.deepEqual(result, { ok: true, readOnly: false });
});

test("HR cannot access another HR interview", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    otherHr,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Немає доступу");
});

test("candidate cannot access interview linked to another candidate", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_2", status: "READY" },
    candidateUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Немає доступу");
});

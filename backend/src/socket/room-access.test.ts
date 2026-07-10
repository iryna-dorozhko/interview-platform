import test from "node:test";
import assert from "node:assert/strict";
import { canAccessInterviewRoom } from "./room-access";

const hrUser = { id: "hr_1", email: "hr@test.com", role: "HR" as const };
const candidateUser = { id: "cd_1", email: "candidate@test.com", role: "CANDIDATE" as const };
const otherHr = { id: "hr_2", email: "other@test.com", role: "HR" as const };

test("HR can access own interview when READY", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true });
});

test("HR can access own interview when LIVE", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "LIVE" },
    hrUser,
  );
  assert.deepEqual(result, { ok: true });
});

test("HR cannot access another HR interview", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    otherHr,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Немає доступу");
});

test("candidate can access linked interview when READY", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "READY" },
    candidateUser,
  );
  assert.deepEqual(result, { ok: true });
});

test("candidate cannot access interview linked to another candidate", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_2", status: "READY" },
    candidateUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Немає доступу");
});

test("rejects AWAITING_CANDIDATE status", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "AWAITING_CANDIDATE" },
    hrUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Співбесіда ще не готова");
});

test("rejects ENDED status", () => {
  const result = canAccessInterviewRoom(
    { hrUserId: "hr_1", candidateUserId: "cd_1", status: "ENDED" },
    hrUser,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Співбесіда завершена");
});

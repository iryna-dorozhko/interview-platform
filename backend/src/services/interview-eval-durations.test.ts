import assert from "node:assert/strict";
import { test } from "node:test";
import { liveDurationMs, prepDurationMs } from "./interview-eval-durations";

test("prepDurationMs null when session missing or not closed", () => {
  assert.equal(prepDurationMs(null), null);
  assert.equal(
    prepDurationMs({
      isClosed: false,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T11:00:00.000Z"),
    }),
    null,
  );
});

test("prepDurationMs uses updatedAt - createdAt when closed", () => {
  assert.equal(
    prepDurationMs({
      isClosed: true,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:05:00.000Z"),
    }),
    5 * 60_000,
  );
});

test("liveDurationMs null without endedAt", () => {
  assert.equal(liveDurationMs(null), null);
  assert.equal(
    liveDurationMs({
      startedAt: new Date("2026-07-01T12:00:00.000Z"),
      endedAt: null,
    }),
    null,
  );
});

test("liveDurationMs endedAt - startedAt", () => {
  assert.equal(
    liveDurationMs({
      startedAt: new Date("2026-07-01T12:00:00.000Z"),
      endedAt: new Date("2026-07-01T13:30:00.000Z"),
    }),
    90 * 60_000,
  );
});

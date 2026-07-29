import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("HrSidebar: renders 'Заявки' before 'Співбесіди' in the template", () => {
  const path = fileURLToPath(new URL("./HrSidebar.vue", import.meta.url));
  const source = readFileSync(path, "utf8");

  const appsIdx = source.indexOf("Заявки");
  const interviewsIdx = source.indexOf("Співбесіди");

  assert.notEqual(appsIdx, -1, "Expected to find 'Заявки' in HrSidebar.vue");
  assert.notEqual(interviewsIdx, -1, "Expected to find 'Співбесіди' in HrSidebar.vue");

  // The UI order must be 'Заявки' first, then 'Співбесіди'
  assert.ok(
    appsIdx < interviewsIdx,
    `Expected 'Заявки' before 'Співбесіди', but appsIdx=${appsIdx} interviewsIdx=${interviewsIdx}`,
  );
});


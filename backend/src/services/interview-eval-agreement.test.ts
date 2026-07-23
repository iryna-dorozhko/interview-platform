import assert from "node:assert/strict";
import { test } from "node:test";
import { hrAgreedWithArbiter } from "./interview-eval-agreement";

const pairs: Array<{
  rec: "HIRE" | "MAYBE" | "REJECT";
  dec: "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";
  agreed: boolean;
}> = [
  { rec: "HIRE", dec: "ACCEPT", agreed: true },
  { rec: "REJECT", dec: "REJECT", agreed: true },
  { rec: "MAYBE", dec: "ADDITIONAL_MEETING", agreed: true },
  { rec: "HIRE", dec: "REJECT", agreed: false },
  { rec: "HIRE", dec: "ADDITIONAL_MEETING", agreed: false },
  { rec: "REJECT", dec: "ACCEPT", agreed: false },
  { rec: "REJECT", dec: "ADDITIONAL_MEETING", agreed: false },
  { rec: "MAYBE", dec: "ACCEPT", agreed: false },
  { rec: "MAYBE", dec: "REJECT", agreed: false },
];

for (const { rec, dec, agreed } of pairs) {
  test(`hrAgreedWithArbiter ${rec} + ${dec} => ${agreed}`, () => {
    assert.equal(hrAgreedWithArbiter(rec, dec), agreed);
  });
}

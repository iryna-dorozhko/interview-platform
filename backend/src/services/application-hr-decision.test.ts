import test from "node:test";
import assert from "node:assert/strict";
import {
  applicationStatusFromDecisionType,
  applyTerminalApplicationStatus,
} from "./application-hr-decision";

test("applicationStatusFromDecisionType maps all decision types", () => {
  assert.equal(applicationStatusFromDecisionType("REJECT"), "DECLINED_BY_HR");
  assert.equal(applicationStatusFromDecisionType("ACCEPT"), "ACCEPTED");
  assert.equal(
    applicationStatusFromDecisionType("ADDITIONAL_MEETING"),
    "ADDITIONAL_MEETING",
  );
});

test("applyTerminalApplicationStatus updates application and upserts offer reject", async () => {
  const calls: string[] = [];
  const tx = {
    vacancyApplication: {
      update: async (args: {
        where: { id: string };
        data: { status: string };
      }) => {
        calls.push(`app:${args.where.id}:${args.data.status}`);
        return {};
      },
    },
    vacancyOfferDecision: {
      upsert: async (args: {
        where: {
          candidateUserId_vacancyId: { candidateUserId: string; vacancyId: string };
        };
        create: { decision: string };
      }) => {
        calls.push(
          `offer:${args.where.candidateUserId_vacancyId.candidateUserId}:${args.where.candidateUserId_vacancyId.vacancyId}:${args.create.decision}`,
        );
        return {};
      },
    },
  };

  await applyTerminalApplicationStatus(tx, {
    applicationId: "app_1",
    candidateUserId: "cd_1",
    vacancyId: "v1",
    status: "DECLINED_BY_HR",
  });

  assert.deepEqual(calls, ["app:app_1:DECLINED_BY_HR", "offer:cd_1:v1:REJECTED"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  canCandidateJoinInterview,
  isCandidateQuestionnaireConfirmed,
  maybeTransitionToReady,
} from "./interview-readiness";

type FakeInterview = {
  id: string;
  status: string;
  candidateUserId: string | null;
  vacancyId: string;
  displayName?: string;
};

type FakeVacancy = {
  id: string;
  status: string;
  companyProfile: { confirmedAt: Date | null } | null;
};

type FakeCandidateProfile = {
  interviewId: string;
  confirmedAt: Date | null;
};

function makeFakePrisma(seed: {
  interviews: FakeInterview[];
  vacancies: FakeVacancy[];
  candidateProfiles: FakeCandidateProfile[];
}) {
  const interviews = seed.interviews.map((item) => ({ ...item }));
  const vacancies = seed.vacancies.map((item) => ({ ...item }));
  const candidateProfiles = seed.candidateProfiles.map((item) => ({ ...item }));

  return {
    interview: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        interviews.find((item) => {
          const candidateUserId = where.candidateUserId as string | undefined;
          if (candidateUserId != null && item.candidateUserId !== candidateUserId) return false;

          const statusFilter = where.status as { in: string[] } | string | undefined;
          if (typeof statusFilter === "string" && item.status !== statusFilter) return false;
          if (statusFilter && typeof statusFilter === "object" && !statusFilter.in.includes(item.status)) {
            return false;
          }

          const notFilter = where.NOT as { id: string } | undefined;
          if (notFilter && item.id === notFilter.id) return false;

          const displayName = where.displayName;
          if (typeof displayName === "string" && item.displayName !== displayName) return false;
          if (
            displayName &&
            typeof displayName === "object" &&
            "not" in displayName &&
            item.displayName === (displayName as { not: string }).not
          ) {
            return false;
          }

          return true;
        }) ?? null,
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: {
          vacancy?: { include?: { companyProfile?: boolean } };
          candidateProfile?: boolean;
        };
      }) => {
        const interview = interviews.find((item) => item.id === where.id) ?? null;
        if (!interview || !include) return interview;
        const vacancy = vacancies.find((item) => item.id === interview.vacancyId) ?? null;
        return {
          ...interview,
          vacancy: vacancy
            ? {
                ...vacancy,
                companyProfile: include.vacancy?.include?.companyProfile ? vacancy.companyProfile : undefined,
              }
            : null,
          candidateProfile: include.candidateProfile
            ? candidateProfiles.find((item) => item.interviewId === interview.id) ?? null
            : undefined,
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: string };
      }) => {
        const interview = interviews.find((item) => item.id === where.id);
        if (!interview) throw new Error("Interview not found");
        if (data.status !== undefined) interview.status = data.status;
        return { ...interview };
      },
    },
    candidateProfile: {
      findUnique: async ({ where }: { where: { interviewId: string } }) =>
        candidateProfiles.find((item) => item.interviewId === where.interviewId) ?? null,
    },
    __interviews: interviews,
  };
}

test("maybeTransitionToReady moves AWAITING_CANDIDATE to READY when all conditions met", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i_questionnaire",
        displayName: "Моя анкета",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
      {
        id: "i1",
        displayName: "Frontend Dev",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
    ],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i_questionnaire", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "READY");
  assert.equal(fakePrisma.__interviews[1].status, "READY");
});

test("maybeTransitionToReady transitions joined HR interview after questionnaire confirm", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i_questionnaire",
        displayName: "Моя анкета",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
      {
        id: "i1",
        displayName: "Frontend Dev",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
    ],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i_questionnaire", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i_questionnaire");
  assert.equal(result?.status, "READY");
  assert.equal(fakePrisma.__interviews[1].status, "READY");
});

test("maybeTransitionToReady is no-op when candidate not joined", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: null, vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i_questionnaire", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when candidate profile not confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i_questionnaire",
        displayName: "Моя анкета",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
      {
        id: "i1",
        displayName: "Frontend Dev",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
    ],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i_questionnaire", confirmedAt: null }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when HR profile reset", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i_questionnaire",
        displayName: "Моя анкета",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
      {
        id: "i1",
        displayName: "Frontend Dev",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
    ],
    vacancies: [{ id: "v1", status: "DRAFT", companyProfile: { confirmedAt: null } }],
    candidateProfiles: [{ interviewId: "i_questionnaire", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when already READY", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "READY", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i_questionnaire", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "READY");
  assert.equal(fakePrisma.__interviews[0].status, "READY");
});

test("canCandidateJoinInterview rejects LIVE and ENDED", async () => {
  for (const status of ["LIVE", "ENDED"] as const) {
    const fakePrisma = makeFakePrisma({ interviews: [], vacancies: [], candidateProfiles: [] });
    const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
      id: "i1",
      status,
      candidateUserId: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Interview is not joinable");
  }
});

test("canCandidateJoinInterview rejects when taken by another candidate", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [], vacancies: [], candidateProfiles: [] });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i1",
    status: "AWAITING_CANDIDATE",
    candidateUserId: "other",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Interview already taken");
});

test("canCandidateJoinInterview rejects when candidate has another active interview", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i_other", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [],
    candidateProfiles: [],
  });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i_new",
    status: "AWAITING_CANDIDATE",
    candidateUserId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Candidate already has active interview");
});

test("canCandidateJoinInterview allows join when candidate has confirmed self-service questionnaire", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i_self",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        displayName: "Моя анкета",
      },
    ],
    vacancies: [],
    candidateProfiles: [{ interviewId: "i_self", confirmedAt: new Date(1) }],
  });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i_hr",
    status: "AWAITING_CANDIDATE",
    candidateUserId: null,
  });
  assert.equal(result.ok, true);
});

test("canCandidateJoinInterview rejects join without questionnaire", async () => {
  const fakePrisma = makeFakePrisma({ interviews: [], vacancies: [], candidateProfiles: [] });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i_hr",
    status: "AWAITING_CANDIDATE",
    candidateUserId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Candidate questionnaire required");
});

test("canCandidateJoinInterview rejects join when questionnaire is not confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i_self",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        displayName: "Моя анкета",
      },
    ],
    vacancies: [],
    candidateProfiles: [{ interviewId: "i_self", confirmedAt: null }],
  });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i_hr",
    status: "AWAITING_CANDIDATE",
    candidateUserId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Candidate questionnaire not confirmed");
});

test("canCandidateJoinInterview allows re-join of same interview", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [],
    candidateProfiles: [],
  });
  const result = await canCandidateJoinInterview(fakePrisma as never, "cd_1", {
    id: "i1",
    status: "AWAITING_CANDIDATE",
    candidateUserId: "cd_1",
  });
  assert.equal(result.ok, true);
});

test("isCandidateQuestionnaireConfirmed returns true only for confirmed questionnaire", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i_self",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
        displayName: "Моя анкета",
      },
    ],
    vacancies: [],
    candidateProfiles: [{ interviewId: "i_self", confirmedAt: new Date(1) }],
  });

  assert.equal(await isCandidateQuestionnaireConfirmed(fakePrisma as never, "cd_1"), true);
});

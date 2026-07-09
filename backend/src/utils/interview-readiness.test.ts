import test from "node:test";
import assert from "node:assert/strict";
import {
  canCandidateJoinInterview,
  maybeTransitionToReady,
} from "./interview-readiness";

type FakeInterview = {
  id: string;
  status: string;
  candidateUserId: string | null;
  vacancyId: string;
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
      findFirst: async ({
        where,
      }: {
        where: {
          candidateUserId: string;
          status: { in: string[] };
          NOT?: { id: string };
        };
      }) =>
        interviews.find(
          (item) =>
            item.candidateUserId === where.candidateUserId &&
            where.status.in.includes(item.status) &&
            item.id !== where.NOT?.id,
        ) ?? null,
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
    __interviews: interviews,
  };
}

test("maybeTransitionToReady moves AWAITING_CANDIDATE to READY when all conditions met", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [
      {
        id: "i1",
        status: "AWAITING_CANDIDATE",
        candidateUserId: "cd_1",
        vacancyId: "v1",
      },
    ],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "READY");
  assert.equal(fakePrisma.__interviews[0].status, "READY");
});

test("maybeTransitionToReady is no-op when candidate not joined", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: null, vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when candidate profile not confirmed", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: null }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when HR profile reset", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "AWAITING_CANDIDATE", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "DRAFT", companyProfile: { confirmedAt: null } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
  });

  const result = await maybeTransitionToReady(fakePrisma as never, "i1");
  assert.equal(result?.status, "AWAITING_CANDIDATE");
});

test("maybeTransitionToReady is no-op when already READY", async () => {
  const fakePrisma = makeFakePrisma({
    interviews: [{ id: "i1", status: "READY", candidateUserId: "cd_1", vacancyId: "v1" }],
    vacancies: [{ id: "v1", status: "CONFIRMED", companyProfile: { confirmedAt: new Date(1) } }],
    candidateProfiles: [{ interviewId: "i1", confirmedAt: new Date(2) }],
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

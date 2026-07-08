const SEED_INTERVIEW = {
  joinCode: "TEST01",
};

async function seedHrInterview(prisma, hrUserId, vacancyId) {
  const interview = await prisma.interview.upsert({
    where: { joinCode: SEED_INTERVIEW.joinCode },
    update: { hrUserId, vacancyId },
    create: {
      hrUserId,
      vacancyId,
      displayName: "Test Position",
      joinCode: SEED_INTERVIEW.joinCode,
      status: "AWAITING_CANDIDATE",
    },
  });

  return { id: interview.id, joinCode: interview.joinCode };
}

module.exports = {
  SEED_INTERVIEW,
  seedHrInterview,
};

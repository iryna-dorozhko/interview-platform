const SEED_INTERVIEW = {
  joinCode: "TEST01",
};

async function seedHrInterview(prisma, hrUserId) {
  const interview = await prisma.interview.upsert({
    where: { joinCode: SEED_INTERVIEW.joinCode },
    update: { hrUserId },
    create: {
      hrUserId,
      joinCode: SEED_INTERVIEW.joinCode,
      status: "DRAFT",
    },
  });

  return { id: interview.id, joinCode: interview.joinCode };
}

module.exports = {
  SEED_INTERVIEW,
  seedHrInterview,
};

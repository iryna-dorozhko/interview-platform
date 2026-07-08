const SEED_VACANCY = {
  title: "Test Position",
};

async function seedHrVacancy(prisma, hrUserId) {
  const existing = await prisma.vacancy.findFirst({
    where: { hrUserId, title: SEED_VACANCY.title },
  });

  if (existing) {
    return { id: existing.id, title: existing.title };
  }

  const vacancy = await prisma.vacancy.create({
    data: {
      hrUserId,
      title: SEED_VACANCY.title,
      status: "CONFIRMED",
    },
  });

  return { id: vacancy.id, title: vacancy.title };
}

module.exports = { SEED_VACANCY, seedHrVacancy };

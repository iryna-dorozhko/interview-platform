require("dotenv/config");
const { PrismaClient, UserRole } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { seedHrUser } = require("../src/seed/hr-user");
const { seedHrVacancy } = require("../src/seed/hr-vacancy");
const { seedHrInterview } = require("../src/seed/hr-interview");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";

const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl }));
const prisma = new PrismaClient({ adapter });

async function main() {
  const hrUser = await seedHrUser(prisma, { UserRole });
  console.log(`Seeded HR user: ${hrUser.email}`);

  const vacancy = await seedHrVacancy(prisma, hrUser.id);
  console.log(`Seeded test vacancy: id=${vacancy.id} title=${vacancy.title}`);

  const interview = await seedHrInterview(prisma, hrUser.id, vacancy.id);
  console.log(`Seeded test interview: id=${interview.id} joinCode=${interview.joinCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

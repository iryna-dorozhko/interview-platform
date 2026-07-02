require("dotenv/config");
const { PrismaClient, UserRole } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const crypto = require("node:crypto");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";

const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl }));
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "hr@test.com";
  const passwordHash = crypto
    .createHash("sha256")
    .update("123456")
    .digest("hex");

  await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: UserRole.HR,
    },
    create: {
      email,
      passwordHash,
      role: UserRole.HR,
    },
  });

  console.log(`Seeded HR user: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

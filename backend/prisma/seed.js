const { PrismaClient, UserRole } = require("@prisma/client");
const crypto = require("node:crypto");

const prisma = new PrismaClient();

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

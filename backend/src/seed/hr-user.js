const crypto = require("node:crypto");

const SEED_HR_USER = {
  email: "hr@test.com",
  password: "123456",
  role: "HR",
};

function hashPassword(plainPassword) {
  return crypto.createHash("sha256").update(plainPassword).digest("hex");
}

async function seedHrUser(prisma, { UserRole }) {
  const { email, password, role } = SEED_HR_USER;
  const passwordHash = hashPassword(password);
  const userRole = UserRole[role];

  await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: userRole,
    },
    create: {
      email,
      passwordHash,
      role: userRole,
    },
  });

  return { email };
}

module.exports = {
  SEED_HR_USER,
  hashPassword,
  seedHrUser,
};

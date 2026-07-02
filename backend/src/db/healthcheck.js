async function checkDatabaseHealth(client) {
  let databaseClient = client;
  if (!databaseClient) {
    const { PrismaClient } = require("@prisma/client");
    databaseClient = new PrismaClient();
  }

  await databaseClient.$queryRaw`SELECT 1`;
  return { ok: true };
}

module.exports = {
  checkDatabaseHealth,
};

async function checkDatabaseHealth(client) {
  try {
    let databaseClient = client;
    if (!databaseClient) {
      const { PrismaClient } = require("@prisma/client");
      databaseClient = new PrismaClient();
    }

    await databaseClient.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

module.exports = {
  checkDatabaseHealth,
};

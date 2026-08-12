export async function checkDatabaseHealth(client, options = {}) {
  try {
    let databaseClient = client
    if (!databaseClient) {
      const createPrismaClient =
        options.createPrismaClient ??
        (async () => {
          const { PrismaClient } = await import('@prisma/client')
          return new PrismaClient()
        })
      databaseClient = await createPrismaClient()
    }

    await databaseClient.$queryRaw`SELECT 1`
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

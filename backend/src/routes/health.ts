import { Router } from 'express'
import type { Request, Response } from 'express'
import { checkDatabaseHealth } from '../db/healthcheck'
import { checkHrSeedUser } from '../db/seed-check'
import type { SeedCheckResult } from '../db/seed-check'

type DatabaseHealthResult = {
  ok: boolean
  error?: string
}

export type HealthPayload = {
  ok: boolean
  database: { ok: boolean }
  seed: { ok: boolean; email: string }
}

// Будує HealthPayload.
export function buildHealthPayload(database: DatabaseHealthResult, seed: SeedCheckResult): HealthPayload {
  return {
    ok: database.ok && seed.ok,
    database: { ok: database.ok },
    seed: { ok: seed.ok, email: seed.email }
  }
}

type PrismaLike = Parameters<typeof checkHrSeedUser>[0] & {
  $queryRaw: (query: TemplateStringsArray) => Promise<unknown>
}

// Повертає HealthStatus.
export async function getHealthStatus(client: PrismaLike): Promise<HealthPayload> {
  const database = await checkDatabaseHealth(client)
  const seed = await checkHrSeedUser(client)
  return buildHealthPayload(database, seed)
}

// Створює HealthRouter.
export function createHealthRouter(getClient: () => PrismaLike): Router {
  const router = Router()

  router.get('/health', async (_req: Request, res: Response) => {
    const payload = await getHealthStatus(getClient())
    res.status(200).json(payload)
  })

  return router
}

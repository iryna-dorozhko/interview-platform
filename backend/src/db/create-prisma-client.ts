import { env } from 'node:process'
import { PrismaClient } from '@prisma/client'
import { PrismaBun } from '@qzsy/prisma-adapter-bun'

// Fallback URL для локальної PostgreSQL, якщо `DATABASE_URL` не задано.
export const defaultDatabaseUrl =
  env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public'

// Створює `PrismaClient` з драйвер-адаптером Bun SQL (`@qzsy/prisma-adapter-bun`). @param databaseUrl - PostgreSQL connection string; за замовчуванням `defaultDatabaseUrl`. @returns Налаштований екземпляр Prisma без `pg` Pool.
export function createPrismaClient(databaseUrl: string = defaultDatabaseUrl): PrismaClient {
  const adapter = new PrismaBun(databaseUrl)
  return new PrismaClient({ adapter })
}

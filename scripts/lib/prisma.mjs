import { createPrismaClient } from '../../backend/src/db/create-prisma-client.ts'

/**
 * @returns {{ prisma: import('@prisma/client').PrismaClient }}
 */
export function getPrisma() {
  return { prisma: createPrismaClient() }
}

/**
 * @template T
 * @param {(prisma: import('@prisma/client').PrismaClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withPrisma(fn) {
  const prisma = createPrismaClient()
  try {
    return await fn(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

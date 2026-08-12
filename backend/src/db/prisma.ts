import { createPrismaClient } from './create-prisma-client.js'

// Спільний Prisma-клієнт backend (singleton на рівні модуля).
export const prisma = createPrismaClient()

// Закриває з'єднання Prisma під час graceful shutdown сервера.
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
}

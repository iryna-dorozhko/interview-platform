import type { LiveSession, PrismaClient } from '@prisma/client'

// Перевіряє UniqueConstraintError.
function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002'
}

// Модуль ensureLiveSession.
export async function ensureLiveSession(prisma: PrismaClient, interviewId: string): Promise<LiveSession> {
  const existing = await prisma.liveSession.findUnique({ where: { interviewId } })
  if (existing) return existing

  try {
    return await prisma.liveSession.create({ data: { interviewId } })
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const raced = await prisma.liveSession.findUnique({ where: { interviewId } })
    if (raced) return raced
    throw error
  }
}

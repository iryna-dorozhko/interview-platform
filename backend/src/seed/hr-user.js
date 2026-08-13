import crypto from 'node:crypto'

export const SEED_HR_USER = {
  email: 'hr@test.com',
  password: '123456',
  role: 'HR'
}


export function hashPassword(plainPassword) {
  return crypto.createHash('sha256').update(plainPassword).digest('hex')
}


export async function seedHrUser(prisma, { UserRole }) {
  const { email, password, role } = SEED_HR_USER
  const passwordHash = hashPassword(password)
  const userRole = UserRole[role]

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: userRole
    },
    create: {
      email,
      passwordHash,
      role: userRole
    }
  })

  return { id: user.id, email: user.email }
}

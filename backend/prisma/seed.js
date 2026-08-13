import { UserRole } from '@prisma/client'
import { seedHrInterview } from '../src/seed/hr-interview.js'
import { seedHrUser } from '../src/seed/hr-user.js'
import { seedHrVacancy } from '../src/seed/hr-vacancy.js'
import { createPrismaClient } from '../src/db/create-prisma-client.js'

const prisma = createPrismaClient()

async function main() {
  const hrUser = await seedHrUser(prisma, { UserRole })
  console.log(`Seeded HR user: ${hrUser.email}`)

  const vacancy = await seedHrVacancy(prisma, hrUser.id)
  console.log(`Seeded test vacancy: id=${vacancy.id} title=${vacancy.title}`)

  const interview = await seedHrInterview(prisma, hrUser.id, vacancy.id)
  console.log(`Seeded test interview: id=${interview.id} joinCode=${interview.joinCode}`)
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

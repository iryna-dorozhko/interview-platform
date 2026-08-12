import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkDatabaseHealth } from './healthcheck.js'

test('checkDatabaseHealth returns ok:true on successful query', async () => {
  const fakePrismaClient = {
    $queryRaw: async () => [{ '?column?': 1 }]
  }

  const result = await checkDatabaseHealth(fakePrismaClient)

  assert.deepEqual(result, { ok: true })
})

test('checkDatabaseHealth returns ok:false when query fails', async () => {
  const fakePrismaClient = {
    $queryRaw: async () => {
      throw new Error('db unavailable')
    }
  }

  const result = await checkDatabaseHealth(fakePrismaClient)

  assert.deepEqual(result, { ok: false, error: 'db unavailable' })
})

test('checkDatabaseHealth returns ok:false when Prisma client initialization fails', async () => {
  const result = await checkDatabaseHealth(undefined, {
    createPrismaClient: async () => {
      throw new Error('init failed')
    }
  })
  assert.deepEqual(result, { ok: false, error: 'init failed' })
})

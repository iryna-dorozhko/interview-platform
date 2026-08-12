import { env } from 'node:process'
import assert from 'node:assert/strict'
import { test, beforeAll, afterAll } from 'vitest'
import { signToken, verifyToken } from './jwt'

const ORIGINAL_SECRET = env.JWT_SECRET
const ORIGINAL_EXPIRES = env.JWT_EXPIRES_IN

beforeAll(() => {
  env.JWT_SECRET = 'test-secret-min-8-chars'
  env.JWT_EXPIRES_IN = '24h'
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete env.JWT_SECRET
  else env.JWT_SECRET = ORIGINAL_SECRET
  if (ORIGINAL_EXPIRES === undefined) delete env.JWT_EXPIRES_IN
  else env.JWT_EXPIRES_IN = ORIGINAL_EXPIRES
})

test('signToken and verifyToken round-trip payload', () => {
  const token = signToken({
    sub: 'user_1',
    email: 'hr@test.com',
    role: 'HR'
  })

  const payload = verifyToken(token)
  assert.equal(payload.sub, 'user_1')
  assert.equal(payload.email, 'hr@test.com')
  assert.equal(payload.role, 'HR')
})

test('verifyToken throws on invalid token', () => {
  assert.throws(() => verifyToken('not-a-jwt'), /Unauthorized|invalid/i)
})

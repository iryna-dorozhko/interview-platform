import assert from 'node:assert/strict'
import { test } from 'vitest'
import { normalizeEmail, isValidEmailFormat } from './invitation'

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Anna@Mail.COM '), 'anna@mail.com')
})

test('isValidEmailFormat accepts simple emails', () => {
  assert.equal(isValidEmailFormat('a@b.co'), true)
  assert.equal(isValidEmailFormat('not-an-email'), false)
  assert.equal(isValidEmailFormat(''), false)
})

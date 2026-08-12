import crypto from 'node:crypto'

// Модуль hashPassword.
export function hashPassword(plainPassword: string): string {
  return crypto.createHash('sha256').update(plainPassword).digest('hex')
}

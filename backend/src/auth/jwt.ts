import { checkEnv, env } from '@nitra/check-env'
import { env as processEnv } from 'node:process'
import jwt from 'jsonwebtoken'

export type JwtPayload = {
  sub: string
  email: string
  role: 'HR' | 'CANDIDATE'
}

// Повертає JwtConfig.
export function getJwtConfig(): { secret: string; expiresIn: string } {
  checkEnv(['JWT_SECRET'])
  const secret = env.JWT_SECRET
  if (!secret || secret.length < 8) {
    throw new Error('JWT_SECRET must be set and at least 8 characters')
  }
  return {
    secret,
    expiresIn: processEnv.JWT_EXPIRES_IN ?? '24h'
  }
}

// Модуль signToken.
export function signToken(payload: JwtPayload): string {
  const { secret, expiresIn } = getJwtConfig()
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions)
}

// Модуль verifyToken.
export function verifyToken(token: string): JwtPayload {
  const { secret } = getJwtConfig()
  try {
    const decoded = jwt.verify(token, secret)
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('Invalid token')
    }
    const { sub, email, role } = decoded as JwtPayload
    if (!sub || !email || !role) {
      throw new Error('Invalid token payload')
    }
    return { sub, email, role }
  } catch {
    throw new Error('Unauthorized')
  }
}

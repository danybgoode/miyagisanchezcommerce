/**
 * lib/verification-crypto.ts
 *
 * The pure email/code verification crypto shared by the sweepstakes, launchpad and
 * consent-preview (S4) flows. Extracted out of lib/sweepstakes.ts precisely so it
 * carries NO `server-only`, NO `db`, and NO `@/lib/dictionary` (which imports
 * `@/locales/es.json`) — those make the module unloadable from the Playwright `api`
 * runner's Node ESM loader (an es.json import needs an import attribute there). A
 * pure predicate/crypto helper must live in a leaf module so a spec can import it
 * directly (LEARNINGS: "a unit-tested pure helper can't live in a module that
 * imports server-only / next / a JSON asset").
 *
 * Only `node:crypto` + `process.env`. Deterministic given the same secret.
 */
import { createHmac, randomInt, timingSafeEqual } from 'crypto'

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** The HMAC key. Same resolution the sweepstakes flow has always used, kept here so
 *  every consumer hashes identically. */
export function verificationSecret(): string {
  return process.env.SWEEPSTAKES_HASH_SECRET
    ?? process.env.CLERK_SECRET_KEY
    ?? process.env.MEDUSA_INTERNAL_SECRET
    ?? 'dev-sweepstakes-secret'
}

export function cleanEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))
}

export function hashSweepstakesEmail(email: string): string {
  return createHmac('sha256', verificationSecret()).update(cleanEmail(email)).digest('hex')
}

export function hashVerificationCode(scopeId: string, emailHash: string, code: string): string {
  return createHmac('sha256', verificationSecret()).update(`${scopeId}:${emailHash}:${code.trim().toUpperCase()}`).digest('hex')
}

export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function makeCode(): string {
  let out = ''
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return out
}

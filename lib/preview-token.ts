/**
 * lib/preview-token.ts
 *
 * Pure opaque-preview-token crypto for founding-merchant-consent-previews (S1.2).
 * Deliberately ZERO app imports (no `server-only`, no Supabase) so the token logic
 * is directly unit-testable from a Playwright `api` spec — see the split-pure-helper
 * rule in Roadmap/LEARNINGS.md (a helper in a `server-only`/DB module can't be
 * imported by the test runner). `lib/preview-access.ts` composes these with the DB.
 */
import { createHash, randomBytes } from 'crypto'

export const PREVIEW_TOKEN_PREFIX = 'mp_'

/** Generate a fresh opaque preview token + its storage hash. Plaintext shown once. */
export function generatePreviewToken(): { token: string; hash: string } {
  const token = PREVIEW_TOKEN_PREFIX + randomBytes(32).toString('hex')
  return { token, hash: hashPreviewToken(token) }
}

/** SHA-256 of the plaintext token — the ONLY form persisted. */
export function hashPreviewToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 32 random bytes → exactly 64 lowercase hex chars after the prefix. */
const TOKEN_BODY_RE = /^[0-9a-f]{64}$/

/**
 * A token is well-formed only if it carries the prefix AND the exact 64-hex-char
 * body a real token has. The resolver rejects anything else BEFORE any DB read, so
 * a malformed probe (`mp_x`) never reaches the database — matching the documented
 * 256-bit format rather than merely checking the prefix.
 */
export function isWellFormedPreviewToken(token: unknown): token is string {
  if (typeof token !== 'string' || !token.startsWith(PREVIEW_TOKEN_PREFIX)) return false
  return TOKEN_BODY_RE.test(token.slice(PREVIEW_TOKEN_PREFIX.length))
}

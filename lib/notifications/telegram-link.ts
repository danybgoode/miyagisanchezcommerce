import { randomBytes } from 'node:crypto'

/**
 * Pure helpers for the seller Telegram link flow — no `next/*`, no `server-only`,
 * no DB. So the Playwright runner (and any unit test) can import this directly
 * (per LEARNINGS: keep the unit-testable logic in a next-free module; the route
 * + dispatcher import *it*).
 *
 * Telegram deep-link rules (live docs, https://core.telegram.org/bots/features#deep-linking):
 *   "A-Z, a-z, 0-9, _ and - are allowed. … The parameter can be up to 64
 *   characters long." The bot receives the payload as a `/start <payload>`
 *   message. We therefore mint url-safe tokens <= 64 chars and parse the start
 *   command with the same alphabet.
 */

/** Linking tokens are short-lived: 10 minutes from mint. */
export const LINK_TOKEN_TTL_MS = 10 * 60_000

/** Telegram's allowed start-payload alphabet, bounded to the 64-char max. */
const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * A `/start <payload>` (optionally `/start@bot <payload>`) command parser.
 * Returns the payload token, or null for any other / malformed text.
 */
const START_RE = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{1,64})\s*$/

/** Mint a single-use linking token: 24 random bytes → base64url (32 chars). */
export function genLinkToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Is this string a well-formed link token (url-safe alphabet, <= 64 chars)? */
export function isLinkTokenFormat(s: unknown): s is string {
  return typeof s === 'string' && TOKEN_RE.test(s)
}

/**
 * Extract the start-payload token from an incoming Telegram message text.
 * `/start <token>` → token; anything else (bare `/start`, other commands,
 * plain chat, oversized/garbage payload) → null.
 */
export function parseStartCommand(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const m = text.trim().match(START_RE)
  return m ? m[1] : null
}

/** Has a token (with this absolute expiry) expired as of `now`? */
export function isTokenExpired(expiresAt: string | number | Date, now: number = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now
}

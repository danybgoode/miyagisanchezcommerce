/**
 * Admin identity — pure, next-free, unit-testable.
 *
 * This is the SSOT for "is this person a platform admin?". The server guards
 * (`lib/admin/guard.ts`) resolve the Clerk user and call `isAdminUser`; the
 * api spec (`e2e/admin-identity.spec.ts`) exercises the allow/deny logic
 * directly. Keep this module free of `next`, Clerk, and DB imports so the
 * Playwright `api` runner can load it.
 *
 * Two ways to be an admin, OR'd together:
 *   • **Target** — the Clerk user's `publicMetadata.role === 'admin'`.
 *   • **Bridge MVP** — the user's email is in the `MIYAGI_ADMIN_EMAILS` env
 *     comma-list. This works *before* any Clerk role config exists, so the
 *     admin shell is reachable from day one (Daniel adds his email in Vercel).
 */

/** Parse a `MIYAGI_ADMIN_EMAILS` comma-list → trimmed, lowercased, de-duped, non-empty. */
export function parseAdminEmails(raw?: string | null): string[] {
  if (!raw) return []
  const out = new Set<string>()
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase()
    if (email) out.add(email)
  }
  return [...out]
}

export interface AdminIdentityInput {
  /** The Clerk user's email (any case). */
  email?: string | null
  /** The Clerk user's `publicMetadata.role`. */
  role?: unknown
  /**
   * The admin email allow-list. Defaults to `process.env.MIYAGI_ADMIN_EMAILS`
   * so callers can omit it; pass an explicit list in tests.
   */
  adminEmails?: string[]
}

/**
 * Is this identity a platform admin? `true` when the Clerk role is `'admin'`
 * OR the email is in the allow-list (case-insensitive). Never throws.
 */
export function isAdminUser(input: AdminIdentityInput): boolean {
  const { email, role } = input
  if (role === 'admin') return true
  const list = input.adminEmails ?? parseAdminEmails(process.env.MIYAGI_ADMIN_EMAILS)
  if (!email) return false
  return list.includes(email.trim().toLowerCase())
}

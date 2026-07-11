/**
 * Resolves the slug of the platform-owned seller that bills print-ad
 * placements — config-addressable via `PLATFORM_SELLER_SLUG`, not a
 * hardcoded merchant-shop constant. A non-empty override always wins over the
 * env var; an empty/whitespace-only override or env value resolves to `null`.
 * Zero imports on purpose: kept next-free/network-free so it's testable
 * outside the Next.js runtime (Playwright's `api` project).
 */
export function resolvePlatformSellerSlug(override?: string | null): string | null {
  const slug = (override || process.env.PLATFORM_SELLER_SLUG || '').trim()
  return slug || null
}

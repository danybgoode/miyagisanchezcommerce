/**
 * Pure URL/outcome logic for `scripts/backfill-hotlinked-images.mjs`.
 *
 * Split out so the decisions are testable without R2, Supabase or Medusa
 * credentials (see e2e/hotlinked-image-urls.spec.ts). The script stays a thin
 * write around these functions.
 */

/**
 * Absolutize a stored image URL.
 *
 * 🚨 Shopify-imported listings store images PROTOCOL-RELATIVE — `//cdn.shopify.com/...`,
 * not `https://cdn.shopify.com/...`. Neither `fetch()` nor `new URL()` can parse that
 * without a base, so every ingest threw `Failed to parse URL` and the 2026-09-02 run
 * migrated ZERO of 89 images across 28 listings while reporting
 * `partially_fixed=28 failed=0`.
 *
 * `//host/path` is a valid URL reference that inherits the page's scheme; server-side
 * there is no page, so it must be pinned. https, never http: these are public CDN assets
 * we are about to copy into R2, and downgrading the fetch would strip transport integrity
 * from the one hop that decides what we store.
 */
export function absolutizeImageUrl(url) {
  if (typeof url !== 'string') return url
  const trimmed = url.trim()
  // `//host` only — `///` is not a host-relative reference, and a bare `/path` has no host
  // to reach at all, so neither is something this backfill can fetch.
  if (trimmed.startsWith('//') && !trimmed.startsWith('///')) return `https:${trimmed}`
  return trimmed
}

/**
 * Is this image served from somewhere other than our R2 bucket?
 *
 * Absolutize first: otherwise a protocol-relative URL lands in the catch and is called
 * external for the wrong reason, and a protocol-relative R2 URL would be misread as
 * hotlinked and needlessly re-ingested.
 */
export function isExternalImageUrl(url, r2Host) {
  try {
    return new URL(absolutizeImageUrl(url)).hostname !== r2Host
  } catch {
    return true // unparsable → treat as needing attention, never as already-fine
  }
}

/**
 * Classify one listing's apply result.
 *
 * 🚨 The bug this replaces: any listing with at least one failed image was counted
 * `partiallyFixed` — including one where EVERY image failed. Combined with `failed` only
 * counting write errors, a run that moved nothing reported `fixed=0 partially_fixed=28
 * failed=0`, which reads as partial success. "I migrated none of them" is a FAILURE and
 * must be counted as one; three states, never two.
 */
export function classifyListingOutcome({ externalCount, migratedCount }) {
  if (externalCount === 0) return 'unchanged'
  if (migratedCount === 0) return 'failed'
  if (migratedCount < externalCount) return 'partially_fixed'
  return 'fixed'
}

/**
 * Nothing migrated means the images array is byte-identical to what is already stored, so
 * the PATCH would be a no-op write to two production systems. Skip it — a write that
 * changes nothing still burns rate limit and muddies `updated_at`.
 */
export function shouldWriteImages(outcome) {
  return outcome === 'fixed' || outcome === 'partially_fixed'
}

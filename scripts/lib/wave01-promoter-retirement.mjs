/**
 * Plan the one-time Wave 01 correction from facts already read from Medusa and
 * the Supabase mirror. The two stores cannot share a transaction, so a retry
 * must finish a partial state rather than treating it as an impossible one.
 */
export const WAVE01_NAMES = ['Kokone', 'Kaab', 'Curated Basics', 'Concrete Garden Candles']
export const RETIRED_SUFFIX = '-preview-retired-20260820'
export const MAX_SELLER_SLUG_LENGTH = 40

/** Refuse ambiguity: audit provenance, not a best-effort name match, identifies a preview. */
export function selectRetirementTargets(rows) {
  const failures = []
  const targets = []

  for (const name of WAVE01_NAMES) {
    const matches = rows.filter((row) => row?.name === name)
    if (matches.length !== 1) {
      failures.push(`${name}: expected exactly one mirror row, found ${matches.length}`)
      continue
    }
    const row = matches[0]
    if (row.clerk_user_id != null) {
      failures.push(`${name}: REFUSE claimed shop`)
      continue
    }
    if (typeof row.source_url !== 'string' || !row.source_url.toLowerCase().startsWith('promoter://')) {
      failures.push(`${name}: REFUSE non-promoter provenance (${String(row.source_url)})`)
      continue
    }
    if (typeof row.slug !== 'string' || !row.slug.trim()) {
      failures.push(`${name}: REFUSE missing mirror slug`)
      continue
    }
    const sellerId = row.metadata?.medusa_seller_id
    if (typeof sellerId !== 'string' || !sellerId.startsWith('sel_')) {
      failures.push(`${name}: REFUSE mirror has no canonical Medusa seller id`)
      continue
    }
    const retiredSlug = row.slug.endsWith(RETIRED_SUFFIX)
      ? row.slug
      : `${row.slug.slice(0, Math.max(1, MAX_SELLER_SLUG_LENGTH - RETIRED_SUFFIX.length))}${RETIRED_SUFFIX}`
    targets.push({ row, sellerId, retiredSlug })
  }

  if (failures.length) {
    throw new Error(`Wave 01 retirement refused:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  }
  return targets
}

export function planWave01Retirement(input) {
  const mirrorNeedsRetire = input.mirrorSlug !== input.retiredSlug
  return {
    // A seller could have been renamed before a status or mirror write failed.
    // The shell proves the deterministic slug with the backend's no-op route.
    ensureSellerSlug: mirrorNeedsRetire,
    retireSeller: input.sellerStatus !== 'deleted',
    updateMirrorSlug: mirrorNeedsRetire,
  }
}

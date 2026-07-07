/**
 * Order tags — ml-orders-native S3 · US-7. Pure + next-free so it's unit-testable
 * with no auth/network, mirroring the `lib/ml-order-badge.ts` convention. This is
 * the client-side preview/validation layer; the backend's `[id]/tags` route does
 * the authoritative persist-time normalize independently (small, mirrored logic —
 * same accepted duplication as `manual-payment-state.ts`/`refund-state.ts`).
 */

const MAX_TAG_LENGTH = 30

/** Trim + collapse whitespace + cap length. Empty/whitespace-only → null (reject). */
export function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
  return trimmed.length ? trimmed : null
}

/** Case-insensitive dedupe, preserving first-seen casing and order. */
export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** Add a tag if valid and not already present (case-insensitive). No-op otherwise. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw)
  if (!tag) return tags
  const exists = tags.some((t) => t.toLowerCase() === tag.toLowerCase())
  return exists ? tags : [...tags, tag]
}

/** Remove a tag by case-insensitive match. */
export function removeTag(tags: string[], raw: string): string[] {
  const target = raw.trim().toLowerCase()
  return tags.filter((t) => t.toLowerCase() !== target)
}

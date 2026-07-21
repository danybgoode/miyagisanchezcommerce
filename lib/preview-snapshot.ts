/**
 * lib/preview-snapshot.ts
 *
 * Founding merchant consent-safe previews · Sprint 2 — the deterministic snapshot
 * of "exactly what will be published", and the material-change resolver that
 * decides when an existing approval goes stale.
 *
 * Deliberately ZERO app imports (no `server-only`, no Supabase) so the consent
 * logic — the part that must never silently drift — is directly unit-testable from
 * a Playwright `api` spec. `lib/preview-consent.ts` composes these with the DB.
 *
 * The consent rule this encodes (epic decision #2, locked at scope approval):
 * approval covers a SPECIFIC reviewed snapshot. If a material field changes after
 * approval, the approval no longer describes what would be published, so it is
 * invalidated and must be re-obtained. Cosmetic changes explicitly do not.
 */
import { createHash } from 'crypto'

/** A product as it would be published — only the fields a merchant actually reviews. */
export interface SnapshotProduct {
  id: string
  title: string
  priceCents: number | null
  currency: string
  imageUrl: string | null
}

/** The full reviewed proposal: shop identity + the exact product set. */
export interface PreviewSnapshot {
  shopName: string
  shopSlug: string
  products: SnapshotProduct[]
}

/**
 * MATERIAL fields — a change to any of these invalidates an existing approval.
 * Locked at scope approval: title, price, image, product membership, shop identity.
 * Everything not derivable from this list is cosmetic by construction, because the
 * hash below is computed over exactly these fields and nothing else.
 */
export const MATERIAL_PRODUCT_FIELDS = ['id', 'title', 'priceCents', 'currency', 'imageUrl'] as const
export const MATERIAL_SHOP_FIELDS = ['shopName', 'shopSlug'] as const

/**
 * Canonicalize a snapshot into a stable string. Products are sorted so a pure
 * reordering (a cosmetic difference — the merchant reviewed the same set) does NOT
 * invalidate approval, while an added/removed/edited product does. Nullish
 * price/image normalize to JSON `null` so `null` and `undefined` can't produce two
 * different hashes for the same proposal.
 */
export function canonicalizeSnapshot(snapshot: PreviewSnapshot): string {
  // Encoded STRUCTURALLY via JSON, not string-concatenated: concatenation makes
  // field boundaries ambiguous (title "AB" + price "1" would canonicalize
  // identically to title "A" + price "B1"), which would let a real material edit
  // hash the same as the approved snapshot and slip past invalidation.
  // JSON.stringify escapes the separators, so every boundary is unambiguous.
  const products = [...(snapshot.products ?? [])]
    .map((p) => JSON.stringify([
      p.id ?? '',
      p.title ?? '',
      p.priceCents === null || p.priceCents === undefined ? null : p.priceCents,
      (p.currency ?? 'MXN').toUpperCase(),
      p.imageUrl ?? null,
    ]))
    // Sort on the encoded form so ordering is total + deterministic: a pure
    // reordering of the same set is cosmetic (same merchant-reviewed proposal),
    // while an added/removed/edited product changes the encoding.
    .sort()
  return JSON.stringify([snapshot.shopName ?? '', snapshot.shopSlug ?? '', products])
}

/**
 * The snapshot's content hash — the approval's version identity. Two proposals with
 * identical material content hash identically (so a re-save that changes nothing is
 * idempotent and must NOT bump the version or invalidate approval).
 */
export function hashSnapshot(snapshot: PreviewSnapshot): string {
  return createHash('sha256').update(canonicalizeSnapshot(snapshot)).digest('hex')
}

/** Did the material content change between two snapshots? */
export function isMaterialChange(a: PreviewSnapshot, b: PreviewSnapshot): boolean {
  return hashSnapshot(a) !== hashSnapshot(b)
}

/**
 * Human-readable reasons a snapshot differs — surfaced to the promoter so
 * "approval went stale" is never a mystery. es-MX (merchant/promoter-facing copy).
 * Returns [] when nothing material changed.
 */
export function describeMaterialChanges(before: PreviewSnapshot, after: PreviewSnapshot): string[] {
  const reasons: string[] = []
  if ((before.shopName ?? '') !== (after.shopName ?? '')) reasons.push('Cambió el nombre de la tienda.')
  if ((before.shopSlug ?? '') !== (after.shopSlug ?? '')) reasons.push('Cambió la dirección de la tienda.')

  const beforeById = new Map((before.products ?? []).map((p) => [p.id, p]))
  const afterById = new Map((after.products ?? []).map((p) => [p.id, p]))

  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) reasons.push('Se agregó un producto.')
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) reasons.push('Se quitó un producto.')
  }
  for (const [id, afterProduct] of afterById) {
    const beforeProduct = beforeById.get(id)
    if (!beforeProduct) continue
    if ((beforeProduct.title ?? '') !== (afterProduct.title ?? '')) {
      reasons.push(`Cambió el título de "${beforeProduct.title}".`)
    }
    if ((beforeProduct.priceCents ?? null) !== (afterProduct.priceCents ?? null)) {
      reasons.push(`Cambió el precio de "${afterProduct.title}".`)
    }
    if ((beforeProduct.imageUrl ?? null) !== (afterProduct.imageUrl ?? null)) {
      reasons.push(`Cambió la imagen de "${afterProduct.title}".`)
    }
    // `currency` is hashed as material, so it must be explainable too — otherwise
    // a currency-only edit invalidates approval while reporting no reason at all.
    if ((beforeProduct.currency ?? 'MXN').toUpperCase() !== (afterProduct.currency ?? 'MXN').toUpperCase()) {
      reasons.push(`Cambió la moneda de "${afterProduct.title}".`)
    }
  }
  return reasons
}

/**
 * Can this preview be activated (made public)? The single decision point Story 2.3
 * enforces server-side — activation requires a CURRENT approval, i.e. an approval
 * whose snapshot hash still matches what would be published right now.
 *
 * Pure so the rule is unit-testable and can't drift between the route and the UI.
 */
export function canActivate(input: {
  status: string
  approvedSnapshotHash: string | null
  currentSnapshotHash: string
  hasProducts: boolean
}): { ok: true } | { ok: false; reason: string } {
  if (input.status === 'activated') return { ok: true } // idempotent re-activation
  if (!input.hasProducts) return { ok: false, reason: 'La tienda no tiene productos que publicar.' }
  if (input.status !== 'approved' || !input.approvedSnapshotHash) {
    return { ok: false, reason: 'Falta la aprobación del comerciante.' }
  }
  if (input.approvedSnapshotHash !== input.currentSnapshotHash) {
    return { ok: false, reason: 'La propuesta cambió después de la aprobación. Pide una nueva aprobación.' }
  }
  return { ok: true }
}

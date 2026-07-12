import type { Listing } from './types'

/**
 * Pure listing-collection derivation — kept free of any `next/*` import (same
 * discipline as lib/listing-query.ts) so the Playwright `api` runner can
 * unit-test it directly.
 *
 * Mirrors apps/backend/src/api/store/_utils/category-split.ts: a Medusa
 * product category is a seller-defined collection iff its handle starts with
 * `${sellerSlug}-`; everything else is the platform taxonomy category. Every
 * product had at most one category until own-shop-premium-presentation S2
 * attached seller collections to the same many-to-many pivot — after which a
 * positional `categories?.[0]` read (the prior convention here and in the
 * backend) is no longer safe.
 */

export interface CategoryRow {
  id: string
  handle: string
  name?: string
  metadata?: unknown
}

export interface SplitCategoriesFrontend {
  platformCategory: CategoryRow | null
  collections: CategoryRow[]
}

function sortOrder(metadata: unknown): number {
  const raw = (metadata as Record<string, unknown> | null | undefined)?.sort_order
  return typeof raw === 'number' ? raw : Number.MAX_SAFE_INTEGER
}

export function splitCategoriesFrontend(
  categories: CategoryRow[] | null | undefined,
  sellerSlug?: string | null,
): SplitCategoriesFrontend {
  const rows = categories ?? []
  const prefix = sellerSlug ? `${sellerSlug}-` : null

  let platformCategory: CategoryRow | null = null
  const collections: CategoryRow[] = []

  for (const row of rows) {
    if (prefix && row.handle.startsWith(prefix)) {
      collections.push(row)
    } else if (!platformCategory) {
      platformCategory = row
    }
  }

  collections.sort((a, b) => sortOrder(a.metadata) - sortOrder(b.metadata))

  return { platformCategory, collections }
}

/** Strips the `${sellerSlug}-` prefix so the buyer-facing URL segment is the short form (`die-cut`), never the namespaced DB handle. */
export function shortCollectionSlug(handle: string, sellerSlug: string): string {
  const prefix = `${sellerSlug}-`
  return handle.startsWith(prefix) ? handle.slice(prefix.length) : handle
}

export type CollectionNameValidation = { ok: true; name: string } | { ok: false; error: string }

/**
 * Validates + trims a proposed collection name — the same 2–60 char bounds
 * `createSellerCollection` (backend `store/_utils/seller-collections.ts`)
 * enforces, checked here first so the `create_collection` MCP tool returns a
 * clear, tool-specific error instead of a generic backend failure surfacing
 * later. Kept next-free so it's directly unit-testable.
 */
export function validateCollectionName(raw: unknown): CollectionNameValidation {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name || name.length < 2) return { ok: false, error: 'El nombre de la colección debe tener al menos 2 caracteres.' }
  if (name.length > 60) return { ok: false, error: 'El nombre de la colección es demasiado largo (máx. 60 caracteres).' }
  return { ok: true, name }
}

export type ListingTitleValidation = { ok: true; title: string } | { ok: false; error: string }

/**
 * Validates + trims a proposed listing title for `update_listing` (MCP
 * parity-core S1.5) — the same bound `create_listing` already enforces via
 * `validateRows` (`lib/catalog-import.ts`), checked here first so the tool
 * rejects an out-of-bounds title with a clear error instead of the backend
 * silently truncating it (`seller-product-update.ts`'s `.slice(0,100)`).
 * Kept next-free so it's directly unit-testable.
 */
export function validateListingTitle(raw: unknown): ListingTitleValidation {
  const title = typeof raw === 'string' ? raw.trim() : ''
  if (!title) return { ok: false, error: 'El título no puede estar vacío.' }
  if (title.length > 100) return { ok: false, error: 'El título es demasiado largo (máx. 100 caracteres).' }
  return { ok: true, title }
}

export interface ShopCollectionNavEntry {
  href: string
  label: string
  shortSlug: string | null
  count: number
}

/**
 * The shape `getShopCollections()` (lib/listings.ts) actually returns —
 * `sort_order` flattened to a top-level field (mirroring the backend's
 * `SellerCollection`), NOT nested under `metadata` like the raw Medusa
 * category rows `CategoryRow`/`splitCategoriesFrontend` read. Conflating the
 * two shapes here previously made `deriveShopCollections`'s own sort a
 * silent no-op — `metadata` is always absent on this shape, so `sortOrder()`
 * returned `MAX_SAFE_INTEGER` for every row and `Array.sort` degenerated to
 * "whatever order the array arrived in" (cross-agent review catch,
 * 2026-07-07 — the backend happens to pre-sort its response, which is why
 * this never visibly broke, but the frontend sort itself was dead code).
 */
export interface ShopCollectionRow {
  id: string
  handle: string
  name: string
  sort_order: number
}

/**
 * Nav-strip entries for a shop's collections: "Todos" always first (even with
 * zero collections), then each collection the seller owns, ordered by
 * `sort_order`. `basePath` is the channel-appropriate prefix — `/s/${slug}`
 * on the marketplace, `''` (root) when already on-channel (subdomain/custom
 * domain) — so the caller decides the URL shape, not this pure function. The
 * href always uses the SHORT slug (prefix stripped) — the namespaced DB
 * handle is an implementation detail, never surfaced in a URL.
 */
export function deriveShopCollections(
  listings: Listing[],
  allCollections: ShopCollectionRow[],
  basePath: string,
  sellerSlug: string,
): ShopCollectionNavEntry[] {
  const sorted = [...allCollections].sort((a, b) => a.sort_order - b.sort_order)
  const entries: ShopCollectionNavEntry[] = [
    { href: basePath || '/', label: 'Todos', shortSlug: null, count: listings.length },
  ]
  for (const c of sorted) {
    const shortSlug = shortCollectionSlug(c.handle, sellerSlug)
    const count = listings.filter((l) => l.collections?.includes(c.handle)).length
    entries.push({
      href: `${basePath}/c/${shortSlug}`,
      label: c.name ?? c.handle,
      shortSlug,
      count,
    })
  }
  return entries
}

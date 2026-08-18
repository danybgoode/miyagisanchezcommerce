/**
 * Living Shop — the Wall's shared types (epic 07 · living-shop-social-storefront).
 *
 * Type-only, so this module is erased at compile time and stays importable from
 * both server routes and client components without dragging anything along.
 *
 * The Wall grammar is fixed at four kinds and three states; both unions are
 * closed here and mirrored by CHECK constraints in
 * `supabase/migrations/20260818120000_shop_wall_entries.sql`. When they disagree
 * the database wins — it is the one that cannot be bypassed.
 */

/** The four public entry kinds. There is no arbitrary block library (epic D2 of the scope). */
export type WallKind = 'post' | 'product' | 'collection' | 'event'

/** Publication state. `scheduled` becomes public at `scheduled_for`, without a job running. */
export type WallStatus = 'draft' | 'published' | 'scheduled'

/** One uploaded image. `url` is always platform-issued (epic D10) — never a remote fetch. */
export interface WallMedia {
  url: string
  /** Required for a meaningful image; empty string marks a decorative one. */
  alt: string
}

/** A row of `shop_wall_entries`, exactly as persisted. */
export interface WallEntry {
  id: string
  shop_id: string
  kind: WallKind
  status: WallStatus
  body: string | null
  media: WallMedia[]
  reference_id: string | null
  published_at: string | null
  scheduled_for: string | null
  pinned: boolean
  created_by: string
  created_at: string
  updated_at: string
}

/**
 * What a seller may send. Every field is optional on update; `kind` is required
 * on create and immutable afterwards (changing a post into a product would
 * invalidate the reference/body pairing the table enforces).
 */
export interface WallEntryInput {
  kind?: unknown
  status?: unknown
  body?: unknown
  media?: unknown
  reference_id?: unknown
  scheduled_for?: unknown
  pinned?: unknown
}

/**
 * The canonical object a referenced entry resolves to at read time — never
 * persisted, always re-fetched (epic D3). `unavailable` is a real third state:
 * the reference exists but its object is gone, unpublished or foreign, which is
 * a different fact from "this entry has no reference".
 */
export type WallReferenceResolution =
  | { state: 'none' }
  | { state: 'unavailable'; reason: 'missing' | 'unpublished' | 'foreign' }
  | { state: 'product'; product: WallProductView }
  | { state: 'collection'; collection: WallCollectionView }
  | { state: 'event'; event: WallEventView }

export interface WallProductView {
  id: string
  title: string
  href: string
  imageUrl: string | null
  formattedPrice: string | null
  available: boolean
}

export interface WallCollectionView {
  handle: string
  name: string
  href: string
  /** A bounded sample of currently-public products, for the card's strip. */
  sample: Array<{ id: string; title: string; imageUrl: string | null; href: string }>
  productCount: number
}

export interface WallEventView {
  slug: string
  title: string
  href: string
  startsAt: string
  venueName: string
  cancelled: boolean
  past: boolean
}

/** A Wall entry as the public renderer and the agent representation see it. */
export interface PublicWallEntry {
  id: string
  kind: WallKind
  body: string | null
  media: WallMedia[]
  pinned: boolean
  /** The instant this entry became (or becomes) public. */
  effective_at: string
  reference: WallReferenceResolution
}

import 'server-only'

/**
 * Living Shop — the public Wall read (epic 07, Sprint 2).
 *
 * ONE composition of store → visibility → resolver, shared by the shop homepage,
 * the load-more route and the agent representation (Sprint 6). Three consumers
 * reading the Wall three different ways is how a draft eventually leaks out of
 * one of them.
 */

import { listPublicWallEntries } from './store'
import { orderPublicWall, paginate } from './visibility'
import { resolveWallEntries } from './resolve'
import { WALL_PAGE_SIZE } from './validate'
import type { PublicWallEntry } from './types'

export interface PublicWallPage {
  entries: PublicWallEntry[]
  hasMore: boolean
  /** Total publicly-visible entries right now — the count the nav/empty state reads. */
  total: number
}

export interface PublicWallRequest {
  shopId: string
  shopSlug: string
  /** Where the SHOP's routes live: `''` on an owned host, `/mx/s/<slug>` otherwise. */
  basePath: string
  /** Where a PRODUCT lives: `''` on an owned host, `/mx` on the marketplace. */
  listingBase: string
  locale?: string
  offset?: number
  pageSize?: number
  now?: Date
}

/**
 * A bounded page of this shop's public Wall, references already resolved.
 *
 * The store read fetches published AND scheduled rows and `orderPublicWall`
 * applies the schedule boundary here — filtering scheduled rows in SQL would
 * hide entries that are already due, since nothing flips their status.
 *
 * Only the page's OWN entries get resolved, so a shop with a long history pays
 * for what it shows, not for what it has.
 */
export async function readPublicWall(req: PublicWallRequest): Promise<PublicWallPage> {
  const now = req.now ?? new Date()
  const pageSize = req.pageSize ?? WALL_PAGE_SIZE
  const rows = await listPublicWallEntries(req.shopId)
  const ordered = orderPublicWall(rows, now)
  const { items, hasMore } = paginate(ordered, req.offset ?? 0, pageSize)
  const entries = await resolveWallEntries(items, {
    shopId: req.shopId,
    shopSlug: req.shopSlug,
    basePath: req.basePath,
    listingBase: req.listingBase,
    locale: req.locale ?? 'es-MX',
    now,
  })
  return { entries, hasMore, total: ordered.length }
}

/**
 * Whether this shop has anything on its Wall right now. Used by the homepage to
 * choose between the Wall narrative and the designed new-shop state, and by the
 * section config to avoid offering a destination with nothing behind it.
 */
export async function hasPublicWall(shopId: string, now = new Date()): Promise<boolean> {
  const rows = await listPublicWallEntries(shopId, 1_000)
  return orderPublicWall(rows, now).length > 0
}

import 'server-only'

/**
 * Living Shop — Wall persistence (epic 07 · living-shop-social-storefront).
 *
 * The I/O shell around `lib/wall/validate.ts` and `lib/wall/visibility.ts`. It
 * owns exactly one thing the pure half cannot: WHICH SHOP a write belongs to.
 *
 * Epic D2 — the ownership boundary. This app reaches Supabase through one
 * service-role client, which bypasses RLS by construction, so RLS here is
 * defence in depth and NOT the control. The control is that `shop_id` is
 * resolved from the Clerk session on every call and is never read from a request
 * body. There is deliberately no function in this module that accepts a
 * caller-supplied shop id — the type system is the enforcement, because a rule
 * that lives only in a comment is a rule that gets skipped by the next caller.
 */

import { db } from '@/lib/supabase'
import type { WallEntry, WallStatus } from './types'
import type { WallValidated } from './validate'
import { canTransition, nextPublishedAt } from './visibility'

const TABLE = 'shop_wall_entries'

/** Every column, named once. `select('*')` would silently pick up future columns. */
const COLUMNS =
  'id, shop_id, kind, status, body, media, reference_id, published_at, scheduled_for, pinned, created_by, created_at, updated_at'

export interface WallShop {
  id: string
  slug: string
  name: string
}

/**
 * The caller's own shop, or null. The ONLY way a write path learns a shop id.
 *
 * Mirrors the ordering every other seller surface uses (`created_at asc, limit 1`)
 * so a seller with two shop rows edits the same one everywhere.
 */
export async function resolveOwnShop(clerkUserId: string): Promise<WallShop | null> {
  const { data } = await db
    .from('marketplace_shops')
    .select('id, slug, name')
    .eq('clerk_user_id', clerkUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

function rowToEntry(row: Record<string, unknown>): WallEntry {
  return {
    ...(row as unknown as WallEntry),
    // `media` is jsonb; a hand-written row or a failed default could hold a
    // non-array. Coercing here keeps every consumer's `.map` safe without each
    // one re-checking.
    media: Array.isArray(row.media) ? (row.media as WallEntry['media']) : [],
  }
}

/** The seller's own management list — every status, newest first. */
export async function listOwnWallEntries(shopId: string, limit = 100): Promise<WallEntry[]> {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`[wall] seller list failed: ${error.message}`)
  return (data ?? []).map(rowToEntry)
}

/**
 * Public-destined entries for one shop. Returns published AND scheduled rows —
 * the schedule boundary is applied by `isPubliclyVisible` at render time (there
 * is no cron; see `visibility.ts`), so filtering scheduled rows out here would
 * hide entries that are already due.
 */
export async function listPublicWallEntries(shopId: string, limit = 60): Promise<WallEntry[]> {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq('shop_id', shopId)
    .in('status', ['published', 'scheduled'])
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(`[wall] public list failed: ${error.message}`)
  return (data ?? []).map(rowToEntry)
}

/**
 * One entry, scoped to the shop. Both ids are in the predicate on purpose: an
 * id-only read followed by an ownership `if` is the shape that lets a refactor
 * drop the check. Here a foreign id simply does not exist.
 */
export async function getOwnWallEntry(shopId: string, entryId: string): Promise<WallEntry | null> {
  const { data } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq('shop_id', shopId)
    .eq('id', entryId)
    .maybeSingle()
  return data ? rowToEntry(data) : null
}

/**
 * Clear any other pin for this shop. Called before persisting a pin because the
 * partial unique index would otherwise reject the second one — the seller means
 * "pin this instead", not "fail".
 */
async function clearOtherPins(shopId: string, exceptId: string | null): Promise<void> {
  let q = db.from(TABLE).update({ pinned: false, updated_at: new Date().toISOString() }).eq('shop_id', shopId).eq('pinned', true)
  if (exceptId) q = q.neq('id', exceptId)
  const { error } = await q
  if (error) throw new Error(`[wall] clearing previous pin failed: ${error.message}`)
}

export async function createWallEntry(
  shop: WallShop,
  clerkUserId: string,
  value: WallValidated,
  now = new Date(),
): Promise<WallEntry> {
  if (value.pinned) await clearOtherPins(shop.id, null)
  const { data, error } = await db
    .from(TABLE)
    .insert({
      shop_id: shop.id,
      kind: value.kind,
      status: value.status,
      body: value.body,
      media: value.media,
      reference_id: value.reference_id,
      published_at: nextPublishedAt(null, value.status, now),
      scheduled_for: value.scheduled_for,
      pinned: value.pinned,
      created_by: clerkUserId,
    })
    .select(COLUMNS)
    .single()
  if (error || !data) throw new Error(`[wall] create failed: ${error?.message ?? 'no row returned'}`)
  return rowToEntry(data)
}

export type WallUpdateOutcome =
  | { ok: true; entry: WallEntry }
  | { ok: false; status: number; error: string }

export async function updateWallEntry(
  shop: WallShop,
  existing: WallEntry,
  value: WallValidated,
  now = new Date(),
): Promise<WallUpdateOutcome> {
  if (!canTransition(existing.status as WallStatus, value.status)) {
    return { ok: false, status: 422, error: `No se puede pasar de ${existing.status} a ${value.status}.` }
  }
  if (value.pinned) await clearOtherPins(shop.id, existing.id)

  const { data, error } = await db
    .from(TABLE)
    .update({
      status: value.status,
      body: value.body,
      media: value.media,
      reference_id: value.reference_id,
      published_at: nextPublishedAt(existing.published_at, value.status, now),
      scheduled_for: value.scheduled_for,
      pinned: value.pinned,
      updated_at: now.toISOString(),
    })
    .eq('shop_id', shop.id)
    .eq('id', existing.id)
    .select(COLUMNS)
    // `.select()` back, and treat "no row" as a failure: supabase-js reports no
    // error for an UPDATE that matched nothing, so without this the route would
    // answer 200 for a write that did not happen.
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!data) return { ok: false, status: 404, error: 'La publicación ya no existe.' }
  return { ok: true, entry: rowToEntry(data) }
}

/** Returns whether a row was actually removed — same reason as the update's `.select()`. */
export async function deleteWallEntry(shopId: string, entryId: string): Promise<boolean> {
  const { data, error } = await db
    .from(TABLE)
    .delete()
    .eq('shop_id', shopId)
    .eq('id', entryId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`[wall] delete failed: ${error.message}`)
  return !!data
}

/**
 * Entries pointing at one canonical object, across every shop. Used by the
 * lifecycle sweep (S7.5) to answer "what breaks if this product goes away" —
 * it never answers a public read, so it is not shop-scoped.
 */
export async function countWallReferences(referenceId: string): Promise<number> {
  const { count, error } = await db
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('reference_id', referenceId)
  if (error) throw new Error(`[wall] reference count failed: ${error.message}`)
  return count ?? 0
}

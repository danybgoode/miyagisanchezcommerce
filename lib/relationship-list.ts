/**
 * lib/relationship-list.ts
 *
 * Founding merchant activation operations · Sprint 2 (Story 2.3) — the
 * scoped LIST reads behind `GET /api/promoter/relationships` and
 * `GET /api/admin/relationships`.
 *
 * This is a LIST-shaped sibling of `lib/relationship-access.ts#resolveRelationshipAccess`,
 * not a re-implementation of its rule: the SAME four populations (the
 * caller's own `promoter_id`, the assigned STEWARD, an active `partner_grants`
 * shop, or admin — unconditional) decide who is IN the list here that decide
 * who passes the per-id check there — including the steward mirror added for
 * C1 (PR 304 review): a reassigned steward's records must appear in their own
 * pipeline, not just pass the per-id check if they already know the id. This
 * is exactly the relationship S1's `scopedRelationshipCandidates` already has
 * to the single-id check, for the fuzzy-duplicate scan — same pairing, new
 * purpose. Kept in a separate file (rather than added onto
 * `lib/relationship-access.ts`) so Sprint 1's still-in-review module stays
 * untouched by Sprint 2's additions beyond the C1 steward-role branch.
 *
 * FAIL-CLOSED ON READ ERRORS (C3, PR 304 review): every query here returns
 * `{ ok: false }` on a Supabase error instead of silently substituting `[]`.
 * A read failure and "genuinely nothing there" must never look the same to
 * the caller — the exact rule `resolveRelationshipAccess` already applies
 * (a malformed-UUID/error read is FORBIDDEN, never treated as an empty
 * relationship). The route callers turn `{ ok: false }` into a 500, never a
 * silently-empty 200 list.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import type { RelationshipActor, RelationshipRow } from '@/lib/relationship-access'

const COLUMNS =
  'id, business_name, contact_name, phone_e164, email_normalized, whatsapp_e164, ' +
  'instagram_handle, estado, municipio, location_note, category, current_channels, ' +
  'preferred_channel, qualification, fit_note, objections, promoter_id, cohort, source, ' +
  'steward_clerk_user_id, shop_id, preview_id, stage, stage_entered_at, intake_complete, ' +
  'created_by, created_at, updated_at'

export type ScopedListResult = { ok: true; rows: RelationshipRow[] } | { ok: false }

/**
 * `GET /api/promoter/relationships` — the caller's OWNED + STEWARDED +
 * GRANTED relationships (admin gets the full cohort here too, mirroring the
 * per-id rule where `resolveRelationshipAccess` grants admin unconditionally).
 * Any one of the underlying reads failing fails the WHOLE call closed —
 * merging a partial result would silently under-report a steward's or a
 * grant-holder's pipeline as smaller than it really is.
 */
export async function listScopedRelationships(actor: RelationshipActor): Promise<ScopedListResult> {
  if (actor.isAdmin) {
    const { data, error } = await db.from('merchant_relationships').select(COLUMNS).order('created_at', { ascending: false })
    if (error) return { ok: false }
    return { ok: true, rows: (data as unknown as RelationshipRow[] | null) ?? [] }
  }

  const rowsById = new Map<string, RelationshipRow>()

  if (actor.promoterId) {
    const { data, error } = await db
      .from('merchant_relationships')
      .select(COLUMNS)
      .eq('promoter_id', actor.promoterId)
      .order('created_at', { ascending: false })
    if (error) return { ok: false }
    for (const row of (data as unknown as RelationshipRow[] | null) ?? []) rowsById.set(row.id, row)
  }

  // C1 mirror: the assigned steward sees their records too, independent of
  // `promoter_id`/grants — see `resolveRelationshipAccess`'s doc comment for
  // the full reasoning (read-side only, never an auto-inserted grant row).
  {
    const { data, error } = await db.from('merchant_relationships').select(COLUMNS).eq('steward_clerk_user_id', actor.clerkUserId)
    if (error) return { ok: false }
    for (const row of (data as unknown as RelationshipRow[] | null) ?? []) rowsById.set(row.id, row)
  }

  if (actor.promoterId) {
    const { data: grants, error: grantsError } = await db
      .from('partner_grants')
      .select('shop_id')
      .eq('promoter_id', actor.promoterId)
      .is('revoked_at', null)
    if (grantsError) return { ok: false }
    const shopIds = ((grants ?? []) as Array<{ shop_id: string }>).map((g) => g.shop_id).filter(Boolean)
    if (shopIds.length > 0) {
      const { data, error } = await db.from('merchant_relationships').select(COLUMNS).in('shop_id', shopIds)
      if (error) return { ok: false }
      for (const row of (data as unknown as RelationshipRow[] | null) ?? []) rowsById.set(row.id, row)
    }
  }

  // D4 fix (PR 304 review, round 3): sort the MERGED result deterministically
  // — only the "own" leg above carried an explicit `.order()`; the steward
  // and granted legs didn't, so the combined array's order depended on
  // `Map` INSERTION order (own, then steward, then granted) rather than any
  // meaningful field, and Supabase itself doesn't guarantee a stable row
  // order without an explicit `.order()`. Newest-first, matching
  // `listAllRelationships`'s own convention.
  const rows = Array.from(rowsById.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
  return { ok: true, rows }
}

export interface AdminRelationshipFilters {
  stage?: string
  steward?: string
}

/**
 * `GET /api/admin/relationships` — the FULL cohort. Only the single-table,
 * column-level filters (`stage`, `steward`) are applied here; `blocker`,
 * `missing_action` and `overdue` need a second table (open tasks) joined in
 * application code by the route, using `lib/relationship-pipeline.ts`, so
 * they don't belong in this query. ADMIN-ONLY — the route enforces that
 * BEFORE calling this; this function trusts its caller.
 */
export async function listAllRelationships(filters: AdminRelationshipFilters): Promise<ScopedListResult> {
  let query = db.from('merchant_relationships').select(COLUMNS).order('created_at', { ascending: false })
  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.steward) query = query.eq('steward_clerk_user_id', filters.steward)
  const { data, error } = await query
  if (error) return { ok: false }
  return { ok: true, rows: (data as unknown as RelationshipRow[] | null) ?? [] }
}

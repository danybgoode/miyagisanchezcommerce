/**
 * lib/relationship-list.ts
 *
 * Founding merchant activation operations · Sprint 2 (Story 2.3) — the
 * scoped LIST reads behind `GET /api/promoter/relationships` and
 * `GET /api/admin/relationships`.
 *
 * This is a LIST-shaped sibling of `lib/relationship-access.ts#resolveRelationshipAccess`,
 * not a re-implementation of its rule: the SAME three populations (the
 * caller's own `promoter_id`, an active `partner_grants` shop, or admin —
 * unconditional) decide who is IN the list here that decide who passes the
 * per-id check there. This is exactly the relationship S1's
 * `scopedRelationshipCandidates` already has to the single-id check, for the
 * fuzzy-duplicate scan — same pairing, new purpose. Kept in a separate file
 * (rather than added onto `lib/relationship-access.ts`) so Sprint 1's
 * still-in-review module stays untouched by Sprint 2's additions.
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

/**
 * `GET /api/promoter/relationships` — the caller's OWNED + GRANTED
 * relationships (admin gets the full cohort here too, mirroring the per-id
 * rule where `resolveRelationshipAccess` grants admin unconditionally).
 */
export async function listScopedRelationships(actor: RelationshipActor): Promise<RelationshipRow[]> {
  if (actor.isAdmin) {
    const { data } = await db.from('merchant_relationships').select(COLUMNS).order('created_at', { ascending: false })
    return (data as RelationshipRow[] | null) ?? []
  }

  const ownResult = actor.promoterId
    ? await db
        .from('merchant_relationships')
        .select(COLUMNS)
        .eq('promoter_id', actor.promoterId)
        .order('created_at', { ascending: false })
    : { data: [] as RelationshipRow[] }

  let granted: RelationshipRow[] = []
  if (actor.promoterId) {
    const { data: grants } = await db
      .from('partner_grants')
      .select('shop_id')
      .eq('promoter_id', actor.promoterId)
      .is('revoked_at', null)
    const shopIds = ((grants ?? []) as Array<{ shop_id: string }>).map((g) => g.shop_id).filter(Boolean)
    if (shopIds.length > 0) {
      const { data } = await db.from('merchant_relationships').select(COLUMNS).in('shop_id', shopIds)
      granted = (data as RelationshipRow[] | null) ?? []
    }
  }

  const seen = new Set<string>()
  const merged: RelationshipRow[] = []
  for (const row of [...((ownResult.data as RelationshipRow[] | null) ?? []), ...granted]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  return merged
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
export async function listAllRelationships(filters: AdminRelationshipFilters): Promise<RelationshipRow[]> {
  let query = db.from('merchant_relationships').select(COLUMNS).order('created_at', { ascending: false })
  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.steward) query = query.eq('steward_clerk_user_id', filters.steward)
  const { data } = await query
  return (data as RelationshipRow[] | null) ?? []
}

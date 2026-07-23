/**
 * lib/relationship-access.ts
 *
 * Founding merchant activation operations · Sprint 1 — the ONE shared scope
 * check every `/api/promoter/relationship*` route calls (build contract,
 * sprint-1.md: "Put the scope check in ONE shared helper that every route
 * calls"), plus the append-only field-audit writer (Story 1.3).
 *
 * Access to a relationship is granted to exactly three actors:
 *   1. the caller's own `promoter_id` (their own field-captured record),
 *   2. admin (`lib/admin/guard.ts#currentUserIsAdmin`),
 *   3. a promoter holding an ACTIVE `partner_grants` row for the relationship's
 *      linked `shop_id` — the same grant model `lib/partner-auth.ts` already
 *      uses, reused rather than re-invented (README "what already exists").
 * Anything else is a 403 carrying NO record fields — not a 404 (which would
 * distinguish "doesn't exist" from "not yours" differently than an absent id)
 * and not a partial record. An unresolvable id (bad UUID, genuinely absent)
 * gets the exact same 403 shape as a real id the caller doesn't own, so the
 * response never confirms which case it was.
 *
 * Runtime: Node only (Supabase service-role client + Clerk admin check).
 */
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { currentUserIsAdmin } from '@/lib/admin/guard'
import { getPromoterByClerkId } from '@/lib/promoter'

export interface RelationshipRow {
  id: string
  business_name: string
  contact_name: string | null
  phone_e164: string | null
  email_normalized: string | null
  whatsapp_e164: string | null
  instagram_handle: string | null
  estado: string | null
  municipio: string | null
  location_note: string | null
  category: string | null
  current_channels: string[] | null
  preferred_channel: string | null
  qualification: string
  fit_note: string | null
  objections: string | null
  promoter_id: string | null
  cohort: string | null
  source: string | null
  steward_clerk_user_id: string | null
  shop_id: string | null
  preview_id: string | null
  stage: string
  stage_entered_at: string
  intake_complete: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface RelationshipActor {
  clerkUserId: string
  promoterId: string | null
  isAdmin: boolean
}

/** Resolve the calling Clerk identity to its promoter binding + admin status. */
export async function resolveActor(clerkUserId: string): Promise<RelationshipActor> {
  const [promoter, isAdmin] = await Promise.all([
    getPromoterByClerkId(clerkUserId),
    currentUserIsAdmin(),
  ])
  return { clerkUserId, promoterId: promoter?.id ?? null, isAdmin }
}

export type RelationshipAuthResult =
  | { error: NextResponse; user?: undefined; actor?: undefined }
  | { error?: undefined; user: { id: string }; actor: RelationshipActor }

/**
 * The gate every `/api/promoter/relationship*` route runs FIRST: the
 * `promoter.activation_crm_enabled` flag (OFF ⇒ 404, indistinguishable from
 * absent — the build contract's dark-launch requirement), then a real Clerk
 * session (401), then a rate limit, then the actor's promoter/admin binding.
 * Deliberately does NOT require a promoter binding here — an admin with no
 * promoter code must still be able to reach a route; `resolveRelationshipAccess`
 * (or the create-path's own explicit check) is where binding is enforced.
 */
export async function authorizeRelationshipRequest(req: NextRequest): Promise<RelationshipAuthResult> {
  if (!(await isEnabled('promoter.activation_crm_enabled'))) {
    return { error: NextResponse.json({ ok: false }, { status: 404 }) }
  }
  const user = await currentUser().catch(() => null)
  if (!user) return { error: NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 }) }

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Demasiados intentos. Espera un momento.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      ),
    }
  }

  const actor = await resolveActor(user.id)
  return { user: { id: user.id }, actor }
}

export type RelationshipAccess =
  | { ok: true; relationship: RelationshipRow }
  | { ok: false; status: 403 }

const FORBIDDEN: RelationshipAccess = { ok: false, status: 403 }

/**
 * The shared scope check. Reads the row once and decides access from it —
 * every route (`GET`, the update arm of `POST`, and the `consent` route)
 * calls this instead of re-deriving the rule.
 */
export async function resolveRelationshipAccess(
  relationshipId: string,
  actor: RelationshipActor,
): Promise<RelationshipAccess> {
  if (!relationshipId) return FORBIDDEN

  const { data, error } = await db
    .from('merchant_relationships')
    .select(
      'id, business_name, contact_name, phone_e164, email_normalized, whatsapp_e164, ' +
        'instagram_handle, estado, municipio, location_note, category, current_channels, ' +
        'preferred_channel, qualification, fit_note, objections, promoter_id, cohort, source, ' +
        'steward_clerk_user_id, shop_id, preview_id, stage, stage_entered_at, intake_complete, ' +
        'created_by, created_at, updated_at',
    )
    .eq('id', relationshipId)
    .maybeSingle()
  // A read error (including a malformed-UUID 22P02) is indistinguishable from
  // "not found" here — fail closed, never leak which one it was.
  if (error || !data) return FORBIDDEN

  const row = data as unknown as RelationshipRow

  if (actor.isAdmin) return { ok: true, relationship: row }
  if (actor.promoterId && row.promoter_id === actor.promoterId) return { ok: true, relationship: row }

  if (row.shop_id && actor.promoterId) {
    const { data: grant } = await db
      .from('partner_grants')
      .select('id')
      .eq('shop_id', row.shop_id)
      .eq('promoter_id', actor.promoterId)
      .is('revoked_at', null)
      .maybeSingle()
    if (grant) return { ok: true, relationship: row }
  }

  return FORBIDDEN
}

// ── Field audit (Story 1.3 — "attribution and consent fields are audited on
// every edit") ───────────────────────────────────────────────────────────

/** The columns whose edits get an immutable audit row. */
export const AUDITED_FIELDS = [
  'promoter_id',
  'cohort',
  'source',
  'preferred_channel',
  'preview_id',
] as const
export type AuditedField = (typeof AUDITED_FIELDS)[number]

/**
 * Diff `before` against `after` over `AUDITED_FIELDS` and write one append-only
 * row per field that actually changed. A no-op diff writes nothing. Best-effort
 * (a logging failure never fails the caller's write) — mirrors the discipline
 * already used for `partner_tool_calls` / `admin_audit_log`.
 */
export async function auditFieldChanges(
  relationshipId: string,
  actorClerkUserId: string,
  before: Partial<Record<AuditedField, unknown>>,
  after: Partial<Record<AuditedField, unknown>>,
): Promise<void> {
  const rows = AUDITED_FIELDS.filter((field) => field in after && after[field] !== before[field]).map(
    (field) => ({
      relationship_id: relationshipId,
      field,
      old_value: before[field] == null ? null : String(before[field]),
      new_value: after[field] == null ? null : String(after[field]),
      actor_clerk_user_id: actorClerkUserId,
    }),
  )
  if (rows.length === 0) return
  const { error } = await db.from('merchant_relationship_field_audit').insert(rows)
  if (error) console.error('[relationship-access] field audit insert failed:', error.message)
}

/**
 * Write ONE free-form audit row for an event that isn't a plain column diff —
 * used by the consent route to leave a permanent trail of every successful
 * evidence check, even when it left `preview_id` unchanged (a re-confirmation).
 * Best-effort, same discipline as `auditFieldChanges`.
 */
export async function auditEvent(
  relationshipId: string,
  actorClerkUserId: string,
  field: string,
  newValue: string,
): Promise<void> {
  const { error } = await db.from('merchant_relationship_field_audit').insert({
    relationship_id: relationshipId,
    field,
    old_value: null,
    new_value: newValue,
    actor_clerk_user_id: actorClerkUserId,
  })
  if (error) console.error('[relationship-access] audit event insert failed:', error.message)
}

// ── Client DTO ──────────────────────────────────────────────────────────────

/** The camelCase shape every route hands back to `RelationshipStep`. */
export interface RelationshipDTO {
  id: string
  businessName: string
  contactName: string | null
  phone: string | null
  email: string | null
  whatsapp: string | null
  instagramHandle: string | null
  estado: string | null
  municipio: string | null
  locationNote: string | null
  category: string | null
  currentChannels: string[]
  preferredChannel: string | null
  qualification: string
  fitNote: string | null
  objections: string | null
  promoterId: string | null
  cohort: string | null
  source: string | null
  stewardClerkUserId: string | null
  shopId: string | null
  previewId: string | null
  stage: string
  stageEnteredAt: string
  intakeComplete: boolean
  createdAt: string
  updatedAt: string
}

export function toRelationshipDTO(row: RelationshipRow): RelationshipDTO {
  return {
    id: row.id,
    businessName: row.business_name,
    contactName: row.contact_name,
    phone: row.phone_e164,
    email: row.email_normalized,
    whatsapp: row.whatsapp_e164,
    instagramHandle: row.instagram_handle,
    estado: row.estado,
    municipio: row.municipio,
    locationNote: row.location_note,
    category: row.category,
    currentChannels: row.current_channels ?? [],
    preferredChannel: row.preferred_channel,
    qualification: row.qualification,
    fitNote: row.fit_note,
    objections: row.objections,
    promoterId: row.promoter_id,
    cohort: row.cohort,
    source: row.source,
    stewardClerkUserId: row.steward_clerk_user_id,
    shopId: row.shop_id,
    previewId: row.preview_id,
    stage: row.stage,
    stageEnteredAt: row.stage_entered_at,
    intakeComplete: row.intake_complete,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

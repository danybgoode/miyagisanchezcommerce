/**
 * POST /api/promoter/relationship — create or resume-and-save a founding
 * merchant relationship record (founding-merchant-activation-ops S1.2/S1.3).
 *
 * Two arms, selected by whether the body carries `relationshipId`:
 *   - CREATE (no `relationshipId`): the caller must be a BOUND promoter (the
 *     field-intake story — mirrors `/api/promoter/preview`'s exact 403 shape).
 *     Runs the dedupe precedence (shop_id → phone_e164 → email_normalized,
 *     `lib/merchant-identity.ts#decideDedupeMatch`) BEFORE inserting; a hit
 *     returns 409 with the existing id + `matchReason` unless the caller
 *     passes `confirmNew: true`. A fuzzy business-name hit never blocks —
 *     it comes back as a `suggestions` array on the same 200 (epic Decision 3:
 *     never auto-merge on fuzzy name similarity).
 *   - UPDATE (`relationshipId` present): scope-checked through the ONE shared
 *     helper (`resolveRelationshipAccess`) — an id the caller doesn't own is a
 *     403 with no record fields, not a 404, not a partial write.
 *
 * Gated by `promoter.activation_crm_enabled` FIRST (404 when OFF).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import {
  normalizePhoneE164,
  normalizeEmail,
  businessNameKey,
  isFuzzyNameMatch,
  decideDedupeMatch,
  type DedupeCandidateRows,
} from '@/lib/merchant-identity'
import {
  authorizeRelationshipRequest,
  resolveRelationshipAccess,
  auditFieldChanges,
  toRelationshipDTO,
  type RelationshipRow,
} from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

const PREFERRED_CHANNELS = ['whatsapp', 'phone', 'email', 'instagram', 'in_person'] as const
const QUALIFICATIONS = ['unknown', 'strong', 'medium', 'weak', 'disqualified'] as const

interface RelationshipBody {
  relationshipId?: string
  confirmNew?: boolean
  businessName?: string
  contactName?: string
  phone?: string
  email?: string
  whatsapp?: string
  instagramHandle?: string
  estado?: string
  municipio?: string
  locationNote?: string
  category?: string
  currentChannels?: string[]
  preferredChannel?: string
  qualification?: string
  fitNote?: string
  objections?: string
  cohort?: string
  source?: string
  shopId?: string
  intakeComplete?: boolean
}

function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  return t.length > 0 ? t : null
}

/** Best-effort, non-blocking fuzzy business-name scan (epic Decision 3 — a
 *  suggestion, never a block, never a merge). Bounded to a small candidate set
 *  (matching on the first normalized word) so a busy table never turns this
 *  into a full scan; a failure here never fails the create. */
async function fuzzySuggestions(
  businessName: string,
  excludeId: string,
): Promise<Array<{ id: string; businessName: string }>> {
  const key = businessNameKey(businessName)
  const firstWord = key.split(' ')[0]
  if (!firstWord) return []
  try {
    const { data, error } = await db
      .from('merchant_relationships')
      .select('id, business_name')
      .ilike('business_name', `%${firstWord}%`)
      .neq('id', excludeId)
      .limit(25)
    if (error || !data) return []
    return (data as Array<{ id: string; business_name: string }>)
      .filter((row) => isFuzzyNameMatch(businessName, row.business_name))
      .slice(0, 5)
      .map((row) => ({ id: row.id, businessName: row.business_name }))
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  let body: RelationshipBody = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }

  if (body.preferredChannel && !PREFERRED_CHANNELS.includes(body.preferredChannel as (typeof PREFERRED_CHANNELS)[number])) {
    return NextResponse.json({ ok: false, error: 'Canal preferido inválido.' }, { status: 400 })
  }
  if (body.qualification && !QUALIFICATIONS.includes(body.qualification as (typeof QUALIFICATIONS)[number])) {
    return NextResponse.json({ ok: false, error: 'Calificación inválida.' }, { status: 400 })
  }

  const phoneE164 = body.phone !== undefined ? normalizePhoneE164(body.phone) : undefined
  const emailNormalized = body.email !== undefined ? normalizeEmail(body.email) : undefined
  const whatsappE164 = body.whatsapp !== undefined ? normalizePhoneE164(body.whatsapp) : undefined

  // ── UPDATE arm ─────────────────────────────────────────────────────────
  if (body.relationshipId) {
    const access = await resolveRelationshipAccess(body.relationshipId, auth.actor)
    if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 })

    const before = access.relationship
    const patch: Partial<Record<keyof RelationshipRow, unknown>> = { updated_at: new Date().toISOString() }
    if (body.businessName !== undefined) {
      const name = clean(body.businessName)
      if (!name) return NextResponse.json({ ok: false, error: 'El nombre del negocio no puede estar vacío.' }, { status: 400 })
      patch.business_name = name
    }
    if (body.contactName !== undefined) patch.contact_name = clean(body.contactName)
    if (phoneE164 !== undefined) patch.phone_e164 = phoneE164
    if (emailNormalized !== undefined) patch.email_normalized = emailNormalized
    if (whatsappE164 !== undefined) patch.whatsapp_e164 = whatsappE164
    if (body.instagramHandle !== undefined) patch.instagram_handle = clean(body.instagramHandle)
    if (body.estado !== undefined) patch.estado = clean(body.estado)
    if (body.municipio !== undefined) patch.municipio = clean(body.municipio)
    if (body.locationNote !== undefined) patch.location_note = clean(body.locationNote)
    if (body.category !== undefined) patch.category = clean(body.category)
    if (body.currentChannels !== undefined) patch.current_channels = body.currentChannels
    if (body.preferredChannel !== undefined) patch.preferred_channel = body.preferredChannel || null
    if (body.qualification !== undefined) patch.qualification = body.qualification || 'unknown'
    if (body.fitNote !== undefined) patch.fit_note = clean(body.fitNote)
    if (body.objections !== undefined) patch.objections = clean(body.objections)
    if (body.cohort !== undefined) patch.cohort = clean(body.cohort)
    if (body.source !== undefined) patch.source = clean(body.source)
    if (body.intakeComplete !== undefined) patch.intake_complete = !!body.intakeComplete

    const { data, error } = await db
      .from('merchant_relationships')
      .update(patch)
      .eq('id', body.relationshipId)
      .select(
        'id, business_name, contact_name, phone_e164, email_normalized, whatsapp_e164, instagram_handle, ' +
          'estado, municipio, location_note, category, current_channels, preferred_channel, qualification, ' +
          'fit_note, objections, promoter_id, cohort, source, steward_clerk_user_id, shop_id, preview_id, ' +
          'stage, stage_entered_at, intake_complete, created_by, created_at, updated_at',
      )
      .maybeSingle()
    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'No se pudo guardar el registro.' }, { status: 500 })
    }

    await auditFieldChanges(body.relationshipId, auth.user.id, before, patch)

    return NextResponse.json({ ok: true, relationship: toRelationshipDTO(data as unknown as RelationshipRow) })
  }

  // ── CREATE arm ─────────────────────────────────────────────────────────
  if (!auth.actor.promoterId) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  const businessName = clean(body.businessName)
  if (!businessName) {
    return NextResponse.json({ ok: false, error: 'El nombre del negocio es obligatorio.' }, { status: 400 })
  }

  if (!body.confirmNew) {
    const candidates: DedupeCandidateRows = { byShopId: null, byPhone: null, byEmail: null }
    if (body.shopId) {
      const { data } = await db.from('merchant_relationships').select('id').eq('shop_id', body.shopId).maybeSingle()
      candidates.byShopId = data as { id: string } | null
    }
    if (phoneE164) {
      const { data } = await db.from('merchant_relationships').select('id').eq('phone_e164', phoneE164).limit(1).maybeSingle()
      candidates.byPhone = data as { id: string } | null
    }
    if (emailNormalized) {
      const { data } = await db
        .from('merchant_relationships')
        .select('id')
        .eq('email_normalized', emailNormalized)
        .limit(1)
        .maybeSingle()
      candidates.byEmail = data as { id: string } | null
    }
    const decision = decideDedupeMatch(candidates)
    if (decision.matched) {
      return NextResponse.json(
        { ok: false, error: 'Ya existe un registro con estos datos.', relationshipId: decision.relationshipId, matchReason: decision.matchReason },
        { status: 409 },
      )
    }
  }

  const { data: inserted, error: insertError } = await db
    .from('merchant_relationships')
    .insert({
      business_name: businessName,
      contact_name: clean(body.contactName),
      phone_e164: phoneE164 ?? null,
      email_normalized: emailNormalized ?? null,
      whatsapp_e164: whatsappE164 ?? null,
      instagram_handle: clean(body.instagramHandle),
      estado: clean(body.estado),
      municipio: clean(body.municipio),
      location_note: clean(body.locationNote),
      category: clean(body.category),
      current_channels: body.currentChannels ?? null,
      preferred_channel: body.preferredChannel || null,
      qualification: body.qualification || 'unknown',
      fit_note: clean(body.fitNote),
      objections: clean(body.objections),
      promoter_id: auth.actor.promoterId,
      cohort: clean(body.cohort),
      source: clean(body.source),
      shop_id: body.shopId || null,
      intake_complete: !!body.intakeComplete,
      created_by: auth.user.id,
    })
    .select(
      'id, business_name, contact_name, phone_e164, email_normalized, whatsapp_e164, instagram_handle, ' +
        'estado, municipio, location_note, category, current_channels, preferred_channel, qualification, ' +
        'fit_note, objections, promoter_id, cohort, source, steward_clerk_user_id, shop_id, preview_id, ' +
        'stage, stage_entered_at, intake_complete, created_by, created_at, updated_at',
    )
    .maybeSingle()

  if (insertError || !inserted) {
    // 23505 on the shop_id unique index = a concurrent create raced us — surface
    // as a dedupe conflict rather than a bare 500, since that's what it is.
    if (insertError?.code === '23505') {
      return NextResponse.json({ ok: false, error: 'Ya existe un registro para esta tienda.' }, { status: 409 })
    }
    return NextResponse.json({ ok: false, error: 'No se pudo crear el registro.' }, { status: 500 })
  }

  const row = inserted as unknown as RelationshipRow

  await auditFieldChanges(
    row.id,
    auth.user.id,
    {},
    { promoter_id: row.promoter_id, cohort: row.cohort, source: row.source, preferred_channel: row.preferred_channel },
  )

  const suggestions = await fuzzySuggestions(businessName, row.id)

  return NextResponse.json({ ok: true, relationship: toRelationshipDTO(row), suggestions })
}

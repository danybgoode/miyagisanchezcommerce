/**
 * POST /api/promoter/relationship/[id]/consent — attach consent evidence to a
 * merchant relationship (founding-merchant-activation-ops S1.3).
 *
 * Evidence is decided from `readApprovalState` (`lib/preview-consent.ts`) —
 * the SAME read every other consent surface uses — via the pure
 * `consentSatisfiesEvidence` (`lib/relationship-consent.ts`): a CURRENT
 * approval (`status==='approved'` and NOT `stale`), plus merchant-verified
 * provenance when `promoter.preview_verified_approval_enabled` is on. Anything
 * short of that (no decision, `changes_requested`, a stale/invalidated
 * approval, an unverified approval while verification is enforced) is
 * refused with 422 and the relationship record is left exactly as it was. A
 * note is never evidence — there is no code path here that reads
 * `fit_note`/`objections`/any free-text field to decide consent. (S1
 * cross-review A1 — corrects the original build contract's own defect: see
 * `lib/relationship-consent.ts` header for the two holes this closes.)
 *
 * The preview MUST belong to THIS relationship's shop (S1 cross-review A2):
 * a caller-supplied `previewId` is treated as an ASSERTION to verify against
 * `relationship.shop_id`, never a bare lookup key to trust — otherwise a
 * promoter holding two relationships could attach one merchant's real
 * approval to a DIFFERENT merchant's record. When no `previewId` is given,
 * the preview is resolved FROM the relationship's own linked shop
 * (`getPreviewByShop`), so the client never needs to know a raw preview id at
 * all (closes S1 review A7 — the UI has no reliable way to learn one).
 *
 * Write-scope checked: `resolveRelationshipAccess` grants READ to a
 * `partner_grants` `viewer`, but recording consent is a WRITE — a viewer is
 * refused (S1 cross-review A5, mirrors `lib/partner-auth.ts`'s viewer-write
 * denial). Gated by `promoter.activation_crm_enabled` FIRST.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getPreviewByShop, type MerchantPreview } from '@/lib/preview-access'
import { readApprovalState } from '@/lib/preview-consent'
import { consentSatisfiesEvidence, previewBelongsToRelationship } from '@/lib/relationship-consent'
import {
  authorizeRelationshipRequest,
  resolveRelationshipAccess,
  canWriteRelationship,
  auditFieldChanges,
  auditEvent,
} from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

interface ConsentBody {
  previewId?: string
}

interface PreviewRow {
  id: string
  shop_id: string
  status: string
  current_version: number
  created_by: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json(
      { ok: false, error: 'Tu acceso a este registro es de solo lectura (viewer) — registrar el permiso requiere el rol manager.' },
      { status: 403 },
    )
  }

  let body: ConsentBody = {}
  try {
    body = await req.json()
  } catch {
    /* an empty body is fine — the preview resolves from the relationship's own shop */
  }
  // B8: JSON.parse hands back `any` — a non-string previewId (e.g. a number)
  // would otherwise reach `.trim()` below and throw a 500 instead of a clean 400.
  if (body.previewId !== undefined && typeof body.previewId !== 'string') {
    return NextResponse.json({ ok: false, error: 'Campo inválido: previewId.' }, { status: 400 })
  }

  const relationship = access.relationship
  const assertedPreviewId = (body.previewId ?? '').trim() || null

  // Resolve the preview row. A caller-supplied id is VERIFIED against this
  // relationship's shop below, never trusted as a bare lookup (A2); omitting
  // it falls back to the relationship's already-linked preview_id, and
  // failing that, to whatever preview is anchored on the relationship's own
  // linked shop (A7 — so the UI never needs to know a raw preview id).
  let previewRow: PreviewRow | null = null
  if (assertedPreviewId) {
    const { data } = await db
      .from('merchant_previews')
      .select('id, shop_id, status, current_version, created_by')
      .eq('id', assertedPreviewId)
      .maybeSingle()
    previewRow = (data as PreviewRow | null) ?? null
  } else if (relationship.preview_id) {
    const { data } = await db
      .from('merchant_previews')
      .select('id, shop_id, status, current_version, created_by')
      .eq('id', relationship.preview_id)
      .maybeSingle()
    previewRow = (data as PreviewRow | null) ?? null
  } else if (relationship.shop_id) {
    const preview = await getPreviewByShop(relationship.shop_id)
    if (preview) {
      previewRow = {
        id: preview.id,
        shop_id: preview.shopId,
        status: preview.status,
        current_version: preview.currentVersion,
        created_by: preview.createdBy,
      }
    }
  }

  if (!previewRow) {
    return NextResponse.json(
      { ok: false, error: 'No hay una vista previa vinculada a este registro.' },
      { status: 422 },
    )
  }

  // A2: the preview must belong to THIS relationship's shop — the pure
  // `previewBelongsToRelationship` refuses whenever the relationship has no
  // shop yet OR the shop ids don't match, never trusting the supplied id.
  if (!previewBelongsToRelationship(previewRow.shop_id, relationship.shop_id)) {
    return NextResponse.json(
      { ok: false, error: 'La vista previa indicada no corresponde a la tienda de este registro.' },
      { status: 403 },
    )
  }

  const preview: MerchantPreview = {
    id: previewRow.id,
    shopId: previewRow.shop_id,
    status: previewRow.status as MerchantPreview['status'],
    currentVersion: previewRow.current_version,
    createdBy: previewRow.created_by,
  }

  const state = await readApprovalState(preview)
  const verifiedApprovalRequired = await isEnabled('promoter.preview_verified_approval_enabled')
  const facts = state
    ? { status: preview.status, stale: state.stale, approvedVerifiedVia: state.approvedVerifiedVia }
    : null

  if (!consentSatisfiesEvidence(facts, { verifiedApprovalRequired })) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No hay evidencia de consentimiento vigente (aprobación del comerciante) para esta vista previa.',
      },
      { status: 422 },
    )
  }

  // Evidence is valid — persist the reference (idempotent: a no-op when it was
  // already this previewId) and leave a permanent audit trail either way.
  let auditRecorded = true
  if (relationship.preview_id !== preview.id) {
    const { error: updateError } = await db
      .from('merchant_relationships')
      .update({ preview_id: preview.id, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo guardar la evidencia de consentimiento.' },
        { status: 500 },
      )
    }
    auditRecorded = await auditFieldChanges(id, auth.user.id, { preview_id: relationship.preview_id }, { preview_id: preview.id })
  }
  const eventRecorded = await auditEvent(
    id,
    auth.user.id,
    'consent_verified',
    JSON.stringify({ previewId: preview.id, verifiedVia: facts?.approvedVerifiedVia ?? null }),
  )

  return NextResponse.json({
    ok: true,
    previewId: preview.id,
    auditRecorded: auditRecorded && eventRecorded,
  })
}

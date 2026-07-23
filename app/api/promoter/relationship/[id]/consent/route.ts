/**
 * POST /api/promoter/relationship/[id]/consent — attach consent evidence to a
 * merchant relationship (founding-merchant-activation-ops S1.3).
 *
 * Reads `merchant_preview_decisions` for the linked preview and requires
 * `decision='approved'` AT THE PREVIEW'S `current_version`
 * (`lib/relationship-consent.ts#consentSatisfiesEvidence` — the pure rule);
 * anything else (no decision at all, `changes_requested`, an approval that has
 * since gone stale because the version moved on) is refused with 422 and the
 * relationship record is left exactly as it was. A note is never evidence —
 * there is no code path here that reads `fit_note`/`objections`/any free-text
 * field to decide consent.
 *
 * On success, persists the `preview_id` reference (if not already set) and
 * writes an immutable field-audit trail entry either way — "attribution and
 * consent fields are audited on every edit" (Story 1.3), including a
 * re-confirmation that changes nothing.
 *
 * Scope-checked through the same shared `resolveRelationshipAccess` every
 * relationship route calls. Gated by `promoter.activation_crm_enabled` FIRST.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { consentSatisfiesEvidence } from '@/lib/relationship-consent'
import {
  authorizeRelationshipRequest,
  resolveRelationshipAccess,
  auditFieldChanges,
  auditEvent,
} from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

interface ConsentBody {
  previewId?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })

  let body: ConsentBody = {}
  try {
    body = await req.json()
  } catch {
    /* an empty body is fine — fall back to the relationship's own preview_id */
  }

  const previewId = (body.previewId ?? access.relationship.preview_id ?? '').trim()
  if (!previewId) {
    return NextResponse.json(
      { ok: false, error: 'No hay una vista previa vinculada a este registro.' },
      { status: 422 },
    )
  }

  const { data: preview, error: previewError } = await db
    .from('merchant_previews')
    .select('id, current_version')
    .eq('id', previewId)
    .maybeSingle()
  if (previewError || !preview) {
    return NextResponse.json({ ok: false, error: 'No se encontró la vista previa indicada.' }, { status: 422 })
  }

  const currentVersion = preview.current_version as number

  // The decision (if any) recorded AT the preview's current version — could be
  // an approval, a changes_requested, or absent entirely. `consentSatisfiesEvidence`
  // is the ONE place that decides whether that counts as evidence.
  const { data: decisionRow } = await db
    .from('merchant_preview_decisions')
    .select('decision, version')
    .eq('preview_id', previewId)
    .eq('version', currentVersion)
    .limit(1)
    .maybeSingle()

  const decision = decisionRow
    ? { decision: decisionRow.decision as string, version: decisionRow.version as number }
    : null

  if (!consentSatisfiesEvidence(decision, currentVersion)) {
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
  if (access.relationship.preview_id !== previewId) {
    const { error: updateError } = await db
      .from('merchant_relationships')
      .update({ preview_id: previewId, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo guardar la evidencia de consentimiento.' },
        { status: 500 },
      )
    }
    await auditFieldChanges(id, auth.user.id, { preview_id: access.relationship.preview_id }, { preview_id: previewId })
  }
  await auditEvent(id, auth.user.id, 'consent_verified', JSON.stringify({ previewId, version: currentVersion }))

  return NextResponse.json({ ok: true, previewId, version: currentVersion })
}

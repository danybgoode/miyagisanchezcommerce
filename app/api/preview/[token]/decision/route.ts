/**
 * POST /api/preview/[token]/decision — the MERCHANT approves or requests changes on
 * the private preview they are looking at (founding-merchant-consent-previews S2.1/
 * S2.2). This is the one place explicit consent is recorded.
 *
 * Authed by the OPAQUE PREVIEW TOKEN, not Clerk — the merchant has no account yet
 * (the shop is still unclaimed). Possession of the un-revoked, un-expired link is
 * the authorization, exactly as it is for rendering the preview. `expectedHash` is
 * the snapshot hash the merchant's page was rendered from: if the proposal changed
 * between render and click the decision is refused server-side, so a decision can
 * never silently apply to a different proposal than the one reviewed (versioned
 * consent, epic decision #2).
 *
 * Gated by `promoter.private_preview_enabled` (404 when OFF — dark for rollback).
 * Nothing here publishes anything: approval only records consent; activation is a
 * separate, deliberate promoter action (S2.3).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { resolvePreviewWithGrantByToken } from '@/lib/preview-access'
import { recordDecision } from '@/lib/preview-consent'
import { emitPreviewEvent } from '@/lib/preview-lifecycle'
import { emitMerchantLifecycle } from '@/lib/merchant-lifecycle-server'
import { consumeApprovalCode } from '@/lib/preview-verification-server'

export const dynamic = 'force-dynamic'

const HEX64 = /^[0-9a-f]{64}$/

function hashIp(ip: string | null): string | null {
  const clean = (ip ?? '').trim()
  if (!clean) return null
  return createHash('sha256').update(clean).digest('hex')
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  // Dark while OFF — the whole surface 404s, same as the render page.
  if (!(await isEnabled('promoter.private_preview_enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const { token } = await ctx.params

  // Defense-in-depth brute-force guard (the token is already 256-bit opaque).
  const ip = getClientIp(req)
  const rl = await checkRateLimit('embed', ip)
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  // Unknown / revoked / expired / already-activated token → the ordinary 404,
  // never revealing which. Possession of a valid link IS the authorization.
  const resolved = await resolvePreviewWithGrantByToken(token)
  if (!resolved) return NextResponse.json({ ok: false }, { status: 404 })

  let body: { decision?: string; expectedHash?: string; note?: string; code?: string } = {}
  try { body = await req.json() } catch { /* validated below */ }

  const decision = body.decision
  if (decision !== 'approved' && decision !== 'changes_requested') {
    return NextResponse.json({ ok: false, error: 'Decisión inválida.' }, { status: 400 })
  }
  const expectedHash = (body.expectedHash ?? '').trim().toLowerCase()
  if (!HEX64.test(expectedHash)) {
    return NextResponse.json(
      { ok: false, error: 'Vuelve a cargar la página para ver la versión actual.' },
      { status: 400 },
    )
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null

  // S4 — merchant-verified approval. When enforced, an APPROVAL must present a
  // one-time code delivered to the merchant's own contact (a changes-requested
  // needs none). This is what makes a promoter self-approving distinguishable in
  // the record from real merchant consent. The code is bound to the current
  // snapshot, so it also can't approve a proposal that changed after the code was
  // sent. Consumed on success; the provenance is stamped on the decision below.
  let verifiedVia: 'email' | 'whatsapp' | null = null
  let verifiedContactHash: string | null = null
  if (decision === 'approved' && (await isEnabled('promoter.preview_verified_approval_enabled'))) {
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code) {
      return NextResponse.json(
        { ok: false, error: 'Ingresa el código que enviamos a tu contacto para aprobar.', needsCode: true },
        { status: 401 },
      )
    }
    const consumed = await consumeApprovalCode({
      preview: resolved.preview,
      currentSnapshotHash: expectedHash,
      presentedCode: code,
    })
    if (!consumed.ok) {
      const message =
        consumed.reason === 'stale_snapshot'
          ? 'La propuesta cambió. Vuelve a cargarla y pide un código nuevo.'
          : consumed.reason === 'expired' || consumed.reason === 'no_code'
            ? 'El código venció o no existe. Pide uno nuevo.'
            : consumed.reason === 'too_many_attempts'
              ? 'Demasiados intentos con ese código. Pide uno nuevo.'
              : 'El código no es correcto. Revísalo e inténtalo de nuevo.'
      return NextResponse.json({ ok: false, error: message, needsCode: true }, { status: 401 })
    }
    verifiedVia = consumed.channel
    verifiedContactHash = consumed.contactHash
  }

  const result = await recordDecision({
    preview: resolved.preview,
    decision,
    expectedHash,
    grantId: resolved.grantId,
    note,
    ipHash: hashIp(ip),
    verifiedVia,
    verifiedContactHash,
  })
  if (!result.ok) {
    // A hash mismatch (proposal changed under the merchant) is the expected
    // conflict — surface it as 409 so the client can prompt a reload.
    return NextResponse.json({ ok: false, error: result.reason }, { status: 409 })
  }

  // Lifecycle telemetry (S3.1) — AFTER the consent record is durably written.
  // Only approval is a canonical lifecycle transition; a changes-requested keeps
  // the preview private and is covered by the promoter workspace, not the funnel.
  if (decision === 'approved') {
    await emitPreviewEvent('preview_approved', {
      shopId: resolved.preview.shopId,
      previewId: resolved.preview.id,
      version: resolved.preview.currentVersion + 1,
    })
    // …and the same moment as a MERCHANT LIFECYCLE fact (event-destination-router
    // S3.1). Distinct from the line above on purpose: `preview_approved` is this
    // epic's own funnel telemetry, while `merchant.preview_approved` carries
    // `subject: {type:'merchant'}` and is what Golden Beans delivers back into the
    // Miyagi projection. Emitted once per merchant, guarded by a unique constraint.
    await emitMerchantLifecycle('merchant.preview_approved', {
      merchantId: resolved.preview.shopId,
      correlationId: resolved.preview.id,
    })
  }

  return NextResponse.json({ ok: true, decision })
}

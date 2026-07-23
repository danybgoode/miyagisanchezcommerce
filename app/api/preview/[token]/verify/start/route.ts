/**
 * POST /api/preview/[token]/verify/start — issue a one-time approval code to the
 * MERCHANT's own contact (founding-merchant-consent-previews S4.1).
 *
 * Authed by the opaque preview token, exactly like the decision route — the merchant
 * has no account. The code is bound to the CURRENT proposal snapshot and delivered
 * to the merchant's email (WhatsApp deferred — see lib/preview-verification-server).
 * The code is NEVER returned in the response or logged; the merchant reads it from
 * their own inbox and enters it to approve.
 *
 * Gated by BOTH `promoter.private_preview_enabled` (the surface must be live) AND
 * `promoter.preview_verified_approval_enabled` (verified approval must be enforced).
 * 404 when either is OFF, so the endpoint is dark until verified approval turns on.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { resolvePreviewByToken } from '@/lib/preview-access'
import { startApprovalVerification } from '@/lib/preview-verification-server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  // Dark unless the preview surface is live AND verified approval is enforced.
  if (!(await isEnabled('promoter.private_preview_enabled')) ||
      !(await isEnabled('promoter.preview_verified_approval_enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const { token } = await ctx.params

  const ip = getClientIp(req)
  const rl = await checkRateLimit('embed', ip)
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  // Unknown / revoked / expired / already-activated → the ordinary 404.
  const preview = await resolvePreviewByToken(token)
  if (!preview) return NextResponse.json({ ok: false }, { status: 404 })

  const result = await startApprovalVerification(preview)
  if (!result.ok) {
    // A missing merchant contact is a real, actionable state for the promoter to
    // fix (capture the merchant's email); the rest are transient. Never leak the
    // code or the contact.
    const status = result.reason === 'no_contact' ? 409 : 500
    const message =
      result.reason === 'no_contact'
        ? 'No hay un contacto del comerciante para enviar el código. Captura su correo antes de aprobar.'
        : result.reason === 'unsupported_channel'
          ? 'Por ahora el código solo puede enviarse por correo. Captura el correo del comerciante.'
          : 'No se pudo enviar el código. Inténtalo de nuevo.'
    return NextResponse.json({ ok: false, error: message }, { status })
  }

  // Report only the channel (email/whatsapp) so the UI can say where to look —
  // never the address itself.
  return NextResponse.json({ ok: true, channel: result.channel })
}

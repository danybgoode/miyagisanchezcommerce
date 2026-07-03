/**
 * POST /api/promoter/apply — public, unauthenticated self-serve promoter application.
 *
 * Rate-limited by IP → validated (incl. honeypot) → stored `pending` → fire-and-forget
 * admin notification (Telegram + email). Epic 08 · promoter-funnel-v2 · Sprint 2 · US-2.1.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { validateApplicationInput, createPromoterApplication, applicationRefusalMessage, type ApplicationInput } from '@/lib/promoter-applications'
import { tg } from '@/lib/telegram'
import { sendPromoterApplicationReceivedToAdmin } from '@/lib/email'

export const dynamic = 'force-dynamic'

const SITE = 'https://miyagisanchez.com'

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit('promoter_apply', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  let body: ApplicationInput
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const result = validateApplicationInput(body)
  if (!result.ok) {
    // Honeypot tripped: pretend success so a bot never learns the trap exists.
    if (result.reason === 'honeypot') return NextResponse.json({ ok: true })
    return NextResponse.json({ error: applicationRefusalMessage(result.reason) }, { status: 400 })
  }

  const application = await createPromoterApplication(result.clean)
  if (!application) return NextResponse.json({ error: 'No se pudo enviar la solicitud. Intenta de nuevo.' }, { status: 502 })

  const adminUrl = `${SITE}/admin/promoter`
  tg.promoterApplicationSubmitted(application.name, application.city, adminUrl).catch((e) => console.error('[promoter-apply] tg notify failed:', e))
  const adminEmail = process.env.MIYAGI_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? null
  if (adminEmail) {
    sendPromoterApplicationReceivedToAdmin({
      adminEmail,
      name: application.name,
      email: application.email,
      whatsapp: application.whatsapp,
      city: application.city,
      motivation: application.motivation,
      adminUrl,
    }).catch((e) => console.error('[promoter-apply] admin email failed:', e))
  }

  return NextResponse.json({ ok: true })
}

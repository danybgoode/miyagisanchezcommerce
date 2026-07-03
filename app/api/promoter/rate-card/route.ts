/**
 * GET /api/promoter/rate-card — a bound promoter downloads the printed-ad
 * rate-card PDF from their own handbook (epic 08 · promoter-funnel-v2 S5 ·
 * US-5.6), with no admin session. The render itself is admin-secret-gated
 * (`/admin/print/rate-card/print`), so this route calls the SAME shared PDF
 * renderer (lib/print-pdf-client.ts) directly, server-to-server, using the
 * server-held `ADMIN_SECRET` — never exposed to the browser. Clerk- +
 * `promoter.enabled`-gated, mirrors every other promoter route's auth order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId } from '@/lib/promoter'
import { renderPrintPdf } from '@/lib/print-pdf-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export async function GET(_req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ ok: false, error: 'Servicio PDF no configurado.' }, { status: 503 })
  }

  const printUrl = `${SITE_URL}/admin/print/rate-card/print?secret=${encodeURIComponent(adminSecret)}`
  const result = await renderPrintPdf(printUrl)
  if (!result.ok || !result.buffer) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 502 })
  }

  return new NextResponse(result.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="tarifario-miyagi-prints.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}

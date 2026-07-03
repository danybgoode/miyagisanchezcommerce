/**
 * GET /api/admin/print/rate-card/pdf (Clerk admin-gated via withAdmin)
 *
 * Promoter Funnel v2 · Sprint 5 (US-5.6) — near-duplicate of
 * /api/admin/print/editions/[id]/pdf, pointed at the synthetic rate-card
 * print-view instead of a saved edition layout. Same machine-secret proxy
 * shape (lib/print-pdf-client.ts) — generated fresh on every request, so a
 * tier price change is live on the next download with no cache to invalidate.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { renderPrintPdf } from '@/lib/print-pdf-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export const GET = withAdmin(async (_req: NextRequest) => {
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: 'Servicio PDF no configurado (ADMIN_SECRET).' }, { status: 503 })
  }

  const printUrl = `${SITE_URL}/admin/print/rate-card/print?secret=${encodeURIComponent(adminSecret)}`
  const result = await renderPrintPdf(printUrl)
  if (!result.ok || !result.buffer) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 502 })
  }

  return new NextResponse(result.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="tarifario-miyagi-prints.pdf"',
      'Cache-Control': 'no-store',
    },
  })
})

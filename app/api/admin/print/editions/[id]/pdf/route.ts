/**
 * GET /api/admin/print/editions/[id]/pdf  (Clerk admin-gated via withAdmin)
 * Thin proxy to the standalone Cloud Run PDF renderer (US-5b): it loads our
 * /print render page in headless Chromium and streams back a print-ready PDF.
 * Inert until PRINT_PDF_URL + PRINT_PDF_SECRET are configured.
 *
 * The human caller is Clerk-gated by `withAdmin`. The downstream `?secret=` on
 * the render URL is a MACHINE credential: headless Chromium has no Clerk session,
 * so the `/admin/print/[id]/print` render page stays secret-accepting. This is a
 * documented `ADMIN_SECRET` machine exception (like `/api/admin/import`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { renderPrintPdf } from '@/lib/print-pdf-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export const GET = withAdmin(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: 'Servicio PDF no configurado (ADMIN_SECRET).' }, { status: 503 })
  }

  const printUrl = `${SITE_URL}/admin/print/${id}/print?secret=${encodeURIComponent(adminSecret)}`
  const result = await renderPrintPdf(printUrl)
  if (!result.ok || !result.buffer) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 502 })
  }

  return new NextResponse(result.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="edicion-${id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
})

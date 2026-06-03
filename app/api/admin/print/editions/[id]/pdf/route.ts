/**
 * GET /api/admin/print/editions/[id]/pdf  (secret-gated)
 * Thin proxy to the standalone Cloud Run PDF renderer (US-5b): it loads our
 * secret-gated /print route in headless Chromium and streams back a print-ready
 * PDF. Inert until PRINT_PDF_URL + PRINT_PDF_SECRET are configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminSecret } from '@/lib/print-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const service = process.env.PRINT_PDF_URL
  const secret = process.env.PRINT_PDF_SECRET
  const adminSecret = process.env.ADMIN_SECRET
  if (!service || !secret || !adminSecret) {
    return NextResponse.json({ error: 'Servicio PDF no configurado (PRINT_PDF_URL / PRINT_PDF_SECRET).' }, { status: 503 })
  }

  const printUrl = `${SITE_URL}/admin/print/${id}/print?secret=${encodeURIComponent(adminSecret)}`
  let r: Response
  try {
    r = await fetch(`${service.replace(/\/$/, '')}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ url: printUrl }),
    })
  } catch (e) {
    return NextResponse.json({ error: `No se pudo contactar el servicio PDF: ${(e as Error).message}` }, { status: 502 })
  }
  if (!r.ok) {
    const msg = await r.text().catch(() => '')
    return NextResponse.json({ error: `Render falló (${r.status}): ${msg.slice(0, 300)}` }, { status: 502 })
  }

  const buf = await r.arrayBuffer()
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="edicion-${id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}

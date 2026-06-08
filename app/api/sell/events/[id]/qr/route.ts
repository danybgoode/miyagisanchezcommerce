import { NextRequest, NextResponse } from 'next/server'
import { publicEventUrl } from '@/lib/events'
import { getSellerEvent } from '@/lib/events-seller'
import { generateQrPng } from '@/lib/print-qr'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const found = await getSellerEvent(id)
  if (!found) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })

  const png = await generateQrPng(publicEventUrl(found.event.slug))
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${found.event.slug}-qr.png"`,
      'Cache-Control': 'no-store',
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { isTicketToken } from '@/lib/event-ticket-state'
import { generateQrPng } from '@/lib/print-qr'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!isTicketToken(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const png = await generateQrPng(token)
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="boleto-qr.png"',
      'Cache-Control': 'no-store',
    },
  })
}

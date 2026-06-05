import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { publicSweepstakesUrl } from '@/lib/sweepstakes'
import { getSellerSweepstakesCampaign } from '@/lib/sweepstakes-seller'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const found = await getSellerSweepstakesCampaign(id)
  if (!found) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })

  const png = await QRCode.toBuffer(publicSweepstakesUrl(found.campaign.slug), {
    errorCorrectionLevel: 'H',
    type: 'png',
    margin: 2,
    scale: 10,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })

  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${found.campaign.slug}-qr.png"`,
      'Cache-Control': 'no-store',
    },
  })
}

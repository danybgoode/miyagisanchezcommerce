/**
 * GET /api/sell/launchpad/campaigns/[id]/qr — a PNG QR pointing at the public
 * /v/[slug] campaign page, for print/in-store rallying (bookshop-launchpad S3.2).
 * Clerk + shop-scoped; behind launchpad.enabled.
 */
import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { isEnabled } from '@/lib/flags'
import { resolveCampaignSeller, getCampaignForShop } from '@/lib/launchpad-campaigns'

export const dynamic = 'force-dynamic'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com').replace(/\/+$/, '')

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const context = await resolveCampaignSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  const campaign = await getCampaignForShop(context.shop.id, id)
  if (!campaign) return NextResponse.json({ error: 'No encontrada.' }, { status: 404 })

  const png = await QRCode.toBuffer(`${SITE_URL}/v/${campaign.slug}`, {
    errorCorrectionLevel: 'H', type: 'png', margin: 2, scale: 10,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })

  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${campaign.slug}-qr.png"`,
      'Cache-Control': 'no-store',
    },
  })
}

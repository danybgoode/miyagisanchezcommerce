/**
 * POST /api/sell/launchpad/submissions/[id]/publish — mint an approved
 * submission as a DRAFT digital product under the shop (bookshop-launchpad
 * S1.3). Ownership + status are enforced in `publishSubmission` (scoped to the
 * caller's shop; must be 'approved'). Behind `launchpad.enabled`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getLaunchpadShopForClerk, publishSubmission } from '@/lib/launchpad'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  if (!(await isEnabled('launchpad.enabled'))) return NextResponse.json({ error: 'No disponible.' }, { status: 423 })

  const shop = await getLaunchpadShopForClerk(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { id } = await params
  const result = await publishSubmission({ shop, id })
  if (!result.ok) {
    const msg = result.error === 'not_approved'
      ? 'Solo puedes publicar un manuscrito aprobado.'
      : result.error === 'not_found'
      ? 'Manuscrito no encontrado.'
      : result.error === 'shop_slug_missing'
      ? 'Tu tienda no tiene un identificador (slug) configurado.'
      : 'No se pudo publicar el manuscrito. Inténtalo de nuevo.'
    return NextResponse.json({ error: msg }, { status: result.status })
  }

  return NextResponse.json({ ok: true, product_id: result.productId, manage_url: result.manageUrl })
}

/**
 * GET /api/sell/launchpad/submissions/[id]/download — redirect the shop owner to
 * a short-lived (5 min) presigned URL for the manuscript file (bookshop-launchpad
 * S1.2). Shop-only: the submission is resolved scoped to the caller's shop_id, so
 * one shop can never fetch another shop's manuscript. The manuscript lives in the
 * PRIVATE bucket — a public URL is never persisted or returned. Behind the flag.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getLaunchpadShopForClerk, getSubmissionForShop, getManuscriptSignedUrl } from '@/lib/launchpad'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  if (!(await isEnabled('launchpad.enabled'))) return NextResponse.json({ error: 'No disponible.' }, { status: 423 })

  const shop = await getLaunchpadShopForClerk(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { id } = await params
  const submission = await getSubmissionForShop(shop.id, id)
  if (!submission) return NextResponse.json({ error: 'Manuscrito no encontrado.' }, { status: 404 })

  const url = await getManuscriptSignedUrl(submission)
  if (!url) return NextResponse.json({ error: 'No se pudo generar el enlace de descarga.' }, { status: 500 })

  return NextResponse.redirect(url)
}

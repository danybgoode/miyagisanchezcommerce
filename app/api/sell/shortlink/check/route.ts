/**
 * GET /api/sell/shortlink/check?slug=mi-producto&excludeListing=<medusa_product_id>
 *
 * Availability for a seller-chosen product short slug in the flat mschz.org/[x]
 * namespace. Available when it passes the slug format/reserved rules AND isn't
 * already a shop slug / shop alias / another listing's slug-or-code. The listing's
 * own current slug is excluded via `excludeListing`. Auth-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { validateSlug } from '@/lib/slug'
import { isShortlinkSegmentTaken } from '@/lib/shortlink-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const slug = req.nextUrl.searchParams.get('slug')?.trim().toLowerCase() ?? ''
  const exclude = req.nextUrl.searchParams.get('excludeListing') ?? undefined
  if (!slug) return NextResponse.json({ available: false, reason: 'Escribe un enlace.' })

  const check = validateSlug(slug)
  if (!check.valid) return NextResponse.json({ available: false, reason: check.reason })

  try {
    const taken = await isShortlinkSegmentTaken(slug, exclude)
    return taken
      ? NextResponse.json({ available: false, reason: 'Ese enlace ya está en uso.' })
      : NextResponse.json({ available: true })
  } catch {
    return NextResponse.json({ available: false, reason: 'No pudimos verificar. Intenta de nuevo.' })
  }
}

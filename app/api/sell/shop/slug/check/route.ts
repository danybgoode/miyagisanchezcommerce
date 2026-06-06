/**
 * GET /api/sell/shop/slug/check?slug=mi-tienda
 *
 * Real-time slug availability for the seller's shop URL (/s/[slug]). Returns
 * `{ available, reason? }`. A slug is available when it passes the shared format/
 * reserved rules AND no other seller already owns it. The seller's *own* current
 * slug is always reported available (so re-saving it isn't a false conflict).
 *
 * Auth-gated (signed-in sellers only) to avoid anonymous enumeration/abuse.
 */

import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { validateSlug } from '@/lib/slug'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const slug = req.nextUrl.searchParams.get('slug')?.trim().toLowerCase() ?? ''
  if (!slug) return NextResponse.json({ available: false, reason: 'Escribe un slug.' })

  // Format + reserved rules (shared with creation, settings, and the backend).
  const check = validateSlug(slug)
  if (!check.valid) return NextResponse.json({ available: false, reason: check.reason })

  // The seller's own current slug is always "available" to them.
  try {
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('slug')
      .eq('clerk_user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (shop?.slug && shop.slug === slug) {
      return NextResponse.json({ available: true })
    }
  } catch {
    // Non-fatal — fall through to the Medusa uniqueness check.
  }

  // Uniqueness: a seller exists at this slug ⇒ taken. 404 ⇒ free.
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/sellers/${encodeURIComponent(slug)}`, {
      headers: { 'x-publishable-api-key': PUB_KEY },
      cache: 'no-store',
    })
    if (res.ok) return NextResponse.json({ available: false, reason: 'Ese slug ya está en uso.' })
    if (res.status === 404) return NextResponse.json({ available: true })
    return NextResponse.json({ available: false, reason: 'No pudimos verificar la disponibilidad. Intenta de nuevo.' })
  } catch {
    return NextResponse.json({ available: false, reason: 'Sin conexión. Intenta de nuevo.' })
  }
}

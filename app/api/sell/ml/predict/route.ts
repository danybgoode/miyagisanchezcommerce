import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { predictMlCategory } from '@/lib/ml-publish-bridge'

/**
 * GET /api/sell/ml/predict?q=<title> — predict valid Mercado Libre categories for
 * the publish override UI (epic 03 · mercadolibre-sync S3 · US-9). Clerk-authed
 * (auth first ⇒ anonymous is always 401), gated on `ml.publish_enabled`, scoped to
 * the caller's own shop (uses the seller's ML token, backend-side). Returns the
 * ranked candidates; the FE applies the low-confidence/override decision.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('ml.publish_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ error: 'q es requerido.' }, { status: 422 })

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const candidates = await predictMlCategory(shop.slug, q)
  return NextResponse.json({ candidates })
}

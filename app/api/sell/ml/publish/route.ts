import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { publishMlProduct } from '@/lib/ml-publish-bridge'

/**
 * POST /api/sell/ml/publish — publish / sync the caller's product to Mercado
 * Libre (epic 03 · mercadolibre-sync S3 · US-7/US-8). Clerk-authed (auth before
 * anything, so anonymous is always 401), gated on `ml.publish_enabled`, scoped to
 * the caller's own shop + product. Drives the backend reconcile seam
 * (create/update/close/relist); persists the linkage. No money mutation.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('ml.publish_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as { productId?: string; categoryId?: string | null } | null
  if (!body?.productId) return NextResponse.json({ error: 'productId es requerido.' }, { status: 422 })

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  // Ownership: the product must belong to THIS shop (mirror check, defense in depth;
  // the backend re-verifies by seller slug too).
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, listing_type')
    .eq('shop_id', shop.id)
    .eq('medusa_product_id', body.productId)
    .neq('status', 'deleted')
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })

  const result = await publishMlProduct(shop.slug, body.productId, { categoryId: body.categoryId ?? null })

  if (!result.ok) {
    if (result.reason === 'not_connected') {
      return NextResponse.json({ error: 'Conecta tu cuenta de Mercado Libre primero.' }, { status: 409 })
    }
    if (result.reason === 'no_category') {
      return NextResponse.json({ error: 'Elige una categoría de Mercado Libre para publicar.', code: 'ML_NO_CATEGORY' }, { status: 422 })
    }
    return NextResponse.json({ error: 'No pudimos publicar en Mercado Libre. Intenta de nuevo.' }, { status: 502 })
  }

  revalidateTag('listings', 'default')
  return NextResponse.json({
    ok: true,
    action: result.action,
    created: result.created,
    ml_item_id: result.ml_item_id,
    permalink: result.permalink,
    status: result.status,
  })
}

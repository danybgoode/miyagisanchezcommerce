import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getShopifyBatchParity } from '@/lib/shopify-import-bridge'

/**
 * GET /api/sell/shopify/import/parity?batchId=… — the honest "what maps,
 * what doesn't" report for a staged Shopify batch, BEFORE any import is
 * confirmed (epic 03 · platform-migrations S1 · US-1.2). Clerk-authed,
 * gated on `migrations.connector_enabled`, scoped to the caller's own batch.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('migrations.connector_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const batchId = req.nextUrl.searchParams.get('batchId')
  if (!batchId) return NextResponse.json({ error: 'batchId es requerido.' }, { status: 422 })

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const result = await getShopifyBatchParity({ slug: shop.slug }, batchId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json(result.report)
}

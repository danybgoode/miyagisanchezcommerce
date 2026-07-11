import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { classifyMigrationPricing } from '@/lib/migration-estimate-store'

/**
 * POST /api/sell/shopify/import/parity/estimate — generate (or return the
 * existing) quoted-estimate for a staged Shopify batch above the `migration`
 * SKU's flat 150-listing cap (epic 03 · platform-migrations S2 · US-2.2).
 * Clerk-authed, gated on `migrations.connector_enabled`, scoped to the
 * caller's own batch — same shape as the sibling parity GET route.
 *
 * Response shapes by tier:
 *   flat        → { tier: 'flat' } (the admin-set SKU price applies as-is, no quote needed)
 *   estimate    → { tier: 'estimate', estimate: {...} } (the persisted quote row)
 *   very_custom → { tier: 'very_custom' } (no price — Daniel was notified, US-2.3)
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('migrations.connector_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  let body: { batchId?: string } = {}
  try { body = await req.json() } catch { /* validated below */ }
  if (!body.batchId) return NextResponse.json({ error: 'batchId es requerido.' }, { status: 422 })

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const result = await classifyMigrationPricing({ slug: shop.slug }, body.batchId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  if (result.tier === 'estimate') return NextResponse.json({ tier: result.tier, estimate: result.estimate })
  return NextResponse.json({ tier: result.tier })
}

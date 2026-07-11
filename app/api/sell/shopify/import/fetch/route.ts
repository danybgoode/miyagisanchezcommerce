import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { stageShopifyBatch } from '@/lib/shopify-import-bridge'
import { isPublicDomainShape } from '@/lib/ssrf-guard'

/**
 * POST /api/sell/shopify/import/fetch — pull a Shopify shop domain's catalog +
 * policies text and stage them as a supply batch for review (epic 03 ·
 * platform-migrations S1 · US-1.1). Clerk-authed, gated on
 * `migrations.connector_enabled`, scoped to the caller's own shop.
 *
 * Unlike ML's connected-seller import, there's no OAuth/token relationship —
 * any public Shopify shop domain can be entered (the merchant migrating, or a
 * consultant on their behalf), so `shop_domain` is untrusted input our server
 * fetches. `isPublicDomainShape` here is just a friendly early-reject (bad
 * shape, bare IP, localhost) for a nicer 422 message — the REAL SSRF boundary
 * (DNS-resolve + private/reserved-range reject, closing the DNS-rebinding gap
 * a shape check alone leaves open) is enforced once, centrally, inside
 * `lib/shopify-mcp-client.ts`'s network layer, shared by every caller
 * (this route + the `start_shopify_migration` MCP tool).
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('migrations.connector_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as { shop_domain?: string } | null
  const shopDomain = body?.shop_domain?.trim()
  if (!shopDomain || !isPublicDomainShape(shopDomain)) {
    return NextResponse.json({ error: 'Ingresa un dominio de tienda Shopify válido (ej. mitienda.com o mitienda.myshopify.com).' }, { status: 422 })
  }

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const staged = await stageShopifyBatch({ id: shop.id, slug: shop.slug }, shopDomain)
  if (!staged.ok) return NextResponse.json({ error: staged.error }, { status: staged.status })

  const { data: items } = await db.from('supply_items').select('*').eq('batch_id', staged.batchId)

  return NextResponse.json({
    batchId: staged.batchId,
    items: items ?? [],
    truncated: staged.truncated,
    hasPolicies: staged.hasPolicies,
  }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { generateConnectorSlug } from '@/lib/agent-auth'
import { isEnabled } from '@/lib/flags'

/**
 * GET    /api/sell/agent-connector — auto-provision (if absent) and return the
 *        shop's always-on personal MCP connector URL.
 * POST   /api/sell/agent-connector — rotate it (overwrites the stored slug, so
 *        the old URL stops resolving immediately).
 * DELETE /api/sell/agent-connector — revoke it.
 *
 * Gated by the `seller_agent.connector_url_enabled` kill-switch — flag checked
 * BEFORE auth/DB work (flag → auth → config ordering, LEARNINGS), so a flag
 * outage can never expose this path; off ⇒ 404. See lib/agent-auth.ts for the
 * credential shape: a plaintext, retrievable slug (NOT hashed like the Bearer
 * token) because this endpoint must always be able to re-show it.
 */

async function getOwnShop(userId: string) {
  const { data: shop, error } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !shop) return null
  return shop as { id: string; metadata: Record<string, unknown> | null }
}

function connectorUrl(req: NextRequest, slug: string): string {
  const host = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto = host.includes('localhost') ? 'http' : 'https'
  return `${proto}://${host}/api/ucp/mcp/c/${slug}`
}

export async function GET(req: NextRequest) {
  if (!(await isEnabled('seller_agent.connector_url_enabled'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const existing = existingMeta.ucp_agent_connector_slug
  let slug = typeof existing === 'string' ? existing : null

  if (!slug) {
    slug = generateConnectorSlug()
    const { error } = await db
      .from('marketplace_shops')
      .update({
        metadata: {
          ...existingMeta,
          ucp_agent_connector_slug: slug,
          ucp_agent_connector_created_at: new Date().toISOString(),
        },
      })
      .eq('id', shop.id)

    if (error) {
      console.error('[agent-connector] provision error:', error)
      return NextResponse.json({ error: 'No se pudo crear la URL del conector.' }, { status: 500 })
    }
  }

  return NextResponse.json({ url: connectorUrl(req, slug) })
}

export async function POST(req: NextRequest) {
  if (!(await isEnabled('seller_agent.connector_url_enabled'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const slug = generateConnectorSlug()
  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const { error } = await db
    .from('marketplace_shops')
    .update({
      metadata: {
        ...existingMeta,
        ucp_agent_connector_slug: slug,
        ucp_agent_connector_created_at: new Date().toISOString(),
      },
    })
    .eq('id', shop.id)

  if (error) {
    console.error('[agent-connector] rotate error:', error)
    return NextResponse.json({ error: 'No se pudo rotar la URL.' }, { status: 500 })
  }

  return NextResponse.json({ url: connectorUrl(req, slug) })
}

export async function DELETE() {
  if (!(await isEnabled('seller_agent.connector_url_enabled'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const nextMeta = { ...existingMeta }
  delete nextMeta.ucp_agent_connector_slug
  delete nextMeta.ucp_agent_connector_created_at

  const { error } = await db.from('marketplace_shops').update({ metadata: nextMeta }).eq('id', shop.id)
  if (error) {
    console.error('[agent-connector] revoke error:', error)
    return NextResponse.json({ error: 'No se pudo revocar la URL.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { generateAgentToken } from '@/lib/agent-auth'

/**
 * POST /api/sell/agent-token   — provision (or rotate) the shop's MCP agent token.
 * DELETE /api/sell/agent-token — revoke it.
 *
 * The seller authorizes their own agent here. We return the plaintext token
 * exactly once and store only its SHA-256 hash at metadata.ucp_agent_token_hash
 * (top-level metadata, never inside metadata.settings). See lib/agent-auth.ts.
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

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const { token, hash } = generateAgentToken()
  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const { error } = await db
    .from('marketplace_shops')
    .update({
      metadata: {
        ...existingMeta,
        ucp_agent_token_hash: hash,
        ucp_agent_token_created_at: new Date().toISOString(),
      },
    })
    .eq('id', shop.id)

  if (error) {
    console.error('[agent-token] store error:', error)
    return NextResponse.json({ error: 'No se pudo generar el token.' }, { status: 500 })
  }

  // Plaintext is returned ONCE — it is never persisted and cannot be retrieved again.
  return NextResponse.json({ token, created_at: new Date().toISOString() })
}

export async function DELETE() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const nextMeta = { ...existingMeta }
  delete nextMeta.ucp_agent_token_hash
  delete nextMeta.ucp_agent_token_created_at

  const { error } = await db.from('marketplace_shops').update({ metadata: nextMeta }).eq('id', shop.id)
  if (error) {
    console.error('[agent-token] revoke error:', error)
    return NextResponse.json({ error: 'No se pudo revocar el token.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

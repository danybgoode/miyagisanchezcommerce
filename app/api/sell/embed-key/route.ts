import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { generateEmbedKey, EMBED_KEY_PREFIX } from '@/lib/embed-auth'

/**
 * GET    /api/sell/embed-key — return the shop's embed key, creating one if absent (get-or-create).
 * POST   /api/sell/embed-key — rotate it (invalidates any previously-pasted snippets).
 * DELETE /api/sell/embed-key — revoke it (the widget stops resolving until a new one is minted).
 *
 * The embed key is PUBLISHABLE (it ships in the seller's snippet), so — unlike the
 * agent token — we return the plaintext freely and store it in the clear at
 * top-level metadata.embed_key (out of metadata.settings; see lib/embed-auth.ts).
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

function currentKey(meta: Record<string, unknown>): string | null {
  const k = meta.embed_key
  return typeof k === 'string' && k.startsWith(EMBED_KEY_PREFIX) ? k : null
}

async function storeKey(shopId: string, meta: Record<string, unknown>, key: string, createdAt: string) {
  return db
    .from('marketplace_shops')
    .update({ metadata: { ...meta, embed_key: key, embed_key_created_at: createdAt } })
    .eq('id', shopId)
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const meta = (shop.metadata ?? {}) as Record<string, unknown>
  const existing = currentKey(meta)
  if (existing) {
    return NextResponse.json({ key: existing, created_at: meta.embed_key_created_at ?? null })
  }

  // Get-or-create: mint on first read since the key is public anyway.
  const key = generateEmbedKey()
  const created_at = new Date().toISOString()
  const { error } = await storeKey(shop.id, meta, key, created_at)
  if (error) {
    console.error('[embed-key] create error:', error)
    return NextResponse.json({ error: 'No se pudo generar la llave.' }, { status: 500 })
  }
  return NextResponse.json({ key, created_at })
}

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const meta = (shop.metadata ?? {}) as Record<string, unknown>
  const key = generateEmbedKey()
  const created_at = new Date().toISOString()
  const { error } = await storeKey(shop.id, meta, key, created_at)
  if (error) {
    console.error('[embed-key] rotate error:', error)
    return NextResponse.json({ error: 'No se pudo rotar la llave.' }, { status: 500 })
  }
  return NextResponse.json({ key, created_at })
}

export async function DELETE() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const shop = await getOwnShop(userId)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const meta = { ...((shop.metadata ?? {}) as Record<string, unknown>) }
  delete meta.embed_key
  delete meta.embed_key_created_at

  const { error } = await db.from('marketplace_shops').update({ metadata: meta }).eq('id', shop.id)
  if (error) {
    console.error('[embed-key] revoke error:', error)
    return NextResponse.json({ error: 'No se pudo revocar la llave.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

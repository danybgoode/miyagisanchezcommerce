import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { disconnectMlForSeller } from '@/lib/ml-connection'

/**
 * DELETE /api/sell/ml/disconnect — disconnect the seller's Mercado Libre account.
 * Clerk-authed, gated on `ml.connect_enabled`. Delegates to the backend, which
 * marks the connection disconnected and clears the encrypted token fields.
 */

export async function DELETE() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!(await isEnabled('ml.connect_enabled'))) {
    return NextResponse.json({ error: 'No disponible.' }, { status: 404 })
  }

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const result = await disconnectMlForSeller(shop.slug)
  if (!result.ok) return NextResponse.json({ error: 'No se pudo desconectar.' }, { status: 502 })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

// ── Shared: resolve listing ownership ────────────────────────────────────────

async function resolveListingOwnership(listingId: string, userId: string) {
  const { data, error } = await db
    .from('marketplace_listings')
    .select('id, status, shop_id, marketplace_shops!inner(clerk_user_id)')
    .eq('id', listingId)
    .neq('status', 'deleted')
    .single()

  if (error || !data) return { listing: null, error: 'Anuncio no encontrado.' }

  const shops = data.marketplace_shops as unknown as { clerk_user_id: string } | { clerk_user_id: string }[]
  const shop = Array.isArray(shops) ? shops[0] : shops
  if (shop?.clerk_user_id !== userId) return { listing: null, error: 'No tienes permiso para modificar este anuncio.' }

  return { listing: data, error: null }
}

// ── PATCH — update listing status ─────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params

  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const newStatus = body.status
  const allowed = ['active', 'paused']
  if (!newStatus || !allowed.includes(newStatus)) {
    return NextResponse.json({ error: 'Estado inválido. Usa "active" o "paused".' }, { status: 422 })
  }

  const { listing, error: ownerErr } = await resolveListingOwnership(id, userId)
  if (!listing) return NextResponse.json({ error: ownerErr }, { status: 404 })

  const { error } = await db
    .from('marketplace_listings')
    .update({ status: newStatus })
    .eq('id', id)

  if (error) {
    console.error('Listing status update error:', error)
    return NextResponse.json({ error: 'Error al actualizar el anuncio.' }, { status: 500 })
  }

  return NextResponse.json({ id, status: newStatus })
}

// ── DELETE — soft-delete listing ─────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params

  const { listing, error: ownerErr } = await resolveListingOwnership(id, userId)
  if (!listing) return NextResponse.json({ error: ownerErr }, { status: 404 })

  const { error } = await db
    .from('marketplace_listings')
    .update({ status: 'deleted' })
    .eq('id', id)

  if (error) {
    console.error('Listing delete error:', error)
    return NextResponse.json({ error: 'Error al eliminar el anuncio.' }, { status: 500 })
  }

  return NextResponse.json({ id, deleted: true })
}

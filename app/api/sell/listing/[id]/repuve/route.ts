/**
 * PATCH /api/sell/listing/:id/repuve
 *
 * Updates the REPUVE verification data on an existing listing.
 * Only the listing's owner can update this.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

interface RepuveBody {
  status:  'sin_reporte' | 'con_reporte'
  folio?:  string
  notes?:  string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id: listingId } = await params

  let body: RepuveBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  if (!['sin_reporte', 'con_reporte'].includes(body.status)) {
    return NextResponse.json({ error: 'Estado inválido.' }, { status: 422 })
  }

  // Verify ownership via shop
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, metadata, marketplace_shops!inner(clerk_user_id)')
    .eq('id', listingId)
    .single()

  if (!listing) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  const shop = listing.marketplace_shops as unknown as { clerk_user_id: string | null }
  if (shop.clerk_user_id !== userId) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })

  const existingMeta = (listing.metadata ?? {}) as Record<string, unknown>
  const repuve = {
    status:      body.status,
    folio:       body.folio?.trim().toUpperCase() || null,
    notes:       body.notes?.trim() || null,
    verified_at: new Date().toISOString(),
  }

  const { error } = await db
    .from('marketplace_listings')
    .update({ metadata: { ...existingMeta, repuve } })
    .eq('id', listingId)

  if (error) return NextResponse.json({ error: 'Error al guardar.' }, { status: 500 })
  return NextResponse.json({ ok: true, repuve })
}

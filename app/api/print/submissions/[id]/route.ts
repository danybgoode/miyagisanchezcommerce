/**
 * /api/print/submissions/[id]
 *   GET   — fetch one of the seller's own submissions
 *   PATCH — update content / tier of a draft (owner only)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getSellerByClerk } from '@/lib/print-server'
import type { PrintAdContent } from '@/lib/print'

export const dynamic = 'force-dynamic'

/** Load a submission and assert it belongs to the authenticated seller. */
async function loadOwned(id: string, clerkJwt: string | null) {
  const seller = clerkJwt ? await getSellerByClerk(clerkJwt) : null
  if (!seller) return { error: 'forbidden' as const }
  const { data } = await db.from('print_ad_submissions').select('*').eq('id', id).single()
  if (!data) return { error: 'not_found' as const }
  if (data.seller_id !== seller.id) return { error: 'forbidden' as const }
  return { submission: data, seller }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const res = await loadOwned(id, await getToken())
  if (res.error === 'not_found') return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (res.error) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })
  return NextResponse.json({ submission: res.submission })
}

interface PatchBody {
  tier_key?: string
  content?: PrintAdContent
  /** Resubmit a rejected ad for review after editing. */
  resubmit?: boolean
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: PatchBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const res = await loadOwned(id, await getToken())
  if (res.error === 'not_found') return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (res.error) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })

  // Editable by the buyer only while a draft, or when rejected (edit + resubmit).
  const status = res.submission.status
  if (status !== 'draft' && status !== 'rejected') {
    return NextResponse.json({ error: 'Este anuncio ya no se puede editar.' }, { status: 422 })
  }

  const patch: Record<string, unknown> = {}
  if (body.tier_key) patch.tier_key = body.tier_key
  if (body.content) patch.content = body.content
  // Resubmitting a rejected ad: it was already paid → back into review ('paid'),
  // otherwise back to 'draft'. Clear the editor's rejection note.
  if (body.resubmit && status === 'rejected') {
    patch.status = res.submission.medusa_order_id ? 'paid' : 'draft'
    patch.admin_notes = null
  }

  const { data, error } = await db
    .from('print_ad_submissions')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 500 })
  return NextResponse.json({ submission: data })
}

/**
 * /api/print/submissions
 *   GET  — list the authenticated seller's own submissions
 *   POST — create a draft submission for an open edition + tier
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getSellerByClerk, tierOccupancy, remainingForTier } from '@/lib/print-server'
import type { PrintEdition, PrintAdContent } from '@/lib/print'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const clerkJwt = await getToken()
  const seller = clerkJwt ? await getSellerByClerk(clerkJwt) : null
  if (!seller) return NextResponse.json({ submissions: [] })

  const { data, error } = await db
    .from('print_ad_submissions')
    .select('*, print_editions(title, status, distribution_date, submission_deadline)')
    .eq('seller_id', seller.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'No se pudieron cargar tus anuncios.' }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] })
}

interface CreateBody {
  edition_id: string
  tier_key: string
  content?: PrintAdContent
}

export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: CreateBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  if (!body.edition_id || !body.tier_key) {
    return NextResponse.json({ error: 'edition_id y tier_key son requeridos.' }, { status: 400 })
  }

  const clerkJwt = await getToken()
  const seller = clerkJwt ? await getSellerByClerk(clerkJwt) : null
  if (!seller) {
    return NextResponse.json({ error: 'Necesitas una tienda para anunciarte. Crea tu tienda primero.' }, { status: 403 })
  }

  // ── Validate edition is open and the tier exists + has capacity ───────────
  const { data: edition } = await db
    .from('print_editions')
    .select('*')
    .eq('id', body.edition_id)
    .single() as { data: PrintEdition | null }

  if (!edition || edition.status !== 'open') {
    return NextResponse.json({ error: 'Esta edición ya no acepta anuncios.' }, { status: 422 })
  }
  const tier = (edition.tiers ?? []).find((t) => t.key === body.tier_key)
  if (!tier) return NextResponse.json({ error: 'Tamaño de anuncio no válido.' }, { status: 422 })

  const counts = await tierOccupancy(edition.id)
  if (remainingForTier(tier, counts) <= 0) {
    return NextResponse.json({ error: 'Este tamaño está agotado en esta edición.' }, { status: 422 })
  }

  const { data, error } = await db
    .from('print_ad_submissions')
    .insert({
      edition_id: edition.id,
      tier_key: tier.key,
      seller_id: seller.id,
      buyer_clerk_user_id: userId,
      buyer_email: null,
      medusa_product_id: tier.medusa_product_id ?? null,
      status: 'draft',
      content: body.content ?? {},
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'No se pudo crear el borrador.' }, { status: 500 })
  }
  return NextResponse.json({ submission: data }, { status: 201 })
}

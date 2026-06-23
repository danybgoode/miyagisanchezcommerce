import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { getSeleccionCandidates } from '@/lib/listings'
import { isPinned } from '@/lib/home-curation'
import type { Listing } from '@/lib/types'

/**
 * Homepage Selección · Sprint 2 — candidate pool for the `/admin/seleccion`
 * curation screen. Clerk-gated read (`withAdmin`); returns the freshest listings
 * with their current pin state + rank so the admin can toggle/reorder. The write
 * goes through `PATCH /api/admin/seleccion/[id]`.
 */

export const dynamic = 'force-dynamic'

export interface SeleccionCandidate {
  id: string
  title: string
  image: string | null
  shop_name: string | null
  price_cents: number | null
  currency: string
  pinned: boolean
  rank: number | null
  created_at: string
}

function toCandidate(l: Listing): SeleccionCandidate {
  const rank = l.metadata?.featured_rank
  return {
    id: l.id,
    title: l.title,
    image: l.images?.[0]?.url ?? null,
    shop_name: l.shop?.name ?? null,
    price_cents: l.price_cents ?? null,
    currency: l.currency ?? 'MXN',
    pinned: isPinned(l),
    rank: typeof rank === 'number' ? rank : null,
    created_at: l.created_at,
  }
}

export const GET = withAdmin(async () => {
  const pool = await getSeleccionCandidates(50)
  return NextResponse.json({ candidates: pool.map(toCandidate) })
})

/**
 * /api/admin/print/editions  (Clerk admin-gated via withAdmin)
 *   GET  — list all editions (with provider name + occupancy per tier)
 *   POST — create an edition and mint a Medusa placement product per tier
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { ensureTierProducts, tierOccupancy } from '@/lib/print-server'
import { withAdmin } from '@/lib/admin/guard'
import type { PrintEdition, PrintTier } from '@/lib/print'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  const { data, error } = await db
    .from('print_editions')
    .select('*, print_providers(name, slug)')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const editions = await Promise.all(
    ((data ?? []) as PrintEdition[]).map(async (e) => ({ ...e, occupancy: await tierOccupancy(e.id) })),
  )
  return NextResponse.json({ editions })
})

interface CreateBody {
  provider_id: string
  title: string
  submission_deadline?: string | null
  distribution_date?: string | null
  coverage_zones?: string[]
  tiers: PrintTier[]
}

export const POST = withAdmin(async (req: NextRequest) => {
  let body: CreateBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.provider_id || !body.title?.trim() || !Array.isArray(body.tiers) || body.tiers.length === 0) {
    return NextResponse.json({ error: 'provider_id, title y al menos un tier son requeridos.' }, { status: 400 })
  }

  // 1. Insert the edition (draft) so we have an id to tag the placement products with.
  const { data: edition, error } = await db
    .from('print_editions')
    .insert({
      provider_id: body.provider_id,
      title: body.title.trim(),
      status: 'draft',
      submission_deadline: body.submission_deadline ?? null,
      distribution_date: body.distribution_date ?? null,
      coverage_zones: body.coverage_zones ?? [],
      tiers: body.tiers,
    })
    .select('*')
    .single()
  if (error || !edition) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })

  // 2. Mint a Medusa placement product per priced tier, then persist the ids.
  const { tiers, failed } = await ensureTierProducts(edition.title, edition.id, body.tiers)
  const { data: updated } = await db
    .from('print_editions').update({ tiers }).eq('id', edition.id).select('*').single()

  return NextResponse.json({ edition: updated ?? edition, failed_tiers: failed }, { status: 201 })
})

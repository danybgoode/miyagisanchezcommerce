/**
 * GET /api/print/editions?status=open
 *
 * Lists print editions for the seller portal with live remaining capacity per tier,
 * plus the platform-owned seller id (used by the ad builder's checkout).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getPlatformSellerId, tierOccupancy, toEditionPublic } from '@/lib/print-server'
import type { PrintEdition } from '@/lib/print'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'open'

  let query = db
    .from('print_editions')
    .select('*, print_providers(name)')
    .order('submission_deadline', { ascending: true })

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: 'No se pudieron cargar las ediciones.' }, { status: 500 })
  }

  const editions = await Promise.all(
    ((data ?? []) as Array<PrintEdition & { print_providers?: { name?: string } | null }>).map(
      async (e) => toEditionPublic(e, await tierOccupancy(e.id)),
    ),
  )

  const platformSellerId = await getPlatformSellerId()

  return NextResponse.json({ editions, platform_seller_id: platformSellerId })
}

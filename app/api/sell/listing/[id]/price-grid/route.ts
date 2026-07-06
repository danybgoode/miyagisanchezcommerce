import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/**
 * GET — the listing's live price-grid, proxied for the seller "Opciones"
 * editor (custom-print-products Story 2.4). Same public backend route the PDP
 * reads (`/store/listings/:id/price-grid` — published listings only), just
 * reachable from the client (the publishable key is server-side env) and
 * always fresh, so the editor can refetch right after a save. Clerk-gated for
 * hygiene like the rest of /api/sell, though the data itself is public.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params
  const res = await fetch(`${MEDUSA_BASE}/store/listings/${id}/price-grid`, {
    headers: { 'x-publishable-api-key': PUB_KEY },
    cache: 'no-store',
  })
  if (!res.ok) {
    return NextResponse.json({ error: 'No se pudo cargar la tabla de precios.' }, { status: res.status === 404 ? 404 : 502 })
  }
  return NextResponse.json(await res.json())
}

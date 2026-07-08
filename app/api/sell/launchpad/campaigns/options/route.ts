/**
 * GET /api/sell/launchpad/campaigns/options — picker data for the campaign builder.
 *
 * Returns this shop's published products shaped for the two pickers:
 *  - candidate WORKS  → published launchpad works (carry `metadata.launchpad_submission_id`).
 *  - reward PRODUCT   → CPP-configurable candidates (multi-variant). The authoritative
 *    CPP check still runs server-side at create/activate (`getPriceGrid`); this only
 *    hints which products are likely configurable so the seller picks the right one.
 *
 * Bookshop launchpad · Sprint 3.1. Behind `launchpad.enabled`. Reuses the seller
 * products Store API (same rail as the shelf route).
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

interface RawVariant { id: string }
interface RawProduct {
  id: string
  title?: string
  status?: string
  thumbnail?: string | null
  metadata?: Record<string, unknown> | null
  variants?: RawVariant[]
}

export async function GET() {
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'launchpad_disabled' }, { status: 423 })
  }
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/products?limit=1000&offset=0`, {
    cache: 'no-store',
    headers: { 'x-publishable-api-key': PUB_KEY, Authorization: `Bearer ${clerkJwt}` },
  })
  if (!res.ok) return NextResponse.json({ error: 'No se pudo cargar tu catálogo.' }, { status: 502 })

  const products = (((await res.json()) as { products?: RawProduct[] }).products ?? [])
    .filter((p) => p.status === 'published')

  const works = products
    .filter((p) => !!(p.metadata ?? {})['launchpad_submission_id'])
    .map((p) => ({ id: p.id, title: p.title ?? 'Obra', thumbnail: p.thumbnail ?? null }))

  // Reward candidates: multi-variant products (a configurator listing). The
  // server re-validates true CPP-config at create/activate, so this is a hint.
  const reward_candidates = products
    .filter((p) => (p.variants?.length ?? 0) > 1)
    .map((p) => ({ id: p.id, title: p.title ?? 'Producto', thumbnail: p.thumbnail ?? null }))

  return NextResponse.json({ works, reward_candidates })
}

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/**
 * GET /api/sell/import/existing
 *
 * Returns the set of `external_id`s the authenticated seller already has on
 * their products (read from product metadata). Used by the import staging
 * preview to show "se crearán N / se actualizarán M" before committing.
 * The actual upsert (US-4) re-resolves the authoritative external_id → product_id
 * map server-side, so this is a preview convenience only.
 */
export async function GET() {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/products?limit=200`, {
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    cache: 'no-store',
  })

  if (res.status === 404) return NextResponse.json({ external_ids: [], total: 0 })
  if (!res.ok) {
    return NextResponse.json({ error: 'No se pudieron cargar tus productos.' }, { status: 502 })
  }

  const data = (await res.json()) as {
    listings?: Array<{ metadata?: Record<string, unknown> | null }>
    count?: number
  }

  const externalIds = (data.listings ?? [])
    .map((l) => l.metadata?.external_id)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

  return NextResponse.json({ external_ids: externalIds, total: data.count ?? externalIds.length })
}

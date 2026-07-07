/**
 * PATCH /api/orders/bulk-status — advance several Medusa-backed orders'
 * fulfillment status in one call (ml-orders-native S3 · US-8). Medusa-order-
 * only by construction (bulk selection only ever contains `order_` ids from
 * OrdersInbox.tsx) — doesn't need the legacy-Supabase branching
 * `app/api/orders/[id]/route.ts`'s single-order PATCH carries.
 *
 * Body: { order_ids: string[], status }
 * Response: { advanced: string[], skipped: [{ order_id, reason }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'

export async function PATCH(req: NextRequest) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { order_ids?: string[]; status?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const clerkJwt = await getToken()
  const medusaRes = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/bulk-status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? '',
      ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
    },
    body: JSON.stringify({ order_ids: body.order_ids, status: body.status }),
  })

  if (!medusaRes.ok) {
    const err = await medusaRes.json().catch(() => ({})) as { message?: string }
    return NextResponse.json({ error: err.message ?? 'Error al actualizar pedidos.' }, { status: medusaRes.status })
  }

  const data = await medusaRes.json() as { advanced: string[]; skipped: Array<{ order_id: string; reason: string }> }
  return NextResponse.json(data)
}

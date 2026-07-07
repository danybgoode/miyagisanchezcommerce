/**
 * PATCH /api/orders/[id]/tags — add/remove one tag on a Medusa-backed order
 * (ml-orders-native S3 · US-7). Medusa-order-only (id must start with "order_") —
 * legacy Supabase orders have no tags concept and aren't in scope.
 * Auth: Clerk JWT, forwarded to the backend's own ownership check.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  if (!id.startsWith('order_')) {
    return NextResponse.json({ error: 'Este pedido no admite etiquetas.' }, { status: 422 })
  }

  let body: { add?: string; remove?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const clerkJwt = await getToken()
  const medusaRes = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}/tags`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? '',
      ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
    },
    body: JSON.stringify({ add: body.add, remove: body.remove }),
  })

  if (!medusaRes.ok) {
    const err = await medusaRes.json().catch(() => ({})) as { message?: string }
    return NextResponse.json({ error: err.message ?? 'Error al actualizar etiquetas.' }, { status: medusaRes.status })
  }

  const { tags } = await medusaRes.json() as { tags: string[] }
  return NextResponse.json({ tags })
}

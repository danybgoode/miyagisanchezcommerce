/**
 * Buyer pickup-appointment proxy (Delivery & Manual-Money Polish S2.2).
 *
 * GET   /api/orders/[id]/pickup-appointment — current appointment record
 * PATCH /api/orders/[id]/pickup-appointment — buyer confirms a seller counter
 *        body: { action: 'confirm' }
 *
 * Pickup appointments live on the Medusa order metadata (order_* ids only); forwards to
 * the backend buyer route with the Clerk JWT. No money path.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { tg } from '@/lib/telegram'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY     = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  if (!id.startsWith('order_')) return NextResponse.json({ pickup_appointment: null })

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await medusaFetch(`/store/buyer/me/orders/${id}/pickup-appointment`, clerkJwt)
  const data = await res.json()
  if (!res.ok) return NextResponse.json({ error: data.message ?? 'Error.' }, { status: res.status })
  return NextResponse.json({ pickup_appointment: data.pickup_appointment })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { action?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  if (body.action !== 'confirm') {
    return NextResponse.json({ error: 'Acción inválida.' }, { status: 422 })
  }
  if (!id.startsWith('order_')) {
    return NextResponse.json({ error: 'Esta acción solo está disponible para pedidos recientes.' }, { status: 422 })
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await medusaFetch(`/store/buyer/me/orders/${id}/pickup-appointment`, clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'confirm' }),
  })
  const data = await res.json() as { pickup_appointment?: Record<string, unknown>; pickup_appointment_state?: string; message?: string }
  if (!res.ok) return NextResponse.json({ error: data.message ?? 'Error al confirmar la cita.' }, { status: res.status })

  tg.alert(`📅 Cita de recolección confirmada por el comprador (Medusa)\n${id}`).catch(() => {})
  return NextResponse.json({ pickup_appointment: data.pickup_appointment, pickup_appointment_state: data.pickup_appointment_state ?? 'confirmada' })
}

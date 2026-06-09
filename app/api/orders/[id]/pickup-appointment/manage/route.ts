/**
 * Seller pickup-appointment proxy (Delivery & Manual-Money Polish S2.2).
 *
 * PATCH /api/orders/[id]/pickup-appointment/manage
 *   body: { action: 'confirm' | 'reschedule', date?: string, window?: string }
 *   confirm    → the seller agrees to the buyer's proposed slot (propuesta → confirmada)
 *   reschedule → the seller counters with a new date + window (re-enters propuesta)
 *
 * Pickup appointments live on the Medusa order metadata (order_* ids only); forwards to
 * the backend seller route with the Clerk JWT. No money path.
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { action?: string; date?: string; window?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  if (!['confirm', 'reschedule'].includes(body.action ?? '')) {
    return NextResponse.json({ error: 'Acción inválida.' }, { status: 422 })
  }
  if (!id.startsWith('order_')) {
    return NextResponse.json({ error: 'Esta acción solo está disponible para pedidos recientes.' }, { status: 422 })
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await medusaFetch(`/store/sellers/me/orders/${id}/pickup-appointment`, clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({ action: body.action, date: body.date, window: body.window }),
  })
  const data = await res.json() as { pickup_appointment?: Record<string, unknown>; pickup_appointment_state?: string; message?: string }
  if (!res.ok) return NextResponse.json({ error: data.message ?? 'No se pudo actualizar la cita.' }, { status: res.status })

  const verb = body.action === 'confirm' ? 'confirmada' : 'reprogramada (nueva propuesta)'
  tg.alert(`📅 Cita de recolección ${verb} por el vendedor (Medusa)\n${id}`).catch(() => {})
  return NextResponse.json({ pickup_appointment: data.pickup_appointment, pickup_appointment_state: data.pickup_appointment_state })
}

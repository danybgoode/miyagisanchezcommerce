import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getTenantIntake, saveTenantIntake, setChosenDoor } from '@/lib/tenant-intake'
import { SELLS_OPTIONS, SELLS_WHERE_OPTIONS, type SellsOption, type SellsWhereOption, type DoorKey } from '@/lib/onboarding-personalization'

/**
 * GET/POST `/api/sell/tenant-intake` — the S1 Bienvenida intake read/write
 * (onboarding three-doors epic, Sprint 1 · Story 1.1). Clerk-gated, same
 * shape as the other `/api/sell/*` routes.
 */

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const intake = await getTenantIntake(userId)
  return NextResponse.json({ intake })
}

interface IntakePayload {
  sells?: unknown
  sellsWhere?: unknown
  chosenDoor?: unknown
}

const DOOR_KEYS: DoorKey[] = ['agent', 'import', 'wizard']

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: IntakePayload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  // Door-selection ping (Story 1.2): a separate, smaller write than the Q1/Q2
  // answers, so picking a door never clobbers already-saved chip answers.
  if (typeof body.chosenDoor === 'string') {
    if (!DOOR_KEYS.includes(body.chosenDoor as DoorKey)) {
      return NextResponse.json({ error: 'Puerta inválida.' }, { status: 422 })
    }
    const ok = await setChosenDoor(userId, body.chosenDoor as DoorKey)
    if (!ok) return NextResponse.json({ error: 'No se pudo guardar tu elección.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const sells = (Array.isArray(body.sells) ? body.sells : [])
    .filter((v): v is SellsOption => SELLS_OPTIONS.includes(v as SellsOption))
  const sellsWhere = (Array.isArray(body.sellsWhere) ? body.sellsWhere : [])
    .filter((v): v is SellsWhereOption => SELLS_WHERE_OPTIONS.includes(v as SellsWhereOption))

  const ok = await saveTenantIntake(userId, { sells, sellsWhere })
  if (!ok) return NextResponse.json({ error: 'No se pudo guardar tu respuesta.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}

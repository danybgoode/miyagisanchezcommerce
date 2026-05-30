/**
 * GET /api/cron/order-autoconfirm
 *
 * Auto-confirms delivered orders where the buyer has not confirmed
 * within the seller's configured auto_confirm_days window (default 7 days).
 *
 * Called daily by Vercel Cron (see vercel.json crons config).
 * Protected by CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { tg } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Default auto-confirm window if seller hasn't configured it
const DEFAULT_AUTO_CONFIRM_DAYS = 7

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/** Auto-confirm Medusa-backed delivered orders (lifecycle state on order metadata). */
async function confirmMedusaDelivered(): Promise<number> {
  if (!MEDUSA_INTERNAL_SECRET) return 0
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/autoconfirm-delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': MEDUSA_INTERNAL_SECRET },
      body: JSON.stringify({ days: DEFAULT_AUTO_CONFIRM_DAYS }),
    })
    if (!res.ok) return 0
    const data = await res.json() as { confirmed?: number }
    return data.confirmed ?? 0
  } catch (e) {
    console.error('[auto-confirm] medusa autoconfirm error:', e)
    return 0
  }
}

export async function GET(req: NextRequest) {
  // Validate cron secret
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Medusa-backed orders (system of record) — independent of the Supabase scan below.
  const medusaConfirmed = await confirmMedusaDelivered()

  // Find all orders in 'delivered' status that have been delivered for longer
  // than the shop's auto_confirm_days setting.
  // We join with shops to read the setting from metadata.
  const { data: orders, error } = await db
    .from('marketplace_orders')
    .select(`
      id, updated_at,
      marketplace_shops!inner(id, metadata)
    `)
    .eq('status', 'delivered')
    .is('return_requested_at', null)   // skip orders with pending return requests

  if (error) {
    console.error('[auto-confirm] fetch error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const now = Date.now()
  const toConfirm: string[] = []

  for (const order of orders ?? []) {
    const shop = order.marketplace_shops as unknown as { id: string; metadata: Record<string, unknown> | null }
    const settings = ((shop.metadata?.settings ?? {}) as Record<string, unknown>)
    const ordersSettings = (settings.orders ?? {}) as { auto_confirm_days?: number }
    const windowDays = ordersSettings.auto_confirm_days ?? DEFAULT_AUTO_CONFIRM_DAYS

    const deliveredAt = new Date(order.updated_at).getTime()
    const windowMs = windowDays * 24 * 60 * 60 * 1000

    if (now - deliveredAt >= windowMs) {
      toConfirm.push(order.id)
    }
  }

  if (toConfirm.length === 0) {
    return NextResponse.json({ confirmed: 0, medusaConfirmed, message: 'No Supabase orders to auto-confirm.' })
  }

  const { error: updateError } = await db
    .from('marketplace_orders')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .in('id', toConfirm)

  if (updateError) {
    console.error('[auto-confirm] update error:', updateError)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  console.log(`[auto-confirm] confirmed ${toConfirm.length} orders:`, toConfirm)
  tg.alert(`⏰ Auto-confirmados ${toConfirm.length} pedido(s) entregados sin confirmar.`).catch(() => {})

  return NextResponse.json({ confirmed: toConfirm.length, medusaConfirmed, orderIds: toConfirm })
}

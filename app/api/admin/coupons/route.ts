/**
 * Admin platform-coupon management (Clerk admin-gated via withAdmin). Proxies to
 * the backend /internal/platform-coupons route, which mints coupons owned by the
 * platform-owned seller — redeemable on print-ad checkout.
 *
 *   GET    /api/admin/coupons            — list platform coupons
 *   POST   /api/admin/coupons            — create one
 *   DELETE /api/admin/coupons?id=…        — delete one
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

function backend(path: string, init?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, ...(init?.headers ?? {}) },
  })
}

export const GET = withAdmin(async () => {
  const res = await backend('/internal/platform-coupons')
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  const res = await backend('/internal/platform-coupons', { method: 'POST', body: JSON.stringify({ ...(body as object), created_by: 'admin' }) })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
})

export const DELETE = withAdmin(async (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id requerido.' }, { status: 400 })
  const res = await backend(`/internal/platform-coupons?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
})

/**
 * Admin platform-coupon management (secret-gated). Proxies to the backend
 * /internal/platform-coupons route, which mints coupons owned by the platform
 * `miyagiprints` shop — redeemable on print-ad checkout.
 *
 *   GET    /api/admin/coupons?secret=…           — list platform coupons
 *   POST   /api/admin/coupons?secret=…           — create one
 *   DELETE /api/admin/coupons?secret=…&id=…       — delete one
 *
 * Auth: ?secret=ADMIN_SECRET (or x-admin-secret), matching /api/admin/*.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkAdminSecret } from '@/lib/print-server'

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

function backend(path: string, init?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, ...(init?.headers ?? {}) },
  })
}

export async function GET(req: NextRequest) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await backend('/internal/platform-coupons')
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}

export async function POST(req: NextRequest) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  const res = await backend('/internal/platform-coupons', { method: 'POST', body: JSON.stringify({ ...(body as object), created_by: 'admin' }) })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}

export async function DELETE(req: NextRequest) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id requerido.' }, { status: 400 })
  const res = await backend(`/internal/platform-coupons?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}

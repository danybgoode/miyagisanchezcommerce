import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { withAdmin } from '@/lib/admin/guard'
import { buildFeaturedPatch } from '@/lib/admin/featured'

/**
 * Homepage Selección · Sprint 2 — admin pin/unpin + rank a product. Clerk-gated
 * by `withAdmin` (audited via after()), then forwarded to the admin-scoped
 * backend internal route which writes `metadata.featured` + `metadata.featured_rank`
 * on the Medusa product (the frontend holds no Medusa admin token — the internal
 * x-internal-secret is the service-to-service door). On success we bust the
 * `listings` cache so the homepage Selección reflects the change within its ISR
 * window. Degrades gracefully (502, never throws) if the backend route lags.
 */

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export const PATCH = withAdmin(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Internal secret not configured.' }, { status: 500 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch = buildFeaturedPatch(raw)
  if ('error' in patch) return NextResponse.json({ error: patch.error }, { status: 400 })

  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/admin/featured/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify(patch),
    })
    // A non-2xx fetch does NOT throw — check res.ok explicitly so a failed write
    // never silently reports success (LEARNINGS: "a write whose result nobody checks").
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string }
      return NextResponse.json({ error: d.message ?? `Backend error ${res.status}` }, { status: 502 })
    }
  } catch (e) {
    return NextResponse.json({ error: `Backend unreachable: ${String(e)}` }, { status: 502 })
  }

  // Reflect the change on the homepage within the ISR window.
  revalidateTag('listings', 'default')
  return NextResponse.json({ id, ...patch, updated: true })
})

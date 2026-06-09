import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest) {
  const configured = process.env.NEIGHBORHOOD_PULSE_SMOKE_SECRET
  if (!configured) return { ok: false as const, status: 404 }
  if (req.headers.get('x-neighborhood-pulse-test-secret') !== configured) {
    return { ok: false as const, status: 401 }
  }
  return { ok: true as const }
}

export async function POST(req: NextRequest) {
  const auth = authorized(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 404 ? 'Not found' : 'Unauthorized' }, { status: auth.status })

  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) return NextResponse.json({ error: 'ADMIN_SECRET required for smoke.' }, { status: 412 })

  const now = Date.now()
  const { data: created, error } = await db
    .from('print_social_submissions')
    .insert({
      type: 'saludo',
      caption: `Smoke vecindario ${now}`,
      body: 'Aporte temporal para probar el opt-in web.',
      zone: 'Smoke',
      status: 'approved',
      source: 'editor',
    })
    .select('id, status, web_visible')
    .single()

  if (error || !created?.id) {
    return NextResponse.json({ error: error?.message ?? 'Smoke setup failed.' }, { status: 500 })
  }

  const id = String(created.id)

  try {
    const endpoint = new URL(`/api/admin/print/social/${id}`, req.url)
    const patchHeaders = { 'Content-Type': 'application/json', 'x-admin-secret': adminSecret }

    const on = await fetch(endpoint, {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify({ web_visible: true }),
    })
    const onBody = await on.json().catch(() => null) as { submission?: { status?: string; web_visible?: boolean } } | null

    const off = await fetch(endpoint, {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify({ web_visible: false }),
    })
    const offBody = await off.json().catch(() => null) as { submission?: { web_visible?: boolean } } | null

    return NextResponse.json({
      ok: true,
      default_off: created.web_visible === false,
      toggled_on: on.ok && onBody?.submission?.web_visible === true,
      toggled_off: off.ok && offBody?.submission?.web_visible === false,
      status_after_toggle: onBody?.submission?.status ?? null,
    })
  } finally {
    await db.from('print_social_submissions').delete().eq('id', id).eq('source', 'editor')
  }
}

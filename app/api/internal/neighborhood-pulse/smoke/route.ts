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
    // S2.3: the admin print-social route is now Clerk-only (no machine secret),
    // so this self-test toggles `web_visible` with direct DB writes — the same
    // column the route mutates — instead of an internal HTTP PATCH.
    const { data: on } = await db
      .from('print_social_submissions')
      .update({ web_visible: true }).eq('id', id).select('status, web_visible').single()

    const { data: off } = await db
      .from('print_social_submissions')
      .update({ web_visible: false }).eq('id', id).select('web_visible').single()

    return NextResponse.json({
      ok: true,
      default_off: created.web_visible === false,
      toggled_on: on?.web_visible === true,
      toggled_off: off?.web_visible === false,
      status_after_toggle: on?.status ?? null,
    })
  } finally {
    await db.from('print_social_submissions').delete().eq('id', id).eq('source', 'editor')
  }
}

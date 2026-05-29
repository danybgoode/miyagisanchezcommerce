import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

// Stores a web-push subscription for the current user (upsert on endpoint).
export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | null

  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: 'Suscripción inválida.' }, { status: 400 })
  }

  const { error } = await db.from('push_subscriptions').upsert(
    {
      clerk_user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      ua: req.headers.get('user-agent') ?? null,
    },
    { onConflict: 'endpoint' },
  )

  if (error) return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

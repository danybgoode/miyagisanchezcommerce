/**
 * /api/print/social
 *   GET  — the signed-in user's own social submissions
 *   POST — submit community social content (any signed-in user)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { tgNotify } from '@/lib/telegram'
import { sendPrintSocialReceived } from '@/lib/email'
import { PRINT_SOCIAL_TYPES, type PrintSocialType } from '@/lib/print'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

const VALID_TYPES = new Set(PRINT_SOCIAL_TYPES.map((t) => t.key))

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  const { data } = await db
    .from('print_social_submissions')
    .select('*, print_editions(title)')
    .eq('submitter_clerk_user_id', userId)
    .order('created_at', { ascending: false })
  return NextResponse.json({ submissions: data ?? [] })
}

interface Body {
  type?: string
  caption?: string
  body?: string
  photos?: string[]
  zone?: string
}

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit('offers', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Demasiados envíos. Espera un momento.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Inicia sesión para participar.' }, { status: 401 })

  let body: Body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const caption = (body.caption ?? '').trim()
  if (caption.length < 3) return NextResponse.json({ error: 'Escribe una descripción breve.' }, { status: 400 })
  const type = (body.type && VALID_TYPES.has(body.type as PrintSocialType) ? body.type : 'saludo') as PrintSocialType
  const photos = (Array.isArray(body.photos) ? body.photos : []).filter((u) => typeof u === 'string').slice(0, 4)

  const user = await currentUser()
  const { data, error } = await db
    .from('print_social_submissions')
    .insert({
      submitter_clerk_user_id: userId,
      submitter_name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null,
      submitter_email: user?.emailAddresses?.[0]?.emailAddress ?? null,
      type,
      caption: caption.slice(0, 200),
      body: (body.body ?? '').trim().slice(0, 1000) || null,
      photos,
      zone: (body.zone ?? '').trim().slice(0, 80) || null,
      status: 'submitted',
      source: 'community',
    })
    .select('*')
    .single()

  if (error || !data) return NextResponse.json({ error: 'No se pudo enviar.' }, { status: 500 })
  tgNotify(`📣 Sección social: nuevo aporte (${type}) de ${data.submitter_name ?? 'alguien'} — revisar en /admin/print`).catch(() => {})
  if (data.submitter_email) {
    sendPrintSocialReceived({ toEmail: data.submitter_email, caption: data.caption, mineUrl: `${SITE_URL}/comunidad/mis-aportes` })
      .catch((e) => console.error('[social] confirmation email:', e))
  }
  return NextResponse.json({ submission: data }, { status: 201 })
}

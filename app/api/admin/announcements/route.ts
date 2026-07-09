/**
 * Admin announcement CRUD (Clerk admin-gated via `withAdmin`, epic 08 ·
 * admin-content-and-announcements, Sprint 3). Writes the OWNED `platform_announcements`
 * Supabase table that `lib/announcements.ts` reads through `getActiveAnnouncement()`.
 *
 *   GET    /api/admin/announcements — list every announcement row
 *   POST   /api/admin/announcements — create (no `id`) or update (with `id`) one
 *          campaign. Activating (`active: true`) when another campaign is already
 *          active for the same audience returns `409` + the conflicting row, unless
 *          `replaceExisting: true` is sent — in which case the existing one is
 *          deactivated first (the DB's partial unique index is the race backstop).
 *   DELETE /api/admin/announcements — remove a campaign entirely.
 *
 * `withAdmin` 401s any non-admin BEFORE the handler runs and writes a best-effort
 * `admin_audit_log` row on each successful mutation. Every write calls
 * `revalidateTag('announcements')` so the change is live immediately rather than
 * waiting out the 60s cache window.
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { parseAnnouncementWriteBody, parseAnnouncementDeleteBody } from '@/lib/announcements-admin'
import { decideActivationConflict, type AnnouncementRow } from '@/lib/announcements-merge'

export const dynamic = 'force-dynamic'

const TABLE = 'platform_announcements'

type Row = {
  id: unknown
  audience: unknown
  text: unknown
  cta_label: unknown
  cta_link: unknown
  starts_at: unknown
  ends_at: unknown
  active: unknown
}

function toAnnouncementRow(r: Row): AnnouncementRow {
  return {
    id: String(r.id),
    audience: r.audience === 'buyer' ? 'buyer' : 'seller',
    text: String(r.text),
    ctaLabel: r.cta_label == null ? null : String(r.cta_label),
    ctaLink: r.cta_link == null ? null : String(r.cta_link),
    startsAt: r.starts_at == null ? null : String(r.starts_at),
    endsAt: r.ends_at == null ? null : String(r.ends_at),
    active: Boolean(r.active),
  }
}

export const GET = withAdmin(async () => {
  const { data, error } = await db
    .from(TABLE)
    .select('id, audience, text, cta_label, cta_link, starts_at, ends_at, active, created_at, updated_at, updated_by')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'No se pudieron leer los anuncios.' }, { status: 500 })
  return NextResponse.json({ announcements: data ?? [] })
})

export const POST = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const parsed = parseAnnouncementWriteBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data: existingRows, error: readError } = await db
    .from(TABLE)
    .select('id, audience, text, cta_label, cta_link, starts_at, ends_at, active')
    .eq('audience', parsed.audience)
  if (readError) return NextResponse.json({ error: 'No se pudo verificar la campaña activa.' }, { status: 500 })

  const decision = decideActivationConflict((existingRows ?? []).map(toAnnouncementRow), parsed.audience, {
    active: parsed.active,
    excludeId: parsed.id,
    replaceExisting: parsed.replaceExisting,
  })
  if (!decision.ok) {
    return NextResponse.json(
      { error: 'Ya hay una campaña activa para esta audiencia.', conflict: decision.conflict },
      { status: 409 },
    )
  }

  if (decision.deactivateId) {
    const { error } = await db.from(TABLE).update({ active: false }).eq('id', decision.deactivateId)
    if (error) return NextResponse.json({ error: 'No se pudo reemplazar la campaña activa.' }, { status: 500 })
  }

  const { userId } = await auth()
  const writeRow = {
    audience: parsed.audience,
    text: parsed.text,
    cta_label: parsed.ctaLabel,
    cta_link: parsed.ctaLink,
    starts_at: parsed.startsAt,
    ends_at: parsed.endsAt,
    active: parsed.active,
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  }

  const { data: saved, error: writeError } = parsed.id
    ? await db.from(TABLE).update(writeRow).eq('id', parsed.id).select().single()
    : await db.from(TABLE).insert(writeRow).select().single()
  if (writeError) return NextResponse.json({ error: 'No se pudo guardar el anuncio.' }, { status: 500 })

  revalidateTag('announcements', 'default')
  return NextResponse.json({ ok: true, announcement: saved })
})

export const DELETE = withAdmin(async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const parsed = parseAnnouncementDeleteBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { error } = await db.from(TABLE).delete().eq('id', parsed.id)
  if (error) return NextResponse.json({ error: 'No se pudo eliminar el anuncio.' }, { status: 500 })

  revalidateTag('announcements', 'default')
  return NextResponse.json({ ok: true })
})

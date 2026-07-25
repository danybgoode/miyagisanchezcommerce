/**
 * POST /api/partner/relationship/[id]/draft/[draftId]/confirm — the
 * no-auto-send boundary (Merchant Partner lifecycle · Sprint 2, Story 2.3,
 * README D5).
 *
 * THIS ROUTE SENDS NOTHING. It records `confirmed_at`/`confirmed_by`/
 * `confirmed_channel`/`confirmed_text` (`lib/portfolio/draft-server.ts
 * #confirmDraft`) and returns a DEEP LINK for the BROWSER to open — the
 * `wa.me`/`mailto:` handoff happens client-side, never here. This file
 * imports NO transport (`lib/notify.ts`, `lib/email.ts`, `lib/telegram.ts`,
 * `lib/notifications/dispatch.ts`, `lib/shop-notify.ts`,
 * `lib/promoter-close-notify.ts`) — `e2e/portfolio-no-auto-send.spec.ts`
 * proves that transitively for every module this route reaches.
 *
 * `channel` MUST be one of the merchant's KNOWN contact channels — validated
 * against the relationship's own raw contact fields
 * (`lib/portfolio/confirm.ts#isKnownChannel`), never accepted as free text.
 *
 * GATES: identical to the sibling draft routes (flag → Clerk → rate limit →
 * scope → write role), scoped by BOTH the relationship id and the draft id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizePortfolioRequest } from '@/lib/portfolio/gate-server'
import { resolveRelationshipAccess, canWriteRelationship } from '@/lib/relationship-access'
import { confirmDraft } from '@/lib/portfolio/draft-server'
import { buildConfirmDeepLink, isKnownChannel, type KnownContacts } from '@/lib/portfolio/confirm'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const auth = await authorizePortfolioRequest(req)
  if (auth.error) return auth.error

  const { id, draftId } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json({ ok: false, error: 'No tienes permiso de escritura sobre este comercio.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }
  const { channel, text } = (body ?? {}) as { channel?: unknown; text?: unknown }
  if (typeof channel !== 'string' || typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'Falta el canal o el texto confirmado.' }, { status: 400 })
  }

  const contacts: KnownContacts = {
    whatsapp: access.relationship.whatsapp_e164,
    phone: access.relationship.phone_e164,
    email: access.relationship.email_normalized,
    instagram: access.relationship.instagram_handle,
  }
  if (!isKnownChannel(channel, contacts)) {
    return NextResponse.json(
      { ok: false, error: 'Ese canal no es uno de los canales conocidos de este comercio.' },
      { status: 422 },
    )
  }

  const result = await confirmDraft(id, draftId, auth.user.id, channel, text)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status })

  // Pure string construction — nobody calls this URL from the server. The
  // response hands it to the client, which opens it (or copies `text`, for
  // channels with no deep-link scheme) entirely outside this request.
  const deepLink = buildConfirmDeepLink(channel, contacts, text)

  return NextResponse.json({ ok: true, confirmedAt: result.confirmedAt, channel, deepLink })
}

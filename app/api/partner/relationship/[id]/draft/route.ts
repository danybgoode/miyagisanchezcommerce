/**
 * POST /api/partner/relationship/[id]/draft — generate a fact-bounded
 * follow-up draft (Merchant Partner lifecycle · Sprint 2, Story 2.1).
 *
 * README D4 — this ROUTE never composes text itself and never calls a model.
 * It gathers allowed facts and asks `lib/portfolio/draft-server.ts#generateDraft`
 * (the deterministic template composer) for the text. No LLM client is
 * imported anywhere in this file or anything it calls.
 *
 * GATES, in order: `promoter.partner_portfolio_enabled` (404 when OFF) →
 * Clerk (401) → rate limit (429) → `resolveRelationshipAccess` (403, no
 * record fields) → `canWriteRelationship` (403 for a read-only `viewer`
 * grant — generating a draft is a write-adjacent action even though nothing
 * about the merchant's OWN record changes).
 *
 * NEVER A BARE 500 (build contract): `generateDraft` degrades on its own —
 * a gather/compose/persist failure still returns usable text — so this route
 * has nothing left that can fail into a 500 once access is confirmed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizePortfolioRequest } from '@/lib/portfolio/gate-server'
import { resolveRelationshipAccess, canWriteRelationship } from '@/lib/relationship-access'
import { DRAFT_TEMPLATE_IDS, type DraftTemplateId } from '@/lib/portfolio/draft-compose'
import { generateDraft } from '@/lib/portfolio/draft-server'
import { knownChannelsFor, type KnownContacts } from '@/lib/portfolio/confirm'

export const dynamic = 'force-dynamic'

function isDraftTemplateId(value: unknown): value is DraftTemplateId {
  return typeof value === 'string' && (DRAFT_TEMPLATE_IDS as readonly string[]).includes(value)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizePortfolioRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json({ ok: false, error: 'No tienes permiso de escritura sobre este comercio.' }, { status: 403 })
  }

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    // No body / invalid JSON — fall through to the default template rather
    // than 400ing; "manual composition stays possible" starts with never
    // blocking generation over a missing optional field.
    body = {}
  }
  const requested = (body as { templateId?: unknown } | null)?.templateId
  const templateId: DraftTemplateId = isDraftTemplateId(requested) ? requested : 'follow_up'

  const draft = await generateDraft(access.relationship, auth.actor, templateId, auth.user.id)

  // SAFE-ONLY: which channels are confirmable (names only), never a contact
  // VALUE — same discipline as `lib/portfolio/resolver.ts`'s list DTO.
  const contacts: KnownContacts = {
    whatsapp: access.relationship.whatsapp_e164,
    phone: access.relationship.phone_e164,
    email: access.relationship.email_normalized,
    instagram: access.relationship.instagram_handle,
  }

  return NextResponse.json({
    ok: true,
    draft: {
      id: draft.id,
      templateId: draft.templateId,
      generator: draft.generator,
      generatorVersion: draft.generatorVersion,
      factIds: draft.factIds,
      draftText: draft.draftText,
      editedText: draft.editedText,
      createdBy: draft.createdBy,
      createdAt: draft.createdAt,
      persisted: draft.persisted,
    },
    degraded: draft.degraded,
    knownChannels: knownChannelsFor(contacts),
  })
}

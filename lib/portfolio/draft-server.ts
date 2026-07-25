/**
 * lib/portfolio/draft-server.ts
 *
 * Merchant Partner lifecycle · Sprint 2, Story 2.1 — the IMPURE half of the
 * follow-up draft: gathers the allowed facts through the shipped reuse seams,
 * calls the zero-import `draft-facts.ts` / `draft-compose.ts` siblings, and
 * persists to `merchant_followup_drafts`. Same pure/impure split as
 * `lib/portfolio/{sla,policy-server}.ts`.
 *
 * A COMPOSE/GATHER FAILURE DEGRADES, IT NEVER 500s (build contract, Story
 * 2.1: "failures leave manual composition available... a degraded-but-usable
 * response (the fact set + an empty draft), never a bare 500 that leaves the
 * partner with nothing"). This is a DELIBERATE, NAMED exception to this
 * epic's usual "a Supabase error must never become an empty/false result"
 * rule (`lib/portfolio/loader.ts`'s header): that rule protects an
 * OPERATIONAL claim (is this merchant overdue?) from silently looking like a
 * healthy one. A missing draft FACT carries no operational claim at all — the
 * partner sees exactly what is missing (an omitted clause) and can still type
 * the rest by hand. So each sub-read below degrades its OWN fact to absent
 * and logs loudly, rather than aborting the whole generate call.
 *
 * NO TRANSPORT IS IMPORTED HERE, AND NEVER WILL BE (README D5). This module
 * only ever calls `db` (Supabase) — never `lib/notify.ts`, `lib/telegram.ts`,
 * `lib/email.ts` or `lib/notifications/dispatch.ts`.
 * `e2e/portfolio-no-auto-send.spec.ts` proves that transitively.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { stageLabel } from '@/lib/merchant-stage-labels'
import { ageInStageDays, nextOpenTask } from '@/lib/relationship-pipeline'
import { preferredChannelLabel } from '@/lib/preferred-channels'
import { resolveLinkedShopSummary, type RelationshipActor, type RelationshipRow } from '@/lib/relationship-access'
import { getPromoterByClerkId } from '@/lib/promoter'
import { shopTarget } from '@/lib/shortlink'
import { buildDraftFacts, type DraftFactsSourceInput } from '@/lib/portfolio/draft-facts'
import { composeDraft, DRAFT_TEMPLATE_VERSION, type DraftTemplateId } from '@/lib/portfolio/draft-compose'

export interface GatherDraftFactsResult {
  input: DraftFactsSourceInput
  /** True when ANY sub-read failed and had to degrade its own fact to
   *  absent — surfaced so the route/UI can show "algunos datos no se
   *  pudieron leer" without treating the whole call as failed. */
  degraded: boolean
}

/**
 * Gather every ALLOWED fact for `relationship` from the shipped seams. Reads
 * the open-task title/date (a dedicated small read — `RelationshipRow` and
 * `EnrichedRelationship` carry neither), the linked shop's public URL
 * (`resolveLinkedShopSummary`, already scope-safe), and the ACTING partner's
 * own display name (never the merchant's — `getPromoterByClerkId`).
 */
export async function gatherDraftFacts(
  relationship: RelationshipRow,
  actor: RelationshipActor,
  now: Date,
): Promise<GatherDraftFactsResult> {
  let degraded = false

  // ── The next DATED open task (title + due date) ───────────────────────
  // `nextOpenTask` (imported, D3 — never re-derived) decides WHICH task wins;
  // this read only adds the `title` column it doesn't carry.
  let nextActionTitle: string | null = null
  let nextActionDueAt: string | null = null
  try {
    const { data, error } = await db
      .from('merchant_relationship_tasks')
      .select('id, title, due_at')
      .eq('relationship_id', relationship.id)
      .is('completed_at', null)
    if (error) throw error
    const rows = (data ?? []) as Array<{ id: string; title: string; due_at: string | null }>
    const next = nextOpenTask(rows.map((r) => ({ id: r.id, dueAt: r.due_at })))
    if (next) {
      nextActionTitle = rows.find((r) => r.id === next.id)?.title ?? null
      nextActionDueAt = next.dueAt
    }
  } catch (err) {
    console.error('[portfolio/draft] open-task read failed — the draft will omit the next-action facts:', err)
    degraded = true
  }

  // ── The linked shop's PUBLIC storefront URL ────────────────────────────
  let publicShopUrl: string | null = null
  if (relationship.shop_id) {
    try {
      const shop = await resolveLinkedShopSummary(relationship.shop_id)
      publicShopUrl = shop ? shopTarget(shop.slug) : null
    } catch (err) {
      console.error('[portfolio/draft] shop summary read failed — the draft will omit the shop link:', err)
      degraded = true
    }
  }

  // ── The ACTING partner's own display name (never the merchant's) ───────
  let partnerDisplayName: string | null = null
  try {
    const promoter = actor.promoterId ? await getPromoterByClerkId(actor.clerkUserId) : null
    partnerDisplayName = promoter?.name ?? null
  } catch (err) {
    console.error('[portfolio/draft] partner name read failed — the draft will omit the introduction:', err)
    degraded = true
  }

  // THE canonical lookup (Sprint 1 review fix, PR 308) — never a second
  // hand-rolled hasOwnProperty check against a locally-imported label map.
  // `preferredChannelLabel` owns the own-property-safe guard.
  const preferredChannel = preferredChannelLabel(relationship.preferred_channel)

  const input: DraftFactsSourceInput = {
    stage: relationship.stage,
    stageLabel: stageLabel(relationship.stage),
    ageInStageDays: ageInStageDays(relationship.stage_entered_at, now),
    nextActionTitle,
    nextActionDueAt,
    preferredChannel,
    publicShopUrl,
    // DELIBERATELY always null in v1: the only way to obtain a preview URL is
    // `mintPreviewGrant` (lib/preview-access.ts), which WRITES a fresh grant
    // row and returns a plaintext token that can never be re-read afterward
    // (tokens are stored hashed-only, by design, for preview security). A
    // read-mostly "generate a draft" action minting a new grant as a side
    // effect would be a surprising, unrequested mutation — out of scope here.
    // `composeDraft` already omits any clause referencing an absent fact, so
    // this degrades to exactly what a merchant with no preview link looks
    // like today. Stated, not silent.
    previewUrl: null,
    partnerDisplayName,
    businessName: relationship.business_name,
  }

  return { input, degraded }
}

export interface GeneratedDraft {
  /** Empty string when the write failed — `persisted` is the authoritative
   *  signal, never an empty-string check on `id`. */
  id: string
  relationshipId: string
  templateId: DraftTemplateId
  generator: 'template'
  generatorVersion: number
  factIds: string[]
  draftText: string
  editedText: string | null
  createdBy: string
  createdAt: string
  /** False when the row could not be written — the caller still has
   *  `draftText`/`factIds` to show, just nothing to PATCH/confirm later. */
  persisted: boolean
  /** True when any fact read degraded (see `gatherDraftFacts`). */
  degraded: boolean
}

/**
 * Gather → compose → persist, in one call. NEVER throws: a compose/gather
 * degradation still returns a usable (if smaller) draft, and a PERSIST
 * failure still returns the generated text with `persisted: false` — the
 * route turns neither into a 500 (build contract).
 */
export async function generateDraft(
  relationship: RelationshipRow,
  actor: RelationshipActor,
  templateId: DraftTemplateId,
  actorClerkUserId: string,
  now: Date = new Date(),
): Promise<GeneratedDraft> {
  const { input, degraded } = await gatherDraftFacts(relationship, actor, now)
  const facts = buildDraftFacts(input)
  const composed = composeDraft(facts, templateId)

  const { data, error } = await db
    .from('merchant_followup_drafts')
    .insert({
      relationship_id: relationship.id,
      template_id: templateId,
      generator: 'template',
      generator_version: DRAFT_TEMPLATE_VERSION,
      fact_ids: composed.factIds,
      draft_text: composed.text,
      created_by: actorClerkUserId,
    })
    .select('id, created_at')
    .maybeSingle()

  const base = {
    relationshipId: relationship.id,
    templateId,
    generator: 'template' as const,
    generatorVersion: DRAFT_TEMPLATE_VERSION,
    factIds: composed.factIds,
    draftText: composed.text,
    editedText: null,
  }

  if (error || !data) {
    console.error('[portfolio/draft] draft insert failed — returning the generated text unsaved:', error?.message)
    return { ...base, id: '', createdBy: actorClerkUserId, createdAt: now.toISOString(), persisted: false, degraded: true }
  }

  return {
    ...base,
    id: data.id as string,
    createdBy: actorClerkUserId,
    createdAt: data.created_at as string,
    persisted: true,
    degraded,
  }
}

export type SaveDraftEditResult =
  | { ok: true; id: string; editedText: string }
  | { ok: false; status: 404 | 500; error: string }

/** Save the human's edit. Scoped by BOTH `id` and `relationship_id` — a
 *  draft id from a different relationship can never be edited through this
 *  relationship's route, mirroring every other per-record write in this
 *  epic. */
export async function saveDraftEdit(relationshipId: string, draftId: string, editedText: string): Promise<SaveDraftEditResult> {
  const { data, error } = await db
    .from('merchant_followup_drafts')
    .update({ edited_text: editedText })
    .eq('id', draftId)
    .eq('relationship_id', relationshipId)
    .select('id, edited_text')
    .maybeSingle()
  if (error) {
    console.error('[portfolio/draft] edit save failed:', error.message)
    return { ok: false, status: 500, error: 'No se pudo guardar la edición.' }
  }
  if (!data) return { ok: false, status: 404, error: 'Borrador no encontrado.' }
  return { ok: true, id: data.id as string, editedText: (data.edited_text as string | null) ?? '' }
}

export type ConfirmDraftResult =
  | { ok: true; confirmedAt: string }
  | { ok: false; status: 404 | 500; error: string }

/**
 * Record the human's confirmation. Writes `confirmed_at`/`confirmed_by`/
 * `confirmed_channel`/`confirmed_text` ONLY — no send of any kind happens
 * here or anywhere this function calls (README D5). Scoped by `id` AND
 * `relationship_id`, same discipline as `saveDraftEdit`.
 */
export async function confirmDraft(
  relationshipId: string,
  draftId: string,
  actorClerkUserId: string,
  channel: string,
  text: string,
  now: Date = new Date(),
): Promise<ConfirmDraftResult> {
  const { data, error } = await db
    .from('merchant_followup_drafts')
    .update({
      confirmed_at: now.toISOString(),
      confirmed_by: actorClerkUserId,
      confirmed_channel: channel,
      confirmed_text: text,
    })
    .eq('id', draftId)
    .eq('relationship_id', relationshipId)
    .select('id, confirmed_at')
    .maybeSingle()
  if (error) {
    console.error('[portfolio/draft] confirm write failed:', error.message)
    return { ok: false, status: 500, error: 'No se pudo registrar la confirmación.' }
  }
  if (!data) return { ok: false, status: 404, error: 'Borrador no encontrado.' }
  return { ok: true, confirmedAt: data.confirmed_at as string }
}

/**
 * lib/merchant-relationship-lifecycle.ts
 *
 * Founding merchant activation operations · Sprint 3 — the STAGE side of the
 * event rail. Two jobs:
 *
 *   1. `evaluateRelationship()` (Story 3.1) — the "relationship evaluation"
 *      `/api/cron/merchant-lifecycle-sweep` gains this sprint. Reads fresh
 *      commerce facts (`lib/merchant-commerce-facts.ts`), merges them with
 *      PERMANENT memory (every stage the relationship has already reached —
 *      `lib/merchant-stage.ts#factsAtOrAbove`, so a transient read can only
 *      hold the walk steady or advance it, never regress it), resolves the
 *      furthest reachable stage (`lib/merchant-stage.ts#resolveStage`), and
 *      writes one `merchant_relationship_transitions` row per newly reached
 *      stage — `actor_type: 'commerce_fact'`, `dedupe_key = <stage>`, so a
 *      replay of unchanged facts writes NOTHING (the UNIQUE constraint IS the
 *      idempotency guarantee, never a SELECT-then-INSERT).
 *
 *   2. `emitStageTransition()` (Story 3.2) — THE SEAM every transition source
 *      (this module's own derived-advance writer, AND the admin correction
 *      route, `app/api/admin/relationship/[id]/correct-stage`) calls to
 *      decide whether a written transition also broadcasts to Golden Beans.
 *      A future transition source is covered automatically by calling this,
 *      rather than by re-implementing the guard at its own call site (guard
 *      the population, not the door — Roadmap/LEARNINGS.md).
 *
 *      THE GUARD: an admin can write ANY `to_stage` via the correction route
 *      (S2 — no consent check, no ordinal-monotonicity check; harmless there
 *      because nothing reads `stage` as consent proof). It is NOT harmless
 *      here: per README D2 the 13 stages ARE the Golden Beans event types,
 *      and the projection is write-once-earliest (`LEAST()`) — a milestone
 *      emitted from a mistaken correction is UNWITHDRAWABLE, across two
 *      repos. So a transition with `actorType: 'admin'` onto a
 *      CONSENT-GATED stage (`permission_granted`, `preview_delivered`) is
 *      written to the transitions table regardless — the audit trail is
 *      never suppressed — but does NOT emit unless `hasLiveConsentEvidence`
 *      says the approval holds RIGHT NOW. Fail-closed: an unreadable
 *      approval state also does not emit. Every other actor/stage
 *      combination emits unconditionally — `commerce_fact` transitions are
 *      already backed by the fact that produced them, and every stage
 *      outside the gated two has no note-shaped ambiguity to guard against.
 *
 * Runtime: Node only (Supabase service-role client via the modules this
 * composes). Never import from Edge.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import {
  STAGE_ORDINAL,
  isStage,
  resolveStage,
  factsAtOrAbove,
  mergeStageFacts,
  advanceDedupeKey,
  shouldEmitStageTransition,
  CONSENT_GATED_STAGES,
  type Stage,
  type StageFacts,
  type TransitionActorType,
} from '@/lib/merchant-stage'
import { loadCommerceFacts } from '@/lib/merchant-commerce-facts'
import { emitMerchantLifecycle, type EmitOutcome } from '@/lib/merchant-lifecycle-server'
import type { MerchantLifecycleEvent } from '@/lib/merchant-lifecycle'
import { getPreviewByShop, type MerchantPreview } from '@/lib/preview-access'
import { readApprovalState } from '@/lib/preview-consent'

// ── Story 3.2 — the guarded emitter seam ────────────────────────────────────
// `TransitionActorType`, `CONSENT_GATED_STAGES` and the pure gate DECISION
// (`shouldEmitStageTransition`) all live in `lib/merchant-stage.ts` — zero-
// import, so a spec can walk every branch of the decision with no database.
// This module owns only the DB-touching evidence lookup and the actual send.

/** `merchant.<stage>` for every one of the 12 gated stages — a literal map,
 *  not a template-string cast, so a future stage added to `STAGES` without a
 *  matching `MERCHANT_LIFECYCLE_EVENTS` entry fails to COMPILE here rather
 *  than silently producing an event name Golden Beans rejects. */
const STAGE_EVENT: Readonly<Record<Exclude<Stage, 'scouted'>, MerchantLifecycleEvent>> = {
  qualified: 'merchant.qualified',
  permission_granted: 'merchant.permission_granted',
  preview_in_preparation: 'merchant.preview_in_preparation',
  preview_delivered: 'merchant.preview_delivered',
  activation_scheduled: 'merchant.activation_scheduled',
  claimed: 'merchant.claimed',
  payments_ready: 'merchant.payments_ready',
  three_products_live: 'merchant.three_products_live',
  shared_externally: 'merchant.shared_externally',
  first_inquiry: 'merchant.first_inquiry',
  first_sale: 'merchant.first_sale',
  retained_30d: 'merchant.retained_30d',
}

/** `scouted` is the S1-default baseline every relationship starts at, never a
 *  discrete DERIVED advance — but the migration's CHECK constraint does allow
 *  an admin CORRECTION back onto it, and README D2 counts it among "the 13
 *  stages ARE the event types". `merchant.scouted` covers that edge without
 *  a special case in `stageLifecycleEvent` below. */
const SCOUTED_EVENT: MerchantLifecycleEvent = 'merchant.scouted'

export function stageLifecycleEvent(stage: Stage): MerchantLifecycleEvent {
  return stage === 'scouted' ? SCOUTED_EVENT : STAGE_EVENT[stage]
}

/**
 * `lib/merchant-stage.ts#CONSENT_GATED_STAGES` names `permission_granted` and
 * `preview_delivered` — both derive from the SAME pipeline
 * (`lib/merchant-stage.ts#StageFacts` header: "the SAME consent-evidence
 * pipeline as permissionGrantedEvidence") — there is no field on
 * `ApprovalState` that distinguishes "permission" from "preview delivered"
 * more finely than "a current, non-stale, actually-approved preview exists
 * right now", so `hasLiveConsentEvidence` below uses one shared check for
 * both. FLAGGED for the architect: a finer-grained signal (e.g. a dedicated
 * "permission granted" timestamp distinct from preview approval) would let
 * the two diverge; none exists yet.
 */

/**
 * Read a preview row directly by id — `lib/preview-access.ts` only offers a
 * by-SHOP lookup (`getPreviewByShop`), and a relationship's `preview_id` is
 * often the only link available: the two consent-gated stages both precede
 * shop creation in the funnel (`permission_granted`, `preview_delivered` come
 * before `claimed`), so `relationship.shop_id` is frequently still null when
 * this evidence check runs. Kept local rather than added to preview-access.ts
 * to avoid touching a module Sprint 1/2 of the SIBLING epic still owns.
 */
async function loadPreviewById(previewId: string): Promise<MerchantPreview | null> {
  try {
    const { data, error } = await db
      .from('merchant_previews')
      .select('id, shop_id, status, current_version, created_by')
      .eq('id', previewId)
      .maybeSingle()
    if (error || !data) return null
    return {
      id: String(data.id),
      shopId: String(data.shop_id),
      status: data.status as MerchantPreview['status'],
      currentVersion: Number(data.current_version),
      createdBy: String(data.created_by),
    }
  } catch {
    return null
  }
}

/**
 * Does LIVE evidence currently back this relationship's consent-gated
 * stages? Prefers `previewId` (works before a shop exists), falls back to
 * `shopId` (covers a relationship whose `preview_id` link was never
 * populated but whose shop's preview anchor can still be found). Fail-closed
 * throughout: no preview, an unreadable approval state, or any exception all
 * return `false` — "we don't know" must never read as "evidenced".
 */
export async function hasLiveConsentEvidence(relationship: {
  shopId: string | null
  previewId: string | null
}): Promise<boolean> {
  try {
    let preview: MerchantPreview | null = null
    if (relationship.previewId) preview = await loadPreviewById(relationship.previewId)
    if (!preview && relationship.shopId) preview = await getPreviewByShop(relationship.shopId)
    if (!preview) return false

    const state = await readApprovalState(preview)
    if (!state) return false
    // A current, non-stale APPROVAL — not merely "a preview exists". A
    // changes-requested or never-decided preview carries no consent.
    return state.approvedHash !== null && !state.stale
  } catch {
    return false
  }
}

export interface StageTransitionEmitInput {
  relationshipId: string
  toStage: Stage
  actorType: TransitionActorType
  shopId: string | null
  previewId: string | null
  occurredAt?: Date
  correlationId?: string
}

/** `EmitOutcome` plus the ONE new outcome this guard can produce — kept
 *  distinct from `flag_off`/`send_failed` so a caller can tell "we chose not
 *  to broadcast this" apart from "broadcasting failed". */
export type StageEmitOutcome = EmitOutcome | 'consent_not_evidenced'

/**
 * THE SEAM. See file header for the full guard rationale. Every caller
 * passes the relationship id directly as the subject (README D1 — the
 * relationship id already IS the opaque merchant subject id; unlike the two
 * shop-keyed legacy call sites, nothing here needs `emitMerchantLifecycleForShop`'s
 * shop→relationship resolution hop).
 */
export async function emitStageTransition(input: StageTransitionEmitInput): Promise<StageEmitOutcome> {
  const event = stageLifecycleEvent(input.toStage)

  // Only bother resolving live evidence when the PURE decision could actually
  // depend on it (admin actor, gated stage) — everything else is decided
  // without ever touching Supabase/Medusa a second time.
  const needsEvidence = input.actorType === 'admin' && CONSENT_GATED_STAGES.has(input.toStage)
  const evidenced = needsEvidence
    ? await hasLiveConsentEvidence({ shopId: input.shopId, previewId: input.previewId })
    : false // never consulted by the decision below when `needsEvidence` is false

  if (!shouldEmitStageTransition(input.actorType, input.toStage, evidenced)) {
    return 'consent_not_evidenced'
  }

  return emitMerchantLifecycle(event, {
    merchantId: input.relationshipId,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
  })
}

// ── Story 3.1 — derived-advance evaluation ──────────────────────────────────

interface RelationshipStageRow {
  id: string
  stage: string
  shop_id: string | null
  preview_id: string | null
}

export interface RelationshipEvalOutcome {
  relationshipId: string
  /** False when the commerce-fact read was incomplete OR an emission failed
   *  outright (never counts `consent_not_evidenced` or `flag_off` — both are
   *  deliberate, not broken). The cron route folds this into its own
   *  complete/incomplete decision. */
  ok: boolean
  fromStage: Stage
  toStage: Stage
  /** Newly reached stages, in order — empty when nothing advanced. */
  advanced: Stage[]
}

const UNIQUE_VIOLATION = '23505'

/**
 * Evaluate ONE relationship: fresh commerce facts → merged with permanent
 * memory → resolved stage → write + emit whatever is newly reached.
 * Idempotent by construction (build contract): re-running on unchanged facts
 * resolves to the SAME stage, `advanced` comes back empty, and nothing is
 * written. A late fact simply lets the walk reach further next time — that
 * IS the replay repair, with no special-cased "repair" code path.
 *
 * Returns `null` only when the relationship itself couldn't be read (bad id,
 * DB error) — the caller skips it, same fail-closed posture as every read in
 * `lib/merchant-lifecycle-sweep.ts`.
 */
export async function evaluateRelationship(
  relationshipId: string,
  now: Date = new Date(),
): Promise<RelationshipEvalOutcome | null> {
  const { data, error } = await db
    .from('merchant_relationships')
    .select('id, stage, shop_id, preview_id')
    .eq('id', relationshipId)
    .maybeSingle()
  if (error || !data) return null

  const row = data as unknown as RelationshipStageRow
  if (!isStage(row.stage)) return null // defensive — the DB CHECK should make this unreachable
  const fromStage = row.stage

  const commerce = await loadCommerceFacts({ shopId: row.shop_id })
  const merged = mergeStageFacts(factsAtOrAbove(fromStage), commerce.facts as StageFacts)
  const resolved = resolveStage(merged)

  const fromOrdinal = STAGE_ORDINAL[fromStage]
  const candidates = resolved.reached.filter((s) => STAGE_ORDINAL[s] > fromOrdinal)

  // Stamped on EVERY evaluation, whether or not the stage advanced (Story 3.3 —
  // "last evaluation" is a freshness signal, not a change signal). Best-effort:
  // a failed stamp doesn't block anything below, and the next run just stamps
  // it late.
  await db
    .from('merchant_relationships')
    .update({ last_evaluated_at: now.toISOString() })
    .eq('id', relationshipId)

  if (candidates.length === 0) {
    return { relationshipId, ok: commerce.ok, fromStage, toStage: fromStage, advanced: [] }
  }

  const written: Stage[] = []
  let emitFailed = false
  let prevStage: Stage = fromStage

  for (const stage of candidates) {
    const { error: insertError } = await db.from('merchant_relationship_transitions').insert({
      relationship_id: relationshipId,
      from_stage: prevStage,
      to_stage: stage,
      to_stage_ordinal: STAGE_ORDINAL[stage],
      actor_type: 'commerce_fact',
      actor_id: null,
      reason: null,
      dedupe_key: advanceDedupeKey(stage),
    })
    // A unique violation means this exact advance was already recorded (a
    // concurrent run, or a prior partial run that wrote it but stopped
    // before mirroring `stage`) — the constraint is the idempotency
    // guarantee, not this branch; treat it as success and keep walking.
    if (insertError && (insertError as { code?: string }).code !== UNIQUE_VIOLATION) {
      // Stop here — every LATER candidate's `from_stage` chains from this
      // one, so writing past a failure would record a broken chain.
      break
    }
    written.push(stage)
    prevStage = stage

    const outcome = await emitStageTransition({
      relationshipId,
      toStage: stage,
      actorType: 'commerce_fact',
      shopId: row.shop_id,
      previewId: row.preview_id,
      occurredAt: now,
    })
    if (outcome === 'send_failed' || outcome === 'claim_failed') emitFailed = true
  }

  const finalStage = written.length > 0 ? written[written.length - 1] : fromStage
  if (finalStage !== fromStage) {
    // Optimistic concurrency: only move `stage` FROM the value we read. A
    // concurrent admin correction that already moved it elsewhere is never
    // stomped — the next evaluation recomputes `factsAtOrAbove` from
    // whatever `stage` actually is now.
    await db
      .from('merchant_relationships')
      .update({ stage: finalStage, stage_entered_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('id', relationshipId)
      .eq('stage', fromStage)
  }

  return {
    relationshipId,
    ok: commerce.ok && !emitFailed,
    fromStage,
    toStage: finalStage,
    advanced: written,
  }
}

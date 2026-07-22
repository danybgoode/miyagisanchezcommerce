/**
 * lib/merchant-lifecycle-server.ts
 *
 * Golden Beans event-destination-router · Story 3.1 — the SERVER half of the merchant
 * lifecycle loop. The pure logic lives in `lib/merchant-lifecycle.ts`; this file owns
 * everything that touches Supabase or the network, so that file can stay zero-import
 * and branch-testable.
 *
 * Two directions:
 *   - `applyLifecycleEvent()`  — Golden Beans → the Miyagi projection (consumer).
 *   - `emitMerchantLifecycle()` — Miyagi → Golden Beans' POST /api/v1/track (producer).
 *
 * The loop is: Miyagi emits → Golden Beans stores the canonical event and fans it out
 * → Golden Beans delivers it back here → the projection materializes. Golden Beans is
 * the event system; Miyagi materializes relationship state; **Medusa remains commerce
 * truth** (epic Decision 4). Nothing here reads or writes a product, order or price —
 * `first_sale` is a milestone FLAG, and there is no column for an amount.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { sendGrowthEventWithResult } from '@/lib/growth-engine'
import {
  buildLifecycleTrackPayload,
  type LifecycleEmitFacts,
  type LifecycleTrackPayload,
  type MerchantLifecycleEvent,
} from '@/lib/merchant-lifecycle'

// ---------------------------------------------------------------------------
// CONSUMER — apply a delivered event to the projection.
// ---------------------------------------------------------------------------

export type ApplyResult =
  /** First time we have seen this event id; the projection moved. */
  | { status: 'applied' }
  /** A retry or an operator replay of an event we already projected. A NO-OP, and a
   *  completely normal outcome — delivery is at-least-once by contract. */
  | { status: 'duplicate' }
  /** Supabase was unreachable or errored. The caller MUST turn this into a 5xx so
   *  Golden Beans backs off and retries; a 2xx here silently drops the event. */
  | { status: 'error'; message: string }

export interface ApplyInput {
  eventId: string
  type: MerchantLifecycleEvent
  merchantId: string
  occurredAt: string
  /** X-GB-Delivery-Id — per-ATTEMPT, diagnostics only, never a dedupe key. */
  deliveryId: string | null
  /** The verified envelope, stored so a projection bug can be replayed from what we
   *  actually received rather than from what we believe was sent. */
  payload: unknown
}

/**
 * Apply one event. Idempotency is enforced by the PRIMARY KEY on
 * `merchant_lifecycle_deliveries.event_id` inside a single plpgsql function — not by a
 * read-then-write here. Two retries of the same event can be in flight concurrently,
 * and a SELECT-then-INSERT would let both pass the SELECT and both write.
 *
 * The dedupe insert and the projection upsert are in the same function invocation, so
 * they commit together. Splitting them would create the one unrecoverable state:
 * event recorded, projection not moved, and every retry deduped away.
 */
export async function applyLifecycleEvent(input: ApplyInput): Promise<ApplyResult> {
  try {
    const { data, error } = await db.rpc('apply_merchant_lifecycle_event', {
      p_event_id: input.eventId,
      p_event_type: input.type,
      p_merchant_id: input.merchantId,
      p_occurred_at: input.occurredAt,
      p_delivery_id: input.deliveryId,
      p_payload: input.payload,
    })

    if (error) return { status: 'error', message: error.message }

    // `duplicate` is the authoritative field; `applied` is its complement. Read the
    // one the function actually sets rather than inferring from a missing key — an
    // absent/garbled response must NOT read as a successful apply.
    const result = (data ?? {}) as { applied?: boolean; duplicate?: boolean }
    if (result.duplicate === true) return { status: 'duplicate' }
    if (result.applied === true) return { status: 'applied' }
    return { status: 'error', message: 'unexpected response from apply_merchant_lifecycle_event' }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'unknown error' }
  }
}

// ---------------------------------------------------------------------------
// PRODUCER — emit a milestone to Golden Beans, at most once per merchant.
// ---------------------------------------------------------------------------

/** Postgres unique-violation. The emit guard is a constraint, so this code IS the
 *  "already emitted" answer — we never ask first. */
const UNIQUE_VIOLATION = '23505'

export type EmitOutcome =
  | 'emitted'
  | 'already_emitted'
  | 'flag_off'
  | 'send_failed'
  | 'claim_failed'

/**
 * `delivered_unrecorded` means golden-beans ACCEPTED the event but we could not persist
 * that fact. The row stays pending and will be re-sent (harmlessly — the idempotency key
 * dedupes it), but the caller must not report a clean run: a permanently pending row that
 * is actually delivered looks exactly like a stuck integration (cross-review round 5).
 *
 * Why this is not a boolean: `flag_off` is a deliberate operator state,
 * not a failure. Collapsing it into `false` made the sweep count every claimed milestone
 * as an error while telemetry was intentionally disabled, which would have had the cron
 * alarm continuously for a condition nobody needs to act on (cross-review round 4).
 */
export type DeliveryOutcome = 'delivered' | 'delivered_unrecorded' | 'failed' | 'flag_off'

/** One pending emission, as the sweep's drain reads it. */
export interface PendingEmission {
  merchantId: string
  eventType: string
  payload: LifecycleTrackPayload
  attempts: number
}

/**
 * Emit one merchant lifecycle milestone. **Once per (merchant, milestone), forever.**
 *
 * The loop cannot provide that guarantee itself: while `DESTINATION_DELIVERY_ENABLED`
 * is OFF in Golden Beans nothing is delivered back, so "has this milestone already been
 * projected?" answers no forever. Several call sites are genuinely repeat-prone —
 * `upsertOrderMirror` runs from the Stripe webhook, the MercadoPago webhook and the
 * reconcile cron, and the sweep runs daily.
 *
 * THE SHAPE (rewritten after cross-agent review, PR #298):
 *
 *   1. CLAIM the (merchant, event) slot under a PRIMARY KEY, storing the payload we
 *      intend to send. Two concurrent callers race the insert; exactly one wins.
 *   2. SEND that stored payload verbatim.
 *   3. Mark `delivered_at` only on a confirmed 2xx.
 *
 * A failed send leaves the claim PENDING — it is never deleted. That is deliberate and
 * it closes two holes the delete-on-failure version had: an ambiguous failure (Golden
 * Beans accepted it, the response timed out) no longer produces a second canonical
 * event, and a failed cleanup no longer burns the milestone permanently. The daily
 * sweep drains pending rows, and the retry is safe because the payload carries a stable
 * `context.idempotencyKey` that Golden Beans deduplicates on.
 *
 * The payload is REPLAYED, not rebuilt: Golden Beans fingerprints the payload alongside
 * the idempotency key and rejects a mismatch, and a rebuild would carry a fresh
 * `occurredAt`.
 *
 * Never throws. Telemetry must not break a consent, claim, or money path — same
 * contract as `emitPreviewEvent` and `lib/telegram.ts`.
 */
export async function emitMerchantLifecycle(
  event: MerchantLifecycleEvent,
  facts: LifecycleEmitFacts,
): Promise<EmitOutcome> {
  try {
    const merchantId = String(facts.merchantId ?? '').trim()
    if (!merchantId) return 'claim_failed'

    const payload = buildLifecycleTrackPayload(event, facts)

    const { error: claimError } = await db
      .from('merchant_lifecycle_emissions')
      .insert({ merchant_id: merchantId, event_type: event, payload })

    if (claimError && claimError.code !== UNIQUE_VIOLATION) {
      // Do NOT send. An unclaimed send can repeat on every subsequent call with no bound.
      console.error(`[merchant-lifecycle] claim failed for ${merchantId}/${event}:`, claimError.message)
      return 'claim_failed'
    }

    // Whether we just claimed it or lost the race, read back the AUTHORITATIVE row —
    // it holds the payload that must actually go on the wire (the winner's, not ours).
    const { data: row, error: readError } = await db
      .from('merchant_lifecycle_emissions')
      .select('payload, delivered_at, attempts')
      .eq('merchant_id', merchantId)
      .eq('event_type', event)
      .maybeSingle()

    if (readError || !row) {
      console.error(`[merchant-lifecycle] claim read-back failed for ${merchantId}/${event}`)
      return 'claim_failed'
    }
    if (row.delivered_at) return 'already_emitted'

    const outcome = await deliverClaimedEmission(
      merchantId,
      event,
      (row.payload ?? payload) as LifecycleTrackPayload,
      typeof row.attempts === 'number' ? row.attempts : 0,
    )
    // The claim survives every outcome — the sweep drains it. `send_failed` and
    // `flag_off` are statuses, not losses, which is why no caller needs to handle them.
    if (outcome === 'delivered') return 'emitted'
    if (outcome === 'flag_off') return 'flag_off'
    // 'delivered_unrecorded' collapses into 'send_failed' on purpose. From a caller's
    // point of view the two are identical: the row is still pending, the sweep will
    // re-send, and the run is not clean. Erring toward "failed" is the safe direction.
    return 'send_failed'
  } catch {
    // Intentionally swallowed — observability must never break the caller's path.
    return 'send_failed'
  }
}

/**
 * Send a claimed payload and record the outcome. Returns true only on a confirmed 2xx.
 *
 * A failure records the error and increments `attempts`, leaving the row pending; it
 * never deletes the claim. Failing to record the failure is itself only logged — the
 * row stays pending either way, which is the safe direction.
 */
export async function deliverClaimedEmission(
  merchantId: string,
  eventType: string,
  payload: LifecycleTrackPayload,
  attempts = 0,
): Promise<DeliveryOutcome> {
  // The flag is checked HERE, not before the claim. A claim skipped because telemetry
  // was off would lose the milestone forever — `growth.telemetry_enabled` is OFF in
  // production today, so a pre-claim check would have discarded every approval, claim
  // and first sale until the day someone flipped it (cross-review round 2). Claiming
  // always and sending conditionally means the outbox simply fills while the flag is
  // off, and the sweep drains it the moment it is turned on.
  if (!(await isEnabled('growth.telemetry_enabled'))) return 'flag_off'

  let sent = false
  let error: string | null = null
  try {
    sent = await sendGrowthEventWithResult(payload)
    if (!sent) error = 'golden-beans did not accept the event (non-2xx, timeout, or unconfigured)'
  } catch (err) {
    error = err instanceof Error ? err.message : 'unknown error'
  }

  const { error: writeError } = await db
    .from('merchant_lifecycle_emissions')
    .update({
      ...(sent ? { delivered_at: new Date().toISOString(), last_error: null } : { last_error: error }),
      // Incremented from the value the caller read. Not a read-modify-write race worth
      // guarding: this is a diagnostic counter, and the row it describes is claimed by
      // exactly one (merchant, event) key.
      attempts: attempts + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('merchant_id', merchantId)
    .eq('event_type', eventType)

  if (writeError) {
    console.error(
      `[merchant-lifecycle] could not record ${sent ? 'delivery' : 'failure'} for ${merchantId}/${eventType}:`,
      writeError.message,
    )
    // PROPAGATED, not just logged. Returning plain 'delivered' here let the sweep report
    // a complete run while the row stayed pending and was re-sent on every future run.
    if (sent) return 'delivered_unrecorded'
  }
  return sent ? 'delivered' : 'failed'
}

/**
 * Milestones claimed but not confirmed delivered. Drained by the daily sweep.
 *
 * Bounded and oldest-first: an unbounded drain would let one bad day's backlog stall
 * the whole sweep, and the pending set is expected to be near-empty.
 */
export async function listPendingEmissions(
  limit = 200,
): Promise<{ pending: PendingEmission[]; truncated: boolean; failed: boolean }> {
  const { data, error } = await db
    .from('merchant_lifecycle_emissions')
    .select('merchant_id, event_type, payload, attempts')
    .is('delivered_at', null)
    .not('payload', 'is', null)
    // ATTEMPTS FIRST, then age. Ordering by age alone let the oldest N rows starve
    // everything behind them: if those N keep failing, every run selects the same batch
    // and a newer milestone is never attempted at all (cross-review round 6). Sorting by
    // attempt count puts repeatedly-failing rows behind fresh ones, so the queue always
    // makes forward progress while still retrying the stuck ones eventually.
    .order('attempts', { ascending: true })
    .order('emitted_at', { ascending: true })
    // limit + 1: `rows.length >= limit` cannot tell "exactly `limit` rows exist" from
    // "more than `limit` exist", so a full-but-final page reported truncation and cost a
    // pointless 503 + retry (cross-review round 5). The extra row is the probe and is
    // discarded.
    .limit(limit + 1)

  if (error) {
    // Reported, never swallowed into an empty list: "the read failed" and "there is
    // nothing pending" must not look identical to the caller, or a broken drain reports
    // a clean run forever (cross-review round 2).
    console.error('[merchant-lifecycle] pending-emission read failed:', error.message)
    return { pending: [], truncated: false, failed: true }
  }
  const fetched = data ?? []
  const truncated = fetched.length > limit
  const rows = truncated ? fetched.slice(0, limit) : fetched
  return {
    pending: rows.map((r) => ({
      merchantId: String(r.merchant_id),
      eventType: String(r.event_type),
      payload: r.payload as LifecycleTrackPayload,
      attempts: typeof r.attempts === 'number' ? r.attempts : 0,
    })),
    // More work than one run can take. The next run picks up the rest, but the caller
    // must not describe this run as complete.
    truncated,
    failed: false,
  }
}

/**
 * Medusa seller id → `marketplace_shops.id` (the merchant subject key).
 *
 * The money path knows a merchant only by their Medusa seller id, but every lifecycle
 * event is keyed on the mirror UUID — the same non-personal subject
 * lib/preview-events.ts uses. Same lookup `app/api/claim/complete` already does.
 * Returns null when there is no mirror row, and the caller then emits NOTHING: a
 * milestone with a Medusa id in the subject would silently create a second identity
 * for the same merchant in the projection.
 */
export async function resolveMerchantIdForSeller(sellerId: string): Promise<string | null> {
  if (!sellerId) return null
  try {
    const { data } = await db
      .from('marketplace_shops')
      .select('id')
      .contains('metadata', { medusa_seller_id: sellerId })
      .maybeSingle()
    return data?.id ? String(data.id) : null
  } catch {
    return null
  }
}


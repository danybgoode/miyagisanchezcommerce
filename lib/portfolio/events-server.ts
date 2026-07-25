/**
 * lib/portfolio/events-server.ts
 *
 * Merchant Partner lifecycle · Sprint 3, Story 3.3 — the IMPURE half of the
 * PII-free SLA/retention event rail (README D8). Claims a row in the SAME
 * `merchant_lifecycle_emissions` outbox every milestone already uses, then
 * hands delivery to the SAME `deliverClaimedEmission`
 * (`lib/merchant-lifecycle-server.ts`) every milestone already goes through
 * — "one sender, one outbox, one drain," never a parallel table or a
 * parallel HTTP call.
 *
 * WHY THIS CLAIM/READ-BACK LOGIC IS NOT `emitMerchantLifecycle` ITSELF:
 * that function's `event` parameter is typed to the 14-value
 * `MerchantLifecycleEvent` union, and this file MUST NOT widen it —
 * `lib/merchant-lifecycle.ts` is the CONSUMER's accept-list file (README
 * D8: "read D8 before touching it") and stays completely untouched by this
 * sprint. `PortfolioTrackPayload` (`lib/portfolio/events.ts`) is
 * STRUCTURALLY IDENTICAL to `LifecycleTrackPayload` on the wire — they
 * differ only in the TYPE of `event` (a disjoint string-literal union
 * either way; Golden Beans reads it as a plain string regardless), so the
 * one place that difference matters is a single, well-commented cast at
 * the `deliverClaimedEmission` call site below. `deliverClaimedEmission`
 * and `listPendingEmissions` themselves are genuinely SHARED (imported, not
 * duplicated) — that is where "one sender" actually lives.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { deliverClaimedEmission, type EmitOutcome } from '@/lib/merchant-lifecycle-server'
import type { LifecycleTrackPayload } from '@/lib/merchant-lifecycle'
import { buildPortfolioEventPayload, type PortfolioEventSourceInput } from '@/lib/portfolio/events'
import type { RelationshipActor } from '@/lib/relationship-access'

const UNIQUE_VIOLATION = '23505'

/**
 * A synthetic admin-scoped actor for the sweep's OWN cross-partner SLA
 * scan — mirrors `lib/portfolio/reminders-server.ts`'s own `CRON_ACTOR`
 * shape (kept as an independent literal here, rather than importing that
 * Sprint-2 module's private constant, so this file adds no dependency on a
 * module it must not reshape). `isAdmin: true` makes
 * `listScopedRelationships` (via `loadPortfolio`) return every
 * relationship — never written as a real Clerk identity anywhere.
 */
export const PORTFOLIO_EVENT_SWEEP_ACTOR: RelationshipActor = {
  clerkUserId: 'system:portfolio-events-sweep',
  promoterId: null,
  promoterCode: null,
  isAdmin: true,
}

/**
 * Emit one portfolio lifecycle event. Claim-then-deliver, exactly
 * `emitMerchantLifecycle`'s own shape (`lib/merchant-lifecycle-server.ts`)
 * — the claim under the widened PRIMARY KEY IS the idempotency guarantee,
 * never a SELECT-then-INSERT. `input.dedupeKey` must be a real,
 * per-occurrence key (never `''`, which is reserved for milestones) — an
 * empty one fails closed to `'claim_failed'` rather than silently
 * colliding with a differently-keyed milestone row.
 *
 * Emit AFTER the canonical write, never instead of it (build contract): a
 * failed emission leaves nothing pending to roll back — the stewardship
 * write this event describes already committed before this function was
 * ever called, and a claim/send failure here only means the FACT doesn't
 * reach Golden Beans yet, retried by the next sweep drain.
 *
 * Never throws — telemetry must not break the caller's write path, the
 * same contract `emitMerchantLifecycle` and `lib/telegram.ts` already keep.
 */
export async function emitPortfolioLifecycleEvent(input: PortfolioEventSourceInput): Promise<EmitOutcome> {
  try {
    const merchantId = String(input.relationshipId ?? '').trim()
    const dedupeKey = String(input.dedupeKey ?? '').trim()
    if (!merchantId || !dedupeKey) return 'claim_failed'

    const payload = buildPortfolioEventPayload(input)

    const { error: claimError } = await db
      .from('merchant_lifecycle_emissions')
      .insert({ merchant_id: merchantId, event_type: input.event, dedupe_key: dedupeKey, payload })
    if (claimError && claimError.code !== UNIQUE_VIOLATION) {
      console.error(`[portfolio/events] claim failed for ${merchantId}/${input.event}/${dedupeKey}:`, claimError.message)
      return 'claim_failed'
    }

    // Whether we just claimed it or lost the race, read back the
    // AUTHORITATIVE row — mirrors `emitMerchantLifecycle`'s own discipline.
    const { data: row, error: readError } = await db
      .from('merchant_lifecycle_emissions')
      .select('payload, delivered_at, attempts')
      .eq('merchant_id', merchantId)
      .eq('event_type', input.event)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    if (readError || !row) {
      console.error(`[portfolio/events] claim read-back failed for ${merchantId}/${input.event}/${dedupeKey}`)
      return 'claim_failed'
    }
    if (row.delivered_at) return 'already_emitted'

    // Structurally-identical-but-differently-typed cast — see the file
    // header for why this is safe and why it is a cast rather than a
    // reshape of the shared sender.
    const outcome = await deliverClaimedEmission(
      merchantId,
      input.event,
      (row.payload ?? payload) as unknown as LifecycleTrackPayload,
      typeof row.attempts === 'number' ? row.attempts : 0,
      dedupeKey,
    )
    if (outcome === 'delivered') return 'emitted'
    if (outcome === 'flag_off') return 'flag_off'
    // 'delivered_unrecorded' collapses into 'send_failed' — same reasoning
    // as `emitMerchantLifecycle`: the row is still pending, the sweep will
    // re-send, and the run is not clean.
    return 'send_failed'
  } catch {
    return 'send_failed'
  }
}

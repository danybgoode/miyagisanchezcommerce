/**
 * lib/merchant-lifecycle-sweep.ts
 *
 * Golden Beans event-destination-router · Story 3.1 — the periodic half of the emit
 * side, and the safety net for the whole of it. Four jobs, in order:
 *
 *   1. DRAIN pending emissions (claimed, not yet confirmed delivered).
 *   2. BACKFILL `preview_approved` / `claimed` / `first_sale` from state.
 *   3. Derive `merchant.three_products_live` from **Medusa**.
 *   4. Derive `merchant.retained_30d` from **Medusa**.
 *
 * WHY BACKFILL WHAT THE HOOKS ALREADY EMIT (2).
 * The hooks in the approval and claim paths give TIMELINESS. This gives COMPLETENESS.
 * A hook that never ran — a transient DB error at claim time, a milestone reached before
 * this feature shipped, a new door someone adds later — would otherwise lose that
 * milestone permanently, because nothing ever revisits it. Deriving from state is
 * self-healing, and the once-only constraint means the two paths cannot collide.
 *
 * `first_sale` has NO hook at all and is derived here only. It briefly had one in
 * `upsertOrderMirror`, which was removed (cross-review round 3): the reconcile-cron path
 * reaches that writer long after the order, so it stamped the milestone with the
 * RECONCILIATION time, and the permanent outbox claim then blocked this sweep from ever
 * correcting it. Deriving it here uses Medusa's actual earliest captured order, and it
 * takes the money path out of this PR entirely — a worthwhile trade for at most a day of
 * latency on a CRM milestone.
 *
 * WHY A SWEEP AND NOT A HOOK AT ALL (3).
 * `three_products_live` is a THRESHOLD on accumulated state, not a moment, and it has
 * no single door: a product reaches `published` through the seller portal, the MCP
 * `create_listing` tool, the bulk catalog importer, supply activation, a preview
 * activation and the listing-status seam. Hooking the door you happen to find and
 * calling it done is exactly the failure this repo has already paid for (LEARNINGS:
 * "guard the population, not the door you found"). Deriving from the resulting STATE is
 * mechanically complete by construction — it does not care how the third product got
 * there, and a door added next month is covered without anyone remembering to.
 * `retained_30d` needs a sweep regardless: nothing happens at the 30-day mark to hook.
 *
 * MEDUSA IS COMMERCE TRUTH, INCLUDING HERE (AGENTS rule #1; cross-agent review, Codex,
 * PR 298). The first version counted `marketplace_listings` / `marketplace_orders` —
 * the Supabase mirrors. That was wrong in a way that matters: these milestones are
 * PERMANENT and once-only, so a mirror row that has drifted from Medusa emits a false
 * milestone that can never be withdrawn. Both counts now come from Medusa:
 *   - products via the public `GET /store/sellers/{slug}/products` (the same
 *     visibility-filtered read the public storefront uses — published means published),
 *   - orders via the backend internal `GET /internal/sellers/orders` (cron-usable; the
 *     Clerk-gated `/store/sellers/me/*` routes are not).
 * The mirrors are still read for *funnel bookkeeping* — who is a founding merchant, and
 * which shop maps to which seller slug. That is not commerce state.
 *
 * FAIL CLOSED. Every read that cannot be completed skips the merchant rather than
 * assuming zero, and the failure is COUNTED in the result so a cron that did nothing
 * cannot report success. An unreachable Medusa must never be read as "no products".
 */
import 'server-only'
import { db } from '@/lib/supabase'
import {
  emitMerchantLifecycle,
  deliverClaimedEmission,
  listPendingEmissions,
  type EmitOutcome,
} from '@/lib/merchant-lifecycle-server'

/** The activation threshold the contract names: the THIRD product going live. */
export const THREE_PRODUCTS_THRESHOLD = 3

/** "Still active 30 days after first sale." */
export const RETENTION_WINDOW_DAYS = 30

const RETENTION_WINDOW_MS = RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

/**
 * Rows per page.
 *
 * MUST stay well under PostgREST's `db-max-rows` (default 1000), and the walk must not
 * depend on that: an earlier version used PAGE_SIZE = 1000 with a `limit + 1` probe, so
 * a request for 1001 rows was silently capped at 1000, the probe read "no more", and the
 * sweep stopped early while reporting `truncated: false` — a partial run announcing
 * itself as complete, which is the exact failure class six review rounds kept catching
 * (fresh-reviewer pass, PR 298). Two independent defences now: a page size with real
 * headroom, AND truncation decided by the server's own `count` rather than inferred from
 * page length, which is correct whatever `db-max-rows` turns out to be.
 */
const PAGE_SIZE = 500

/** UUIDs per `.in()` batch. These serialise into a GET query string, so a large batch
 *  is a 414 rather than a slow query — 200 uuids is roughly 7.6 KB, comfortably inside
 *  any proxy's header limit. */
const IN_BATCH_SIZE = 200

/** Hard ceiling on one run, so a runaway table cannot make the cron unbounded. The
 *  founding-merchant population is small by definition; reaching this means something
 *  is wrong, which is why it is REPORTED (`truncated`) rather than silently absorbed. */
const CANDIDATE_CAP = 20_000

/** Read every row of a table, page by page. Returns `truncated` only when the hard cap
 *  stopped the walk — never merely because one page was full. */
async function readPaged(
  table: string,
  columns: string,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; errors: number }> {
  const rows: Array<Record<string, unknown>> = []
  for (let offset = 0; offset < CANDIDATE_CAP; offset += PAGE_SIZE) {
    // `count: 'exact'` makes the SERVER tell us the true total. Inferring "is there
    // more?" from how many rows came back cannot be trusted, because PostgREST may cap
    // the response below what we asked for — and then a short page is indistinguishable
    // from the end of the table.
    const { data, error, count } = await db
      .from(table)
      .select(columns, { count: 'exact' })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      // Report and stop: continuing past a failed page would produce a result that
      // looks complete while missing an arbitrary slice of the population.
      console.error(`[merchant-lifecycle] paged read of ${table} failed at ${offset}:`, error.message)
      return { rows, truncated: true, errors: 1 }
    }
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>
    rows.push(...page)

    // An empty page always ends the walk (guards against a zero-progress loop if the
    // server ever returns nothing while claiming a larger count).
    if (page.length === 0) return { rows, truncated: false, errors: 0 }
    if (typeof count === 'number') {
      if (rows.length >= count) return { rows, truncated: false, errors: 0 }
    } else if (page.length < PAGE_SIZE) {
      // No count header — fall back to page-length inference, which is sound HERE only
      // because PAGE_SIZE is below db-max-rows.
      return { rows, truncated: false, errors: 0 }
    }
  }
  // Genuinely more rows than one run may read. Reported, so the 503 is an honest alarm
  // rather than a silent ceiling — at CANDIDATE_CAP founding merchants something is
  // wrong with the population query, not with the cron.
  return { rows, truncated: true, errors: 0 }
}

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'

/** Per-request budget for a Medusa read. Without it, a backend that accepts the
 *  connection and never answers stalls the WHOLE cron on one merchant: every later
 *  merchant goes unchecked and the 503 this route exists to return is never returned,
 *  because the platform kills the request first (cross-review round 5). */
const MEDUSA_TIMEOUT_MS = 10_000

/**
 * Wall-clock budget for one run. The sweep is sequential — 200 drained deliveries at
 * 5s each plus two 10s Medusa reads per candidate can far exceed any platform request
 * limit — and being KILLED mid-run is strictly worse than stopping: the next run
 * restarts on the same oldest work and never reaches the rest (cross-review round 6).
 *
 * Stopping deliberately lets the run report `truncated` (→ 503 → retry) with its
 * partial progress durably committed, and every unit of work it did complete is
 * permanent, so the following run resumes rather than repeats.
 */
const SWEEP_BUDGET_MS = 240_000
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export interface SweepResult {
  candidates: number
  /** True when the candidate query hit CANDIDATE_CAP — some merchants were NOT looked
   *  at. A caller that ignores this is reporting a partial sweep as a complete one. */
  truncated: boolean
  drained: number
  /** Milestones recovered from state because a hook never ran (or ran before this
   *  feature existed). Reported separately so a healthy run is distinguishable from a
   *  run that is quietly repairing missed events. */
  backfilled: number
  threeProductsLive: number
  retained30d: number
  /** True when `growth.telemetry_enabled` is OFF. NOT an error — a deliberate operator
   *  state. Milestones are still claimed and stay pending, so nothing is lost; the drain
   *  ships them the moment the flag is on. Surfaced so a run reporting zero deliveries
   *  explains itself. */
  telemetryOff: boolean
  /** Reads that failed. Non-zero means this run was incomplete, whatever else it did. */
  errors: number
}

interface Candidate {
  merchantId: string
  sellerSlug: string | null
  /** `merchant_previews.approved_at` — the consent record, non-commerce, and the
   *  authoritative answer to "did this merchant approve their preview?". */
  previewApprovedAt: string | null
  /** `marketplace_shops.clerk_user_id` — set the moment ownership transfers. Claiming
   *  is a marketplace concept, not a commerce one, so the mirror IS the record here. */
  claimedByClerkId: string | null
}

/**
 * The order statuses that mean money was captured, as an ALLOW-LIST.
 *
 * This started as a deny-list of `refunded | pending_payment | canceled`, on the theory
 * that seller-set `fulfillment_state` values are all paid orders. That was wrong in the
 * direction that costs the most (cross-review round 3): a deny-list treats EVERY other
 * string — `draft`, `failed`, a typo, a status added next quarter — as revenue, and
 * these milestones are permanent and unwithdrawable.
 *
 * So: unknown status ⇒ NOT captured. The asymmetry is deliberate. A milestone deferred
 * by an unrecognised status is recovered by the next sweep once this list is widened;
 * a milestone granted by one can never be taken back.
 *
 * KNOWN LIMITATION (fresh-reviewer pass, PR 298 — deliberately not fixed here). `'paid'`
 * is a FALL-THROUGH DEFAULT in `normalizeMedusaOrder`, not an assertion that money was
 * captured: that function initialises `status = 'paid'` and only demotes it for
 * cancel/refund/return, or for a MANUAL payment method that is not yet captured. A
 * card/MercadoPago order sitting at `payment_status: 'authorized'` therefore normalises
 * to `'paid'` and would grant `merchant.first_sale`. This allow-list closed the "unknown
 * string ⇒ revenue" half of the problem; it cannot close this half, because
 * `normalizeMedusaOrder` does not return `payment_status` at all. Closing it properly
 * means surfacing `payment_status` (or a boolean `captured`) from
 * `/internal/sellers/orders` — a backend change, tracked as owed before the
 * `DESTINATION_DELIVERY_ENABLED` flip. Bounded meanwhile: this is a CRM milestone, not
 * money, and nothing emits until that flip.
 */
const CAPTURED_ORDER_STATUSES = new Set([
  'paid',
  'processing',
  'shipped',
  'delivered',
  'fulfilled',
  'completed',
])

function isCapturedOrder(status: unknown): boolean {
  return typeof status === 'string' && CAPTURED_ORDER_STATUSES.has(status)
}

/**
 * The population this epic tracks: FOUNDING merchants, not every shop on the
 * marketplace. A shop qualifies once it has entered the funnel at all — it has a
 * preview anchor (it was pitched) or it has already emitted some milestone.
 *
 * Deliberately NOT "every shop": the epic is a founding-merchant CRM proof, and
 * sweeping the whole marketplace would emit activation milestones for hundreds of
 * scraped imports nobody is running a relationship with.
 *
 * These are Supabase reads by design — "is this merchant in our funnel?" and "which
 * seller slug is this shop?" are marketplace bookkeeping, not commerce facts.
 */
async function loadCandidates(): Promise<{ candidates: Candidate[]; truncated: boolean; errors: number }> {
  const ids = new Set<string>()
  const approvedAt = new Map<string, string>()
  let errors = 0
  let truncated = false

  // PAGED, not `.limit(CAP)`. A single capped read always returns the SAME first N rows,
  // so any merchant past the cap would be permanently unswept no matter how many daily
  // runs happen — the cap would silently become a hard ceiling on the funnel rather than
  // a per-run budget (cross-review round 3). Paging walks the whole set; `truncated`
  // now means only "this run stopped at the hard cap", and the next run resumes from the
  // page after the last one it completed is not needed because the work itself is
  // idempotent — the emission constraint makes a re-scan of earlier pages free.
  const previews = await readPaged('merchant_previews', 'shop_id, approved_at')
  errors += previews.errors
  truncated ||= previews.truncated
  for (const row of previews.rows) {
    if (!row?.shop_id) continue
    ids.add(String(row.shop_id))
    if (row.approved_at) approvedAt.set(String(row.shop_id), String(row.approved_at))
  }

  const emitted = await readPaged('merchant_lifecycle_emissions', 'merchant_id')
  errors += emitted.errors
  truncated ||= emitted.truncated
  for (const row of emitted.rows) if (row?.merchant_id) ids.add(String(row.merchant_id))

  // Resolve slug + claim state in batches rather than one read per merchant.
  const merchantIds = [...ids]
  const shopById = new Map<string, { slug: string | null; clerkUserId: string | null }>()
  for (let i = 0; i < merchantIds.length; i += IN_BATCH_SIZE) {
    const shops = await db
      .from('marketplace_shops')
      .select('id, slug, clerk_user_id')
      .in('id', merchantIds.slice(i, i + IN_BATCH_SIZE))
    if (shops.error) {
      errors += 1
      continue
    }
    for (const row of shops.data ?? []) {
      if (!row?.id) continue
      shopById.set(String(row.id), {
        slug: row.slug ? String(row.slug) : null,
        clerkUserId: row.clerk_user_id ? String(row.clerk_user_id) : null,
      })
    }
  }

  return {
    candidates: merchantIds.map((merchantId) => ({
      merchantId,
      sellerSlug: shopById.get(merchantId)?.slug ?? null,
      previewApprovedAt: approvedAt.get(merchantId) ?? null,
      claimedByClerkId: shopById.get(merchantId)?.clerkUserId ?? null,
    })),
    truncated,
    errors,
  }
}

/** Milestones already delivered or claimed, so the sweep skips the work rather than
 *  relying on the unique-violation path for every merchant on every run. The constraint
 *  is still what GUARANTEES once-only — this is an optimisation, not the guard. */
async function loadClaimed(): Promise<{
  byMerchant: Map<string, Set<string>>
  errors: number
  truncated: boolean
}> {
  const byMerchant = new Map<string, Set<string>>()
  const paged = await readPaged('merchant_lifecycle_emissions', 'merchant_id, event_type')
  if (paged.errors > 0) return { byMerchant, errors: paged.errors, truncated: paged.truncated }
  for (const row of paged.rows) {
    const id = String(row?.merchant_id ?? '')
    if (!id) continue
    if (!byMerchant.has(id)) byMerchant.set(id, new Set())
    byMerchant.get(id)!.add(String(row?.event_type ?? ''))
  }
  // A truncated claim map means some milestones look unclaimed and get re-attempted.
  // The PK still guarantees once-only, so this is wasted Medusa calls rather than a
  // correctness bug — but the run is partial and must say so (fresh-reviewer pass).
  return { byMerchant, errors: 0, truncated: paged.truncated }
}

/**
 * LIVE product count, from Medusa. `GET /store/sellers/{slug}/products` is the public,
 * visibility-filtered storefront read — what it returns is what is actually published.
 *
 * Returns null on ANY failure so the caller SKIPS rather than reads zero. An
 * unreachable Medusa must never be able to withhold a milestone forever, and — worse in
 * the other direction — a partial response must never be able to grant one.
 */
async function countLiveProductsFromMedusa(sellerSlug: string): Promise<number | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/sellers/${encodeURIComponent(sellerSlug)}/products`, {
      headers: medusaHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(MEDUSA_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      products?: unknown[]
      listings?: unknown[]
      count?: number
    }
    const items = data.products ?? data.listings
    if (!Array.isArray(items)) return null
    // The route paginates (default limit 20) and returns the TRUE total alongside the
    // page. `items.length` would cap the reported count at 20 — harmless for the >= 3
    // threshold, but the number is shipped to Golden Beans as `product_count` and
    // forwarded verbatim to every destination, so it has to be right (fresh-reviewer
    // pass). Falls back to the page length only if the route stops sending `count`.
    return typeof data.count === 'number' ? data.count : items.length
  } catch {
    return null
  }
}

/**
 * Has this merchant transacted again SINCE their first sale? Read from Medusa, the
 * order system of record, via the backend's internal route (a cron has no Clerk JWT).
 *
 * The contract says "still active 30 days after first sale" without defining active, so
 * this pins a concrete, checkable definition: at least one further captured order after
 * the one that produced the first-sale milestone. A merchant with exactly one order 40
 * days ago is not retained — they are a one-off, and counting them would make the
 * retention number mean "survived 30 days on the calendar", which nobody wants to read.
 *
 * Returns null when the answer cannot be determined, so the caller skips.
 */
async function listCapturedOrders(
  sellerSlug: string,
): Promise<Array<{ created_at: string }> | null> {
  if (!INTERNAL_SECRET) return null
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/sellers/orders?seller_slug=${encodeURIComponent(sellerSlug)}`,
      {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        cache: 'no-store',
        signal: AbortSignal.timeout(MEDUSA_TIMEOUT_MS),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { orders?: Array<{ created_at?: string; status?: string }> }
    if (!Array.isArray(data.orders)) return null
    return data.orders
      .filter((o) => o?.created_at && isCapturedOrder(o.status))
      .map((o) => ({ created_at: String(o.created_at) }))
  } catch {
    return null
  }
}

function medusaHeaders(): Record<string, string> {
  const key = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
  return key ? { 'x-publishable-api-key': key } : {}
}

/**
 * Run one sweep. Never throws — a failure on one merchant must not abort the rest, and
 * a failed run is simply retried by the next one (every emission is idempotent).
 */
export async function sweepMerchantLifecycle(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    candidates: 0,
    truncated: false,
    drained: 0,
    backfilled: 0,
    telemetryOff: false,
    threeProductsLive: 0,
    retained30d: 0,
    errors: 0,
  }

  // ── 1. Drain anything claimed but not confirmed delivered ──────────────────
  // Re-sending is safe: the payload is replayed verbatim under a stable
  // idempotencyKey, and golden-beans returns the existing event for a repeat.
  const deadline = Date.now() + SWEEP_BUDGET_MS
  const outOfTime = () => Date.now() > deadline

  const drain = await listPendingEmissions()
  if (drain.failed) result.errors += 1
  if (drain.truncated) result.truncated = true
  for (const pending of drain.pending) {
    if (outOfTime()) {
      result.truncated = true
      break
    }
    try {
      const outcome = await deliverClaimedEmission(
        pending.merchantId,
        pending.eventType,
        pending.payload,
        pending.attempts,
      )
      if (outcome === 'delivered') result.drained += 1
      else if (outcome === 'flag_off') result.telemetryOff = true
      else {
        // Includes 'delivered_unrecorded': golden-beans has it, we could not record
        // that. Harmless to re-send (the idempotency key dedupes), but the run is not
        // clean and must not be reported as such.
        result.errors += 1
      }
    } catch {
      result.errors += 1
    }
  }

  const loaded = await loadCandidates()
  result.candidates = loaded.candidates.length
  // OR, never assign: the drain may already have set it (cross-review round 3 — a
  // straight assignment here erased a truncated drain whenever the candidate walk
  // completed, so >200 pending emissions reported a clean run).
  result.truncated ||= loaded.truncated
  result.errors += loaded.errors

  const claimed = await loadClaimed()
  result.errors += claimed.errors
  result.truncated ||= claimed.truncated
  // Without the claim map we cannot skip safely; the constraint would still prevent a
  // duplicate, but we would hammer Medusa for every merchant on every run.
  if (claimed.errors > 0) return result

  for (const { merchantId, sellerSlug, previewApprovedAt, claimedByClerkId } of loaded.candidates) {
    if (outOfTime()) {
      result.truncated = true
      break
    }
    const done = claimed.byMerchant.get(merchantId) ?? new Set<string>()

    // ── 2. BACKFILL the event-driven milestones from state ────────────────────
    // The hooks in the approval / claim / order-mirror paths give timeliness; this
    // gives COMPLETENESS. A hook that never ran — a transient DB error at claim time,
    // a milestone reached before this feature shipped, a door added later — would
    // otherwise lose the milestone permanently, because nothing revisits it
    // (cross-review round 2). Deriving from state is self-healing.
    if (!done.has('merchant.preview_approved') && previewApprovedAt) {
      // The real approval timestamp, not now — this one we actually know.
      if (record(await emitMerchantLifecycle('merchant.preview_approved', {
        merchantId,
        occurredAt: new Date(previewApprovedAt),
      }), result)) {
        result.backfilled += 1
      }
    }

    if (!done.has('merchant.claimed') && claimedByClerkId) {
      if (record(await emitMerchantLifecycle('merchant.claimed', { merchantId, occurredAt: now }), result)) {
        result.backfilled += 1
      }
    }

    // Every remaining check needs the Medusa seller slug. No slug → no authoritative
    // read → skip. Deliberately not falling back to the Supabase mirror.
    if (!sellerSlug) {
      // Every Medusa-derived milestone is unreachable without it. `retained_30d` was
      // missing from this list, so a merchant whose first_sale and three_products_live
      // were already claimed had its retention check skipped SILENTLY, forever
      // (cross-review round 4).
      const unreachable = (
        ['merchant.three_products_live', 'merchant.first_sale', 'merchant.retained_30d'] as const
      ).some((e) => !done.has(e))
      if (unreachable) {
        console.error(`[merchant-lifecycle] no seller slug for merchant ${merchantId} — skipped`)
        result.errors += 1
      }
      continue
    }

    // Orders are needed for both first_sale and retention; fetch once.
    const needsOrders = !done.has('merchant.first_sale') || !done.has('merchant.retained_30d')
    const orders = needsOrders ? await listCapturedOrders(sellerSlug) : []
    if (needsOrders && orders === null) result.errors += 1

    if (!done.has('merchant.first_sale') && orders && orders.length > 0) {
      const earliest = orders
        .map((o) => Date.parse(o.created_at))
        .filter((t) => !Number.isNaN(t))
        .sort((a, b) => a - b)[0]
      if (earliest !== undefined) {
        if (record(await emitMerchantLifecycle('merchant.first_sale', {
          merchantId,
          occurredAt: new Date(earliest),
        }), result)) {
          result.backfilled += 1
        }
      }
    }

    // ── 3. merchant.three_products_live ───────────────────────────────────────
    if (!done.has('merchant.three_products_live')) {
      try {
        const live = await countLiveProductsFromMedusa(sellerSlug)
        if (live === null) {
          result.errors += 1
        } else if (live >= THREE_PRODUCTS_THRESHOLD) {
          // `occurredAt` is NOW, not the third product's publish time: nothing records
          // when the count crossed the threshold, and inventing a timestamp we cannot
          // derive would be worse than an honest one. Read this column as "when we
          // first observed three live", never as "when the third went live".
          if (record(await emitMerchantLifecycle('merchant.three_products_live', {
            merchantId,
            occurredAt: now,
            productCount: live,
          }), result)) {
            result.threeProductsLive += 1
          }
        }
      } catch {
        result.errors += 1
      }
    }

    // ── 4. merchant.retained_30d ──────────────────────────────────────────────
    if (!done.has('merchant.retained_30d') && orders && orders.length > 0) {
      try {
        const times = orders
          .map((o) => Date.parse(o.created_at))
          .filter((t) => !Number.isNaN(t))
          .sort((a, b) => a - b)
        const firstSaleMs = times[0]
        if (firstSaleMs === undefined) continue

        const thirtyDayMark = firstSaleMs + RETENTION_WINDOW_MS
        if (now.getTime() < thirtyDayMark) continue

        // "STILL ACTIVE 30 DAYS AFTER first sale" — a captured order dated ON OR AFTER
        // the 30-day mark. The earlier rule ("any later order") was wrong in a way that
        // permanently over-counted: a first sale on July 1 plus one order on July 2 and
        // silence thereafter would have emitted `retained_30d` on July 31, describing a
        // merchant who churned on day 3 as retained (cross-review round 2). Pending and
        // refunded orders are already excluded by `isCapturedOrder`, upstream.
        // The EARLIEST order at or after the mark is when retention actually happened.
        // `now` would permanently stamp the sweep's own run time — and because the
        // outbox allows one emission per milestone, a sweep recovering an August
        // retention in October would have recorded October, forever (cross-review
        // round 5). The timestamp is right here; there is no excuse for guessing.
        const qualifying = times.find((t) => t >= thirtyDayMark)
        if (qualifying === undefined) continue

        if (record(await emitMerchantLifecycle('merchant.retained_30d', {
          merchantId,
          occurredAt: new Date(qualifying),
        }), result)) {
          result.retained30d += 1
        }
      } catch {
        result.errors += 1
      }
    }
  }

  return result
}

/**
 * Did this emission actually go out, and if not, was that a FAILURE?
 *
 * `counted()` used to return a bare boolean, so a `send_failed` / `claim_failed` on a
 * newly-discovered milestone left `errors` at zero and the cron reported a clean run
 * while a milestone it had just found never left the building (cross-review round 4).
 * `flag_off` is deliberately NOT an error — telemetry being switched off is an operator
 * decision, and the claim is safely pending until it is switched back on.
 */
function record(outcome: EmitOutcome, result: SweepResult): boolean {
  if (outcome === 'emitted') return true
  if (outcome === 'already_emitted') return false
  if (outcome === 'flag_off') {
    result.telemetryOff = true
    return false
  }
  result.errors += 1
  return false
}

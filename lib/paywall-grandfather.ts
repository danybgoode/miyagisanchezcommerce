/**
 * lib/paywall-grandfather.ts
 *
 * The PURE planner for the paywall grandfather backfill
 * (golden-frijoles-integration · S3.1).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * Three flags invert the usual polarity: `domain.paywall_enabled`,
 * `subdomain.paywall_enabled` and `ml.sync_paywall_enabled` are ON when the gate is
 * ENFORCED. All three are already ON in production, and the grandfather grants that
 * are supposed to protect existing shops were stamped once, at each SKU's cutover.
 * Shops created since carry no grant — so on 2026-08-14 five of thirty shops had no
 * `subdomain_grant`, one of them a real merchant claimed five days earlier.
 *
 * The product owner's instruction is "paywalls ON, grandfather everyone": every shop
 * that exists at backfill time keeps what it has, and genuinely new signups meet the
 * paywall. That is what `grandfather` means, and it is why this is a one-shot
 * backfill rather than a stamp at shop creation — stamping every new shop would make
 * the paywall unreachable and the flag decorative.
 *
 * ── WHY A PURE PLANNER ────────────────────────────────────────────────────────
 * The decision (who needs a grant, and why not) is separated from the write so the
 * whole thing is unit-testable with no database, and so `--dry-run` and `--apply`
 * derive from ONE function rather than two that can disagree. A dry run that plans
 * something different from what apply does is worse than no dry run.
 *
 * IDEMPOTENT BY CONSTRUCTION: a shop that already carries ANY grant for a SKU is
 * skipped, including an expired `one_time`. That is deliberate and conservative — an
 * expired one-time grant means the shop bought a term that lapsed, and silently
 * converting it to a permanent grandfather grant would give away a paid SKU. Such a
 * shop is reported as `skip: existing_grant` so it is visible rather than absorbed.
 */
import { readGrant, type DomainGrant } from '@/lib/domain-entitlement'
import { SUBDOMAIN_GRANT_KEY } from '@/lib/subdomain-entitlement'
import { ML_SYNC_GRANT_KEY } from '@/lib/ml-sync-entitlement'

/** The three SKUs whose entitlement lives on the `marketplace_shops` mirror. */
export const PAYWALL_SKUS = ['custom_domain', 'subdomain', 'ml_sync'] as const
export type PaywallSku = (typeof PAYWALL_SKUS)[number]

/**
 * The metadata key each SKU stores its durable grant on. Imported from each SKU's
 * own module rather than restated — a paraphrased contract drifts permissive, and
 * this is exactly the shape `readGrant` parses and `deriveDomainEntitlement` honors.
 */
export const PAYWALL_GRANT_KEY: Record<PaywallSku, string> = {
  custom_domain: 'custom_domain_grant',
  subdomain: SUBDOMAIN_GRANT_KEY,
  ml_sync: ML_SYNC_GRANT_KEY,
}

/**
 * Build the canonical `grandfather` grant. Same shape `buildCompGrant` produces,
 * with the type that `deriveDomainEntitlement` treats as permanently entitling —
 * `grandfather` and `comp` both entitle forever; only `one_time` lapses on read.
 */
export function buildGrandfatherGrant(opts?: { note?: string; now?: Date }): DomainGrant {
  return {
    type: 'grandfather',
    granted_at: (opts?.now ?? new Date()).toISOString(),
    ...(opts?.note?.trim() ? { note: opts.note.trim() } : {}),
  }
}

export type ShopForBackfill = {
  id: string
  slug: string | null
  name: string | null
  metadata: Record<string, unknown> | null
}

export type BackfillDecision = {
  shopId: string
  slug: string | null
  sku: PaywallSku
  action: 'grant' | 'skip'
  /** `existing_grant` is the only skip reason — everything else is granted. */
  reason: 'needs_grant' | 'existing_grant'
  /** The grant already present, when skipping. Carried so the report can name its type. */
  existing?: DomainGrant
}

export type BackfillPlan = {
  decisions: BackfillDecision[]
  /** Per-SKU tallies, so the report never counts by hand. */
  totals: Record<PaywallSku, { grant: number; skip: number }>
}

/**
 * Decide, for every shop × SKU, whether a grandfather grant is owed.
 *
 * Total and pure: no clock beyond the injected `now`, no I/O, no throwing. Called
 * identically by `--dry-run` and `--apply`.
 */
export function planGrandfatherBackfill(
  shops: readonly ShopForBackfill[],
  skus: readonly PaywallSku[] = PAYWALL_SKUS,
): BackfillPlan {
  const decisions: BackfillDecision[] = []
  const totals = Object.fromEntries(
    PAYWALL_SKUS.map((sku) => [sku, { grant: 0, skip: 0 }]),
  ) as BackfillPlan['totals']

  for (const shop of shops) {
    for (const sku of skus) {
      const existing = readGrant(shop.metadata, PAYWALL_GRANT_KEY[sku])
      if (existing) {
        decisions.push({ shopId: shop.id, slug: shop.slug, sku, action: 'skip', reason: 'existing_grant', existing })
        totals[sku].skip += 1
      } else {
        decisions.push({ shopId: shop.id, slug: shop.slug, sku, action: 'grant', reason: 'needs_grant' })
        totals[sku].grant += 1
      }
    }
  }

  return { decisions, totals }
}

/**
 * The metadata patch for one shop: its existing metadata plus every grant this plan
 * owes it. Returns `null` when the shop is owed nothing, so the caller writes
 * nothing at all rather than issuing a no-op UPDATE — a write that changes no row
 * still reports success, and this keeps "nothing to do" distinguishable.
 *
 * Used by the specs and by any caller doing a whole-object write. The live script
 * writes through `writeStepsForShop` + the `merge_shop_metadata` RPC instead, which
 * merges server-side and so cannot revert a concurrent change to an unrelated key.
 */
export function grantPatchForShop(
  shop: ShopForBackfill,
  decisions: readonly BackfillDecision[],
  grant: DomainGrant,
): Record<string, unknown> | null {
  const owed = decisions.filter((d) => d.shopId === shop.id && d.action === 'grant')
  if (owed.length === 0) return null
  const patch: Record<string, unknown> = { ...(shop.metadata ?? {}) }
  for (const decision of owed) patch[PAYWALL_GRANT_KEY[decision.sku]] = grant
  return patch
}

export type ShopWriteStep = {
  sku: PaywallSku
  /** The metadata key this step writes. */
  key: string
  /**
   * `merge_shop_metadata`'s guard, covering both cases with one concept.
   *
   * `expected: null`     — the value is ABSENT. Refuse if it appears concurrently;
   *                        that is what stops the backfill overwriting a grant
   *                        somebody else just made.
   * `expected: <value>`  — the value is PRESENT but malformed (`readGrant` refuses
   *                        it, so it entitles nobody). Compare-and-swap against the
   *                        exact value we read: repair it, or refuse if it changed.
   *                        A plain absence guard would reject the very row we came to
   *                        fix; an unguarded merge could overwrite a valid grant that
   *                        landed in between.
   */
  guard: { key: string; expected: unknown }
  /** `repair` means a malformed value is being replaced, not a missing one added. */
  kind: 'grant' | 'repair'
}

/**
 * One write step per owed SKU, in catalog order.
 *
 * Separate steps rather than one combined write: a single update guarded on every
 * owed key matches zero rows the moment ANY one of them is granted concurrently,
 * silently skipping the rest. Per-SKU steps fail independently.
 */
export function writeStepsForShop(
  shop: ShopForBackfill,
  decisions: readonly BackfillDecision[],
): ShopWriteStep[] {
  return decisions
    .filter((d) => d.shopId === shop.id && d.action === 'grant')
    .map((decision) => {
      const key = PAYWALL_GRANT_KEY[decision.sku]
      const raw = (shop.metadata ?? {})[key]
      const present = raw !== undefined && raw !== null
      return {
        sku: decision.sku,
        key,
        guard: { key, expected: present ? raw : null },
        kind: present ? ('repair' as const) : ('grant' as const),
      }
    })
}

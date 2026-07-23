/**
 * lib/merchant-commerce-facts.ts
 *
 * Founding merchant activation operations · Sprint 3, Story 3.1 — the Medusa
 * commerce-fact adapter. `loadCommerceFacts(relationship)` returns the
 * commerce-sourced subset of `lib/merchant-stage.ts`'s `StageFacts` (build
 * contract's table): `claimed`, `paymentsReady`, `threeProductsLive`,
 * `firstSale`, `retained30d`. `sharedExternally` and `firstInquiry` are
 * explicitly NOT this module's job — the contract table marks them "not
 * commerce, CRM-sourced" and no interaction `kind` in the S2 schema
 * (`note|call|whatsapp|visit|email|other`) represents either one yet. Until a
 * future sprint adds that signal, D3's "corrections are the only writes"
 * covers them: an admin records the milestone via
 * `POST /api/admin/relationship/[id]/correct-stage`. FLAGGED for the
 * architect, not silently resolved.
 *
 * REUSE, NOT REBUILD (build contract): the paged, fail-closed, timeout-budgeted
 * Medusa reads originated in `lib/merchant-lifecycle-sweep.ts` — six cross-
 * review rounds argued through paging correctness, fail-closed defaults and a
 * per-read timeout budget — and now live in `lib/merchant-medusa-reads.ts`
 * (extracted, unchanged, purely to break a circular import: this module needs
 * them, and the sweep now needs THIS module for its Story 3.1 relationship
 * evaluation, so the reads cannot live in either end of that cycle). This
 * module imports `countLiveProductsFromMedusa` and `listCapturedOrders` from
 * there rather than re-issuing the same fetches with subtly different
 * edge-case handling. The first-sale / retained-30-days ARITHMETIC is
 * `lib/merchant-lifecycle.ts#deriveSaleFacts` — the SAME function
 * `sweepMerchantLifecycle` itself calls, so there is only one implementation
 * of the rule to drift.
 *
 * FAIL-CLOSED, STATE-DERIVED (build contract): every fact here is read fresh,
 * from Medusa or the shop mirror's own columns — never inferred from a webhook
 * having fired. `ok: false` on the result means AT LEAST ONE read could not be
 * completed; the caller (the cron sweep) must treat that run as INCOMPLETE
 * (retryable 5xx), never report success while quietly missing a signal. An
 * unreachable Medusa reads as "unknown", never as "zero products" or
 * "unclaimed" — `facts` simply omits whatever could not be confirmed, and
 * `resolveStage` (fail-closed by its own construction) declines to grant
 * anything from an omitted fact.
 *
 * NO MUTATION (build contract: "no adapter writes to Medusa"). Every Medusa
 * call below is a GET; every Supabase call is a `.select()`. `e2e/merchant-
 * commerce-facts.spec.ts` asserts this module's own source text contains no
 * Supabase write verb and no non-GET fetch — the population-guard, not a
 * single call site, per Roadmap/LEARNINGS.md "guard the population, not the
 * door you found".
 *
 * Runtime: Node only (Supabase service-role client + `fetch` to Medusa).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import type { StageFacts } from '@/lib/merchant-stage'
import { computeShopCompletion, type ShopRow } from '@/lib/setup-guide'
import { deriveSaleFacts } from '@/lib/merchant-lifecycle'
import {
  THREE_PRODUCTS_THRESHOLD,
  RETENTION_WINDOW_DAYS,
  countLiveProductsFromMedusa,
  listCapturedOrders,
} from '@/lib/merchant-medusa-reads'

const RETENTION_WINDOW_MS = RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

export type CommerceStageFacts = Partial<
  Pick<StageFacts, 'claimed' | 'paymentsReady' | 'threeProductsLive' | 'firstSale' | 'retained30d'>
>

export interface CommerceFactsResult {
  facts: CommerceStageFacts
  /** False when ANY underlying read failed or was unreachable — the caller
   *  must treat the whole evaluation as incomplete (retryable), never report
   *  a clean run while a fact silently stayed unknown. */
  ok: boolean
}

interface ShopFactsRow extends ShopRow {
  id: string
  slug: string | null
  clerk_user_id: string | null
}

const SHOP_COLUMNS = 'id, slug, clerk_user_id, name, description, metadata, mp_enabled, custom_domain, ucp_webhook_url'

/**
 * The commerce-fact subset for ONE relationship. `shopId` may be null — every
 * relationship before `claimed` has no linked shop at all (README D1: the
 * relationship exists before the shop does), and that is a COMPLETE read of
 * "nothing to check yet", not a failure (`ok: true`, empty `facts`).
 */
export async function loadCommerceFacts(relationship: { shopId: string | null }): Promise<CommerceFactsResult> {
  if (!relationship.shopId) return { facts: {}, ok: true }

  const { data: shop, error: shopError } = await db
    .from('marketplace_shops')
    .select(SHOP_COLUMNS)
    .eq('id', relationship.shopId)
    .maybeSingle()

  // A read error OR a missing row for a `shop_id` the relationship itself
  // names is unexpected — fail closed rather than silently reading "not
  // claimed, no products, no sale" for a shop we simply couldn't read.
  if (shopError || !shop) return { facts: {}, ok: false }

  const row = shop as unknown as ShopFactsRow
  const facts: CommerceStageFacts = {
    claimed: !!row.clerk_user_id,
    paymentsReady: computeShopCompletion(row).pagos,
  }

  const sellerSlug = row.slug
  if (!sellerSlug) {
    // No Medusa seller slug on the mirror row — the three Medusa-derived facts
    // are unreachable. `claimed`/`paymentsReady` above are still returned
    // (they need only the mirror row), but the run as a whole is incomplete.
    return { facts, ok: false }
  }

  let ok = true

  const liveCount = await countLiveProductsFromMedusa(sellerSlug)
  if (liveCount === null) {
    ok = false
  } else {
    facts.threeProductsLive = liveCount >= THREE_PRODUCTS_THRESHOLD
  }

  const orders = await listCapturedOrders(sellerSlug)
  if (orders === null) {
    ok = false
  } else if (orders.length > 0) {
    const sale = deriveSaleFacts(orders, new Date(), RETENTION_WINDOW_MS)
    facts.firstSale = sale.firstSaleAt !== null
    facts.retained30d = sale.retainedAt !== null
  }

  return { facts, ok }
}

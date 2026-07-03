/**
 * lib/promoter-subdomain-grant-server.ts
 *
 * Promoter Funnel v2 · Sprint 3 (US-3.2) — the free-first-year subdomain grant.
 *
 * When an admin configures the subdomain's per-SKU promoter price at $0
 * (Sprint 3 · US-3.1 — `marketplace_promoter_sku_prices`), a promoter-attributed
 * subdomain activation mints the SAME dated one-time grant the paid Stripe
 * one-time path writes (`handleSubdomainOneTimeComplete` in the Stripe webhook,
 * epic 07 · subdomain-pricing S2) — but DIRECTLY, with no Stripe checkout, no
 * redirect round-trip, and no charge at all: `resolveSkuPromoterPriceCents`
 * already resolves to 0 cents, so there is nothing for Stripe to bill. Reuses the
 * exact grant shape (`buildOneTimeGrant` from lib/domain-entitlement.ts, the
 * subdomain-pricing seam every entitlement reader already derives from) and the
 * exact safety discipline the webhook uses: verify the shop exists AND the write
 * affected a row (a `.eq` matching 0 rows returns no error — the classic silent
 * 0-row write), alert on failure rather than silently reporting success.
 *
 * server-only (Supabase + Telegram). The route handler (`/api/promoter/close/subdomain`)
 * decides WHETHER to call this (only when the resolved promoter price is $0) vs.
 * falling through to the paid one-time Stripe checkout (`startSubdomainCheckout`).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { tg } from '@/lib/telegram'
import { buildOneTimeGrant } from '@/lib/domain-entitlement'
import { SUBDOMAIN_GRANT_KEY } from '@/lib/subdomain-entitlement'
import { markAttributionPaid } from '@/lib/promoter'
import { oneTimeGrantNote } from '@/lib/promoter-close'

export type GrantFreeSubdomainYearResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Mint the free first-year subdomain grant on a shop's metadata + record the
 * promoter attribution as paid at $0 (so the commission ledger sees a real,
 * zero-gross paid attribution — `decideAccrual` already refuses `no_gross` for a
 * $0 sale, so this correctly accrues NOTHING, never a phantom commission).
 * Idempotent: re-running for an already-granted shop just re-stamps the same
 * one-year term (mirrors the webhook's own idempotency — a retry is safe).
 */
export async function grantFreeSubdomainYear(input: {
  shopId: string
  promoterId: string
  sellerClerkId: string
}): Promise<GrantFreeSubdomainYearResult> {
  const { shopId, promoterId, sellerClerkId } = input

  try {
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('metadata')
      .eq('id', shopId)
      .maybeSingle()
    if (!shop) throw new Error(`no shop row for id ${shopId}`)
    const meta = (shop.metadata ?? {}) as Record<string, unknown>
    meta[SUBDOMAIN_GRANT_KEY] = buildOneTimeGrant({ note: oneTimeGrantNote(true) })
    delete meta.subdomain_lapsed
    const { data: updated, error } = await db
      .from('marketplace_shops')
      .update({ metadata: meta })
      .eq('id', shopId)
      .select('id')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0) throw new Error(`grant update matched 0 rows for id ${shopId}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[promoter subdomain free year] grant write failed:', message)
    tg.alert(
      `🚨 Subdominio gratis (promotor) NO activado — reparar a mano.\n` +
      `Shop: ${shopId}\nSeller: ${sellerClerkId}\nPromotor: ${promoterId}\nError: ${message}`,
    )
    return { ok: false, error: 'No se pudo activar el subdominio.' }
  }

  // Promoter attribution → paid at $0 gross. `decideAccrual` refuses `no_gross`
  // for a zero amount, so this NEVER accrues a phantom commission on a free year
  // (the acceptance bar: "the $0 subdomain year accrues no phantom commission").
  await markAttributionPaid({
    promoterId,
    sellerId: shopId,
    sku: 'subdomain',
    grossAmountCents: 0,
    cadence: 'one_time',
  })

  tg.alert(`✅ Subdominio gratis (primer año, promotor) activado\nShop: ${shopId}\nPromotor: ${promoterId}`)
  return { ok: true }
}

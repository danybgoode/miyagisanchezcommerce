/**
 * lib/flags.ts
 *
 * The platform's feature-flag / kill-switch layer, backed by an OWNED Supabase
 * table (`platform_flags`) — the in-house replacement for the old SaaS flag
 * provider (epic 09 · feature-flags-inhouse).
 * See the scope: Roadmap/09-platform-infra/feature-flags-inhouse/.
 *
 * Design rules (non-negotiable — carried over from the original kill-switch spike):
 *  1. FAIL-OPEN. Every read falls back to DEFAULT_FLAGS. Supabase being
 *     unreachable, slow, or the table empty/missing must NEVER break a request —
 *     especially checkout. Kill-switches default to ENABLED (feature stays on).
 *  2. SERVER-ONLY, environment-level. Admin-only: no per-identity traits, no
 *     per-shop segments — one boolean per flag, read for the whole environment.
 *  3. IN-PROCESS CACHE. All rows are cached module-side for 60 s (FLAG_CACHE_TTL_MS)
 *     so a fresh cache adds NO DB hit per request; a stale cache triggers ONE
 *     bounded refresh (≤2 s, no retries) shared across concurrent callers.
 *
 * Runtime: Node only (uses the Supabase service-role client). Call this from route
 * handlers / server components — and from middleware ONLY when the middleware
 * runs on the Node runtime (`export const config = { runtime: 'nodejs' }`), never
 * from Edge middleware. `middleware.ts` opts into the Node runtime specifically so
 * the subdomain paywall gate (epic 07 · subdomain-pricing) can read a flag here.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import {
  resolveFlag,
  isCacheStale,
  FLAG_CACHE_TTL_MS,
  FLAG_FETCH_TIMEOUT_MS,
  type FlagRow,
} from '@/lib/flags-cache'

/** The flags this app knows about. Add a key here + to DEFAULT_FLAGS to extend. */
export type FlagKey = 'checkout.stripe_enabled' | 'checkout.rental_pricing_enabled' | 'domain.paywall_enabled' | 'pdp_redesign' | 'events.quantity_enabled' | 'shipping.envia_enabled' | 'shipping.correos_enabled' | 'shipping.arranged_only_enabled' | 'promoter.enabled' | 'ml.connect_enabled' | 'ml.import_enabled' | 'ml.publish_enabled' | 'ml.sync_enabled' | 'ml.sync_paywall_enabled' | 'ml.orders_enabled' | 'subdomain.paywall_enabled' | 'seller_agent.connector_url_enabled' | 'promoter.transfer_enabled' | 'configurator.enabled' | 'ops.profit_enabled' | 'launchpad.enabled' | 'notifications.buyer_moneypath_enabled' | 'content.overrides_enabled' | 'catalog.inventory_channels_enabled' | 'catalog.bulk_enabled' | 'migrations.connector_enabled' | 'seller.shell_on_sell_enabled' | 'onboarding.three_doors_enabled' | 'growth.telemetry_enabled' | 'mcp.support_config.enabled' | 'mcp.checkout_config.enabled'

/**
 * Fail-open defaults. Returned whenever the flag store can't be consulted (creds
 * absent, network error, flag absent).
 *
 * Two polarities live here — both fail-open, but to opposite values:
 *  - KILL-SWITCH (`checkout.stripe_enabled`): default `true`. The feature keeps
 *    working if the flag service is down (disabling is the deliberate action).
 *  - ENABLEMENT (`domain.paywall_enabled`): default `false`. The gate stays OFF
 *    (today's free custom-domain behavior) if the flag store is unreachable — so a
 *    flag outage can never trap a seller behind a paywall. Enabling is the
 *    deliberate action (flip on in /admin/flags once the grandfather backfill ran).
 *  - KILL-SWITCH (`pdp_redesign`): default `true`. The "decide, then act" PDP
 *    redesign (epic 01) stays live if the flag store is down; flipping it OFF reverts
 *    the whole product page to the previous layout instantly (the deliberate act).
 *  - ENABLEMENT (`events.quantity_enabled`): default `false`. Buying >1 admission
 *    for one event in a single checkout (epic 10). Default OFF ⇒ quantity capped
 *    at 1 (today's behavior) — a flag outage can never let an unverified money/
 *    door path go live. Flip ON once Daniel's live buy-N → N-QR → door smoke passes.
 *  - ENABLEMENT (`shipping.envia_enabled`): default `false`. The Envia.com shipping
 *    integration (epic 04). Default OFF ⇒ arranged-delivery / manual-carrier fallback,
 *    so a flag outage can never push checkout/fulfillment at the unfunded platform
 *    Envía account. The BACKEND is the real enforcement (rates + label routes); this
 *    FE read only informs the seller-settings banner + the legacy FE ship/re-quote
 *    routes. Flip ON the instant the Envía account is funded.
 *  - ENABLEMENT (`promoter.enabled`): default `false`. The commission-paid promoter
 *    program (epic 08). Default OFF ⇒ the promoter code/discount-preview/attribution
 *    surfaces stay hidden, so a flag outage can never expose an unfinished money path.
 *    Flip ON once Sprint 1 is smoke-tested and the discount cadence (Sprint 2) lands.
 *  - ENABLEMENT (`ml.connect_enabled`): default `false`. The Mercado Libre connect
 *    surface + OAuth routes (epic 03 · mercadolibre-sync). Default OFF ⇒ the connect
 *    button/status page render nothing and the connect route is a no-op, so Sprint 1
 *    merges dark — nothing is reachable until Daniel flips it on. Enabling is the
 *    deliberate act (once the ML sandbox app + prod secrets are provisioned).
 *  - ENABLEMENT (`ml.import_enabled`): default `false`. The Mercado Libre catalog
 *    IMPORT surface + seller import routes (epic 03 · mercadolibre-sync Sprint 2).
 *    Default OFF ⇒ the import page 404s and the import routes are no-ops, so S2
 *    merges dark (independent of `ml.connect_enabled`). Flip ON once Daniel's live
 *    ML-sandbox import smoke passes.
 *  - ENABLEMENT (`ml.publish_enabled`): default `false`. The Mercado Libre PUBLISH
 *    surface + publish/predict routes (epic 03 · mercadolibre-sync Sprint 3). Default
 *    OFF ⇒ the "Publicar en Mercado Libre" island is hidden and the publish/predict
 *    routes 404, so S3 merges dark (independent of connect/import). Publish WRITES to
 *    the seller's external ML account (create/update/close), so it stays dark until
 *    Daniel's live ML-sandbox publish+edit+close smoke passes — then flip ON.
 *  - KILL-SWITCH, FAIL-CLOSED (`ml.sync_enabled`): default `false`. The two-way ML
 *    stock sync (epic 03 · mercadolibre-sync Sprint 4). A kill-switch by function
 *    (flip OFF to instantly halt all sync) but deliberately fail-CLOSED — unlike the
 *    usual kill-switch default-`true` — because the blast radius of sync running
 *    unsupervised (overselling on ML or in Miyagi) is worse than the feature being
 *    off. Enforcement lives in the BACKEND (subscriber + webhook + reconcile job);
 *    a per-seller enable must ALSO be on. This FE key exists only for parity / any
 *    future seller-facing sync UI. Flip ON once Daniel's live ML-sandbox sync smoke
 *    passes; flipping OFF is the instant rollback.
 *  - ENABLEMENT (`ml.sync_paywall_enabled`): default `false`. The paid/promoter-SKU
 *    ENTITLEMENT gate for ML sync (epic 03 · mercadolibre-sync Sprint 5). Distinct
 *    from `ml.sync_enabled` (the kill-switch that halts the sync ENGINE): this flag
 *    decides whether the seller-facing "enable ML sync" toggle is PAYWALLED. Default
 *    OFF ⇒ today's behavior — any connected seller may enable sync (already-enabled
 *    testers keep working); a flag outage can never trap a seller behind the paywall.
 *    Flip ON to start charging (grant/subscription required). Mirrors the
 *    `*.paywall_enabled` polarity of the domain/subdomain SKUs.
 *  - ENABLEMENT (`subdomain.paywall_enabled`): default `false`. The subdomain SKU
 *    paywall (epic 07 · subdomain-pricing). Default OFF ⇒ today's free-for-all —
 *    every `<slug>.miyagisanchez.com` serves white-label as it always has, so a
 *    flag outage can never trap a seller behind a paywall or break a live
 *    subdomain. Enabling is the deliberate act: flip ON only AFTER the grandfather
 *    backfill has stamped existing shops. Read in the Node-runtime middleware gate
 *    (US-1); flipping OFF is the instant rollback for the universal subdomain surface.
 *  - ENABLEMENT (`seller_agent.connector_url_enabled`): default `false`. The
 *    always-on personal MCP URL + "Agregar a Claude" one-click (epic 03 ·
 *    seller-agent-connect-mcp-url Sprint 2) — a NEW authentication path to
 *    seller-scoped MCP tools (`/api/ucp/mcp/c/<slug>`, `lib/agent-auth.ts`
 *    `ms_connector_…` credential). Default OFF ⇒ the URL route 404s and the panel
 *    shows only today's Bearer-token flow, so a flag outage can never expose an
 *    unverified auth path. Flip ON only after the auth `api` specs are green and
 *    Daniel's live claude.ai connector round-trip smoke passes.
 *  - ENABLEMENT (`promoter.transfer_enabled`): default `false`. Gates ONLY where a
 *    new transfer can be CREATED — the "Transferir a Miyagi" option at the
 *    promoter close (epic 08 · promoter-funnel-v2 Sprint 4). Default OFF ⇒ the
 *    close checkout only ever offers Stripe (today's behavior), so a flag outage
 *    can never expose an unverified cash-remittance money path. Deliberately
 *    does NOT gate `/admin/promoter`'s review of already-reported transfers
 *    (Clerk-admin-gated regardless) — a real cash transfer already collected
 *    must stay approvable/rejectable even if the flag is later flipped off to
 *    pause new closes; only the intake side is fail-safe. Flip ON only after
 *    the live transfer → approve → activation smoke passes.
 *  - ENABLEMENT (`ml.orders_enabled`): default `false` (epic ml-orders-native,
 *    Sprint 1). Materializing a paid ML sale as a real Medusa order. Real
 *    enforcement lives in the BACKEND (the webhook + reconcile job read the
 *    backend copy of this flag before creating an order); this FE key exists for
 *    parity / the eventual seller-facing "ML orders" surface. Default OFF ⇒
 *    today's behavior — ML sales still sync stock (epic mercadolibre-sync S4)
 *    but never appear as Miyagi orders — so a flag outage can never start
 *    creating orders unsupervised. Sprint 1 gates on this GLOBAL flag only; a
 *    per-seller enable is Sprint 2 · US-6. Flip ON only after Daniel's live
 *    ML-sandbox order-materialization smoke passes.
 *  - KILL-SWITCH (`configurator.enabled`): default `true`, matching
 *    `pdp_redesign`'s polarity exactly. Gates ONLY the Sprint 3 addition to
 *    the print-configurator buy box — custom fields (chiefly the artwork
 *    upload). Deliberately does NOT gate Sprint 2's underlying variant/tier
 *    selection + tier-correct checkout (`hasConfigurator` in
 *    `app/(shell)/l/[id]/page.tsx`), which stays live regardless: that path
 *    was already safely shipped, and the ONLY other checkout route for a
 *    genuinely multi-variant listing throws rather than resolving a correct
 *    price (`lib/cart.ts`), so routing a real configurator listing through
 *    it when the flag is off would trade a safe experience for a broken one.
 *    Flipping OFF reverts a configurator listing to Sprint 2's buy box with
 *    no artwork/custom fields (seller coordinates artwork out-of-band via
 *    messaging); a flag outage keeps the feature live rather than breaking
 *    an in-flight purchase.
 *  - ENABLEMENT (`ops.profit_enabled`): default `false` (epic profit-analyzer,
 *    Sprint 1). The seller profit/margins surface: `/shop/manage/profit` 404s
 *    while OFF, and the backend's ledger writes + profit read API are no-ops —
 *    the whole epic ships dark. The ledger is append-only and the backfill
 *    route heals any flag-off gap, so flipping ON later loses nothing. Flip ON
 *    once Daniel's COGS → sale → margin-row smoke passes.
 *  - ENABLEMENT (`checkout.rental_pricing_enabled`): default `false` (epic
 *    rental-backend-line-item-pricing, Sprint 1). Charges a rental booking as
 *    nights × rate + deposit at checkout. Real enforcement lives in the BACKEND
 *    start-checkout branch (already merged); this FE key exists so the flag is
 *    visible + toggleable in /admin/flags and for the Sprint 2 PDP/checkout wiring
 *    to read. Default OFF ⇒ today's coordination flow (PDP AskSeller; the backend
 *    422s a rental checkout). Flip ON once Sprints 2–3 are live and Daniel's
 *    flag-ON money smoke (Stripe + SPEI) passes.
 *  - KILL-SWITCH (`notifications.buyer_moneypath_enabled`): default `true` (epic
 *    buyer-notifications-money-path, Sprint 1). Gates the Medusa-order buyer-id
 *    resolution the seller-triggered dispatch routes (ship-manual, ship,
 *    return-request/[requestId]) now read off `normalizeMedusaOrder`'s
 *    `buyer_clerk_user_id`, plus (Sprint 2) the Compras dispatch on the payment
 *    webhooks. Flag OFF ⇒ those routes treat the buyer id as null — the exact
 *    guest fall-through (email-only) that ran before this epic. A flag outage
 *    keeps the new gating live (the deliberate act is disabling it), consistent
 *    with every other kill-switch here.
 *  - KILL-SWITCH (`content.overrides_enabled`): default `true` (epic
 *    admin-content-and-announcements, Sprint 1). Gates the runtime copy-override
 *    merge seam (`lib/copy-overrides.ts`) layered onto `getDictionary()`, plus the
 *    Sprint 3 announcement banners. Flag OFF ⇒ every surface renders pure
 *    compile-time `locales/*.json` copy and no banners — the deliberate rollback
 *    if an override or announcement ever needs pulling instantly. A flag outage
 *    keeps overrides live (matching every other kill-switch's fail-open posture).
 *  - ENABLEMENT (`catalog.inventory_channels_enabled`): default `false`
 *    (catalog-management epic, Sprint 2). Mirrors the backend key of the same
 *    name — gates the sin-límite/sobre-pedido inventory-mode selector UI, the
 *    buyer-facing backorder-unblocks-the-buy-box behavior on the PDP, the
 *    per-channel (Miyagi/ML) table toggles, and the ML price-override editor.
 *    Real enforcement lives in the BACKEND (the write routes + the `/store/
 *    listings` marketplace-browse filter reject/no-op when this reads false);
 *    this FE key hides the not-yet-safe UI so a flag outage can never let a
 *    seller pick a mode the buy box won't honor, or flip a channel toggle the
 *    backend will silently reject. Default OFF ⇒ today's exact behavior
 *    (tracked-only inventory, coupled ML publish state, no price override).
 *    Flip ON only after Daniel's live money-path smoke (buy a sin-límite + a
 *    sobre-pedido product end-to-end) and an ML toggle round-trip on a real
 *    ML test listing both pass. *  - KILL-SWITCH, FAIL-CLOSED (`catalog.bulk_enabled`): default `false`
 *    (catalog-management epic, Sprint 3). Mirrors the backend key of the same
 *    name — hides the row-selection checkboxes/bulk action bar/diff preview
 *    while OFF; real enforcement is on the BACKEND (`bulk-stage`/`bulk-apply`
 *    423 while OFF). Follows `ml.sync_enabled`'s fail-CLOSED shape (not the
 *    usual kill-switch default-`true`): a bulk action can mutate hundreds of
 *    products in one call, so a flag-read outage must not silently expose the
 *    UI for an unreviewed mass-mutation surface. Enabling is the deliberate
 *    action, done only after Daniel's live smoke.
 *  - ENABLEMENT (`shipping.correos_enabled`): default `false` (epic
 *    shipping-provider-expansion, Sprint 3). Mirrors the backend key of the
 *    same name — gates the Correos de México Impresos manual-economy rate at
 *    checkout, independent of `shipping.envia_enabled`/the Envía comp-grant
 *    (a different provider, no funding gate, no grant). Real enforcement lives
 *    in the BACKEND (`envia/rates` + `checkout-options` routes); this FE key
 *    is read only to decide whether the seller-settings opt-in toggle is
 *    offered at all (`platform_correos_enabled` passed into `Envios.tsx`).
 *    Default OFF ⇒ the toggle stays disabled and the option never appears, so
 *    a flag outage can never surface an unreviewed rate. Enabling is the
 *    deliberate action.
 *  - ENABLEMENT (`shipping.arranged_only_enabled`): default `false`
 *    (arranged-only-delivery epic, Sprint 1). Mirrors the backend key of the
 *    same name — real enforcement lives in the BACKEND (`checkout-options` +
 *    the product-write routes); this FE key gates whether the seller-facing
 *    "Entrega" toggle (carrier vs. arranged) appears at all in the listing
 *    create/edit form. Default OFF ⇒ the toggle stays hidden and every
 *    listing behaves as `carrier` (today), so a flag outage can never surface
 *    an unreviewed arranged-only publish path. Enabling is the deliberate
 *    action, done only after Daniel's live money-path smoke.
 *  - ENABLEMENT (`migrations.connector_enabled`): default `false` (epic
 *    platform-migrations, Sprint 1). Gates the Shopify-shop → staged
 *    supply-batch connector (the fetch/import seller routes + the
 *    `start_shopify_migration` MCP tool). Default OFF ⇒ the connector routes
 *    4xx cleanly and the "Migrar desde Shopify" entry point stays hidden, so
 *    a flag outage can never expose an unreviewed external-fetch surface.
 *    Flip ON only after Daniel's live real-Shopify-domain pull + parity
 *    report smoke passes (sprint-1.md).
 *  - KILL-SWITCH (`seller.shell_on_sell_enabled`): default `true`
 *    (catalog-management epic, Sprint 6 · Story 6.1). Gates the owner-aware
 *    branch that renders the seller shell (dark top bar + `SellerNav`) over
 *    `/sell` and `/sell/setup` for a signed-in shop owner, instead of buyer
 *    chrome. Default ON ⇒ today's target behavior; flipping OFF is the
 *    deliberate rollback to buyer chrome on those two routes, instantly, no
 *    redeploy — a flag-read outage keeps the new chrome live (matching every
 *    other kill-switch's fail-open posture). Does not affect `isSellerModePath`
 *    or `/shop/manage/*`, and a signed-out visitor never even reaches this
 *    read (the eligibility check fails on `currentUser()` first).
 *  - ENABLEMENT (`onboarding.three_doors_enabled`): default `false` (epic
 *    seller-portal-onboarding-three-doors, Sprint 1). Gates the redirect
 *    from `/sell`'s signed-in branch into the new S1 Bienvenida → S2 Tres
 *    puertas first-run for a merchant with no shop yet and no `tenant_intake`
 *    row. Default OFF ⇒ `/sell` keeps today's `SellWizard` entry unchanged —
 *    a flag-read outage can never strand a merchant on an unfinished flow.
 *    Flip ON only after the Sprint 1 smoke walkthrough passes.
 *  - ENABLEMENT (`growth.telemetry_enabled`): default `false` (golden-beans
 *    Roadmap/01-growth-engine/growth-engine-v1, Sprint 1 · Story 1.3). Gates
 *    `app/api/growth/track/route.ts` forwarding the setup-guide funnel
 *    (guide_view, guide_step_complete, first_share_tap) to the golden-beans
 *    Growth Engine's `POST /v1/track`. Default OFF ⇒ the route returns
 *    `{ skipped: true }` without ever calling `lib/growth-engine.ts` — a
 *    flag-read outage silences telemetry, never breaks a seller-facing
 *    surface (this is a standalone observability sink, not a money/auth
 *    path). Flip ON only once golden-beans is deployed and Daniel's live
 *    flag-flip + live-event smoke passes.
 *  - ENABLEMENT (`mcp.support_config.enabled`): default `false`
 *    (mcp-parity-core S4.1). Gates ONLY the `support` block of the MCP
 *    `patch_store_configuration` tool — enabling support via agent
 *    live-provisions a REAL purchasable Medusa product, not pure config.
 *    Default OFF ⇒ a patch carrying `support` is refused whole; the portal
 *    support settings are untouched either way. Flip ON only after Daniel's
 *    live smoke (enable via tool, confirm the provisioned product appears
 *    and is purchasable).
 *  - ENABLEMENT (`mcp.checkout_config.enabled`): default `false`
 *    (mcp-parity-core S4.2). Gates ONLY the `checkout` block of the MCP
 *    `patch_store_configuration` tool (escrow_mode/whatsapp_cta/show_phone/
 *    cash_pickup.enabled — bank_transfer and contact_email are never agent-
 *    settable regardless). Default OFF ⇒ a patch carrying `checkout` is
 *    refused whole; the portal checkout settings are untouched either way.
 *    Flip ON only after Daniel's live smoke (flip escrow_mode via tool,
 *    confirm a real test checkout changes).
 */
const DEFAULT_FLAGS: Record<FlagKey, boolean> = {
  'checkout.stripe_enabled': true,
  'checkout.rental_pricing_enabled': false,
  'domain.paywall_enabled': false,
  'pdp_redesign': true,
  'events.quantity_enabled': false,
  'shipping.envia_enabled': false,
  'shipping.correos_enabled': false,
  'shipping.arranged_only_enabled': false,
  'promoter.enabled': false,
  'ml.connect_enabled': false,
  'ml.import_enabled': false,
  'ml.publish_enabled': false,
  'ml.sync_enabled': false,
  'ml.sync_paywall_enabled': false,
  'ml.orders_enabled': false,
  'subdomain.paywall_enabled': false,
  'seller_agent.connector_url_enabled': false,
  'promoter.transfer_enabled': false,
  'configurator.enabled': true,
  'ops.profit_enabled': false,
  'launchpad.enabled': false,
  'notifications.buyer_moneypath_enabled': true,
  'content.overrides_enabled': true,
  'catalog.inventory_channels_enabled': false,
  'catalog.bulk_enabled': false,
  'migrations.connector_enabled': false,
  'seller.shell_on_sell_enabled': true,
  'onboarding.three_doors_enabled': false,
  'growth.telemetry_enabled': false,
  'mcp.support_config.enabled': false,
  'mcp.checkout_config.enabled': false,
}

const TABLE = 'platform_flags'

// Module-level in-process cache. Single-threaded module evaluation → no init race.
// `rows: null` means "no trusted values" → resolveFlag() falls open to DEFAULT_FLAGS.
// `fetchedAt` gates staleness (60 s TTL); `inflight` de-dupes concurrent refreshes so
// a burst of first requests on a cold instance issues ONE read, not N.
let cache: { rows: FlagRow[] | null; fetchedAt: number | null } = { rows: null, fetchedAt: null }
let inflight: Promise<void> | null = null

/**
 * Read every flag row from Supabase, bounded to ~2 s (no retries) so a hung read
 * can't stall a request. Returns null on timeout / error (an EMPTY table returns []
 * → resolveFlag then falls open per-flag) — either way the caller fails open. Uses
 * Promise.race (not .abortSignal) so the missing-config stub — which has no
 * abortSignal — is handled uniformly. Note: Promise.race bounds CALLER latency, not
 * the underlying request; a hung read is abandoned (GC'd when it settles), and the
 * 60 s inflight de-dup caps abandoned reads to ~1/min.
 */
async function fetchRows(): Promise<FlagRow[] | null> {
  try {
    const query = db.from(TABLE).select('key, enabled')
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('platform_flags fetch timeout')), FLAG_FETCH_TIMEOUT_MS),
    )
    const { data, error } = (await Promise.race([query, timeout])) as {
      data: Array<{ key: unknown; enabled: unknown }> | null
      error: unknown
    }
    if (error || !data) return null
    // Preserve the raw `enabled` — do NOT Boolean()-coerce. resolveFlag's
    // `typeof === 'boolean'` guard is the SINGLE validation point, so a malformed row
    // (e.g. the string 'false', which Boolean() would flip to true) fails OPEN to
    // DEFAULT_FLAGS instead of coercing to a wrong definite state. `enabled` is
    // `boolean NOT NULL` in Postgres, so this is defense-in-depth, not an expected path.
    return data.map((r) => ({ key: String(r.key), enabled: r.enabled as boolean }))
  } catch {
    return null
  }
}

/**
 * Refresh the cache if stale. Never throws. On a successful read the rows + timestamp
 * are replaced; on failure the rows are cleared to null (fail open to DEFAULT_FLAGS)
 * and the timestamp is still bumped so an outage doesn't hammer the DB every request.
 */
async function refreshIfStale(): Promise<void> {
  if (!isCacheStale(cache.fetchedAt, Date.now(), FLAG_CACHE_TTL_MS)) return
  if (inflight) return inflight
  inflight = fetchRows()
    .then((rows) => {
      cache = { rows, fetchedAt: Date.now() }
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * Is a feature enabled? Never throws — returns the fail-open DEFAULT_FLAGS value on
 * any error, timeout, or when the table is unreadable/empty. A fresh cache resolves
 * with no DB hit; a stale cache awaits one bounded (≤2 s) refresh first.
 */
export async function isEnabled(flag: FlagKey): Promise<boolean> {
  try {
    await refreshIfStale()
  } catch {
    // Defensive: refreshIfStale already swallows errors, but never let a flag read throw.
  }
  return resolveFlag(cache.rows, flag, DEFAULT_FLAGS)
}

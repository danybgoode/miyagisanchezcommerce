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
import {
  DEFAULT_FLAGS,
  FLAG_KEYS,
  type FlagKey,
} from '@/lib/flag-catalog'
import {
  parseFlagCutover,
  resolveFlagAuthority,
  summarizeFlagCutover,
  type FlagCutoverStatus,
} from '@/lib/flag-cutover'
import { evaluateGoldenBooleanFlag } from '@/lib/golden-flag-provider'
import { evaluateDurableGoldenBooleanFlag } from '@/lib/golden-flag-mirror'
import { getDurableGoldenSnapshot } from '@/lib/golden-flag-mirror-store'
import { createFlagShadowObserver } from '@/lib/flag-shadow-observation'
import { createFlagProviderEvaluator } from '@/lib/flag-provider-evaluator'
import { createFlagAuthorityObserver } from '@/lib/flag-authority-observation'

export type { FlagKey } from '@/lib/flag-catalog'

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
 *  - ENABLEMENT (`mcp.configure_options.enabled`): default `false`
 *    (mcp-parity-core S2). Gates ONLY the MCP `configure_listing_options`
 *    tool — an agent building a CPP-configurable product (priced option
 *    dimensions, per-combo prices, quantity tiers) through the same backend
 *    write path as the portal "Opciones" screen. Default OFF ⇒ the tool
 *    refuses with "no disponible"; the portal Opciones editor is untouched
 *    either way (it has its own `configurator.enabled` kill-switch). Flip ON
 *    only after Daniel's live smoke (build a real CPP product via the tool,
 *    confirm the PDP grid + checkout price).
 *  - ENABLEMENT (`mcp.delete_listing.enabled`): default `false`
 *    (mcp-parity-core S3.1). Gates ONLY the MCP `delete_listing` tool — an
 *    agent soft-deleting one of its shop's listings through the same native
 *    Medusa soft-delete the portal uses. Default OFF ⇒ the tool refuses with
 *    "no disponible"; the portal delete is untouched. Flip ON only after
 *    Daniel's live smoke (delete a clean test listing; confirm an order-linked
 *    one soft-deletes with order history intact).
 *  - ENABLEMENT (`mcp.apply_price.enabled`): default `false`
 *    (mcp-parity-core S3.2). Gates ONLY the MCP `apply_price` tool — an agent
 *    applying a computed price to a live variant through the same pipeline as
 *    the Profit Analyzer's one-click Apply (Miyagi write + conditional ML push
 *    + activity log). Default OFF ⇒ the tool refuses; the portal Apply is
 *    untouched (its own ops.profit_enabled gate). Flip ON only after Daniel's
 *    live smoke (apply a price, confirm it in a real cart).
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
 *  - ENABLEMENT (`partners.mcp_enabled`): default `false` (miyagi-partners-mcp
 *    S1.1). Gates every ms_partner_ credential code path — resolver, /p/<slug>
 *    connector route, and (S2) the /partner dashboard + auto-grant. Default
 *    OFF ⇒ a partner token resolves as unknown-credential (401), byte-
 *    identical to a garbage token, so the whole epic merges dark. Flip ON
 *    only in a controlled window after Daniel's Sprint-1 smoke walkthrough.
 *  - ENABLEMENT (`promoter.private_preview_enabled`): default `false`
 *    (founding-merchant-consent-previews S1.1). Gates the promoter
 *    setup/listing orchestration seam: ON ⇒ a promoter-created listing is
 *    created as a native Medusa `status:'draft'` product (structurally
 *    excluded from every public /store/* read — search, PDP, seller products,
 *    sitemap, agent, embed) and a revocable opaque preview link is minted;
 *    OFF ⇒ today's force-publish behavior at
 *    `app/api/promoter/close/listing/route.ts` (the deliberate rollback path).
 *    Default OFF ⇒ a flag-read outage can never silently switch the promoter
 *    close between publish and draft. Enforcement of consent BEFORE public
 *    activation lives in Sprint 2 (versioned approval + idempotent activate);
 *    this S1 key only decides create-private-vs-publish. Flip ON only after a
 *    disposable shop passes the full cross-channel privacy sweep
 *    (sprint-1.md walkthrough).
 *  - ENABLEMENT (`promoter.activation_crm_enabled`): default `false`
 *    (founding-merchant-activation-ops S1.1). Gates the new merchant
 *    relationship intake step in `/promotor/cerrar` AND every
 *    `/api/promoter/relationship*` route. Default OFF ⇒ those routes 404
 *    (indistinguishable from absent, matching `partners.mcp_enabled`'s
 *    posture) and `PromoterCloseClient` renders byte-identical to today — a
 *    flag-read outage can never expose an unreviewed write path or strand a
 *    promoter mid-capture. The additive migration (tables + backfill) stays
 *    forward-compatible regardless of this flag. Flip ON only after the
 *    role-scope specs are green, the migration is verified live, and one
 *    disposable merchant completes the Sprint 1 smoke walkthrough.
 *  - ENABLEMENT (`growth.founding_merchants_enabled`): default `false`
 *    (tiendas-fundadoras-acquisition epic, Story 1.3). Gates the PUBLIC
 *    Tiendas Fundadoras campaign: OFF ⇒ `/vende/fundadoras` renders a
 *    truthful closed state (no application form) and `POST
 *    /api/vende/fundadoras/apply` refuses every write (404) even if called
 *    directly — a flag-read outage can never let an unreviewed public write
 *    path go live. Capacity (25 founding merchants, read from canonical
 *    `merchant_relationships` rows) is enforced independently of this flag —
 *    ON does not bypass a full cohort. Flip ON only after a disposable
 *    end-to-end application → admin-notify smoke passes in production.
 *  - ENABLEMENT (`promoter.partner_portfolio_enabled`): default `false`
 *    (merchant-partner-lifecycle epic, Story 1.1). Gates the Merchant Partner
 *    stewardship portfolio: the new `/partner` portfolio SECTION (today's grant
 *    list renders byte-identical while OFF — that is the whole promise of this
 *    kill-switch), `GET /api/partner/portfolio`, `GET/PUT /api/admin/sla-policy`
 *    and `POST /api/admin/relationship/[id]/reassign`, all of which 404 while
 *    OFF (indistinguishable from absent, matching
 *    `promoter.activation_crm_enabled`'s posture). Deliberately does NOT gate
 *    the SHIPPED promoter-facing `POST /api/promoter/relationship/[id]/owner`
 *    route — that keeps its own `promoter.activation_crm_enabled` gate and its
 *    exact shipped behavior (activation-ops S2.2), so this epic can never
 *    dark-launch its way into breaking a live surface. The additive migration
 *    (5 nullable columns, the single-row SLA policy table, 3 nullable
 *    owner-history columns) stays forward-compatible regardless of this flag.
 *    Flip ON only after the two-partner scope + reassignment-attribution
 *    smokes pass.
 *  - ENABLEMENT (`catalog.owned_shop_only_enabled`): default `false`
 *    (owned-shop-operating-channel epic, decision D8). Mirrors the backend key of
 *    the same name — a key registered in one repo only is a half-flag. Gates the
 *    two CODE paths that epic adds, and deliberately NOT the channel memberships,
 *    the backfill or the publishable-key move: those are DATA, and their rollback
 *    is a link operation (D9), not a flag. Flag OFF ⇒ `lib/cart.ts`'s checkout
 *    admission runs today's marketplace-publication proof, byte-for-byte; flag ON
 *    ⇒ admission asks the operating-channel seam whether the product is BUYABLE,
 *    which is what lets a shop sell something it never listed in the country
 *    marketplace. This gates an authorization boundary on the money path, so the
 *    fail-open default is the CLOSED one — a flag-read outage can never widen
 *    admission. Flip ON last, after the S2 smoke; it is the epic's true go-live. */
const TABLE = 'platform_flags'

// Module-level in-process cache. Single-threaded module evaluation → no init race.
// `rows: null` means "no trusted values" → resolveFlag() falls open to DEFAULT_FLAGS.
// `fetchedAt` gates staleness (60 s TTL); `inflight` de-dupes concurrent refreshes so
// a burst of first requests on a cold instance issues ONE read, not N.
let cache: { rows: FlagRow[] | null; fetchedAt: number | null } = { rows: null, fetchedAt: null }
let inflight: Promise<void> | null = null

function writeControlPlaneRecord(prefix: string, value: unknown): void {
  try {
    const line = `[golden-beans:${prefix}] ${JSON.stringify(value)}`
    if (typeof process !== 'undefined' && typeof process.stdout?.write === 'function') {
      process.stdout.write(`${line}\n`)
      return
    }
    console.info(line)
  } catch {
    // Cutover evidence must never affect a feature decision.
  }
}

let cutoverCache:
  | {
      rawManifest: string | undefined
      legacyMode: string | undefined
      status: FlagCutoverStatus<FlagKey>
    }
  | undefined
let lastCutoverReport: string | undefined

/** Current typed cutover state. Raw env content is never included in the report. */
export function getFlagCutoverStatus(): FlagCutoverStatus<FlagKey> {
  const rawManifest = process.env.GOLDEN_BEANS_FLAG_CUTOVER
  const legacyMode = process.env.GOLDEN_BEANS_FLAG_PROVIDER_MODE
  if (
    !cutoverCache ||
    cutoverCache.rawManifest !== rawManifest ||
    cutoverCache.legacyMode !== legacyMode
  ) {
    cutoverCache = {
      rawManifest,
      legacyMode,
      status: parseFlagCutover(rawManifest, FLAG_KEYS, legacyMode),
    }
    const status = cutoverCache.status
    const reportValue = {
      source: status.source,
      valid: status.valid,
      all: status.all,
      invalidReason: status.invalidReason,
      overrides: Object.entries(status.overrides)
        .map(([key, authority]) => ({ key, authority }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      counts: summarizeFlagCutover(status, FLAG_KEYS),
    }
    const report = JSON.stringify(reportValue)
    if (lastCutoverReport !== report) {
      lastCutoverReport = report
      writeControlPlaneRecord('flag-cutover', reportValue)
    }
  }
  return cutoverCache.status
}

// Shadow records are intentionally control-plane-only and bounded to one per
// flag/snapshot in each process. They are the parity evidence during migration,
// not request telemetry; no subject or request data can enter this record.
const recordShadowObservation = createFlagShadowObserver((observation) => {
  // Sentry's production build removes console-level debug logging. Write the
  // deliberately PII-free control-plane record directly so Cloud Run keeps it.
  writeControlPlaneRecord('flag-shadow', observation)
})

const recordAuthorityObservation = createFlagAuthorityObserver<FlagKey>((observation) => {
  writeControlPlaneRecord('flag-authority', observation)
})

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
const evaluateEnabledFlag = createFlagProviderEvaluator<FlagKey>({
  async readLocal(flag) {
    try {
      await refreshIfStale()
    } catch {
      // Defensive: refreshIfStale already swallows errors, but a flag read never throws.
    }
    return resolveFlag(cache.rows, flag, DEFAULT_FLAGS)
  },
  getMode: (flag) => resolveFlagAuthority(getFlagCutoverStatus(), flag),
  evaluateGolden: evaluateGoldenBooleanFlag,
  async readDurableGolden(flag, localValue) {
    // Golden mode's only outage fallback is the monotonic, read-only snapshot
    // mirror. `platform_flags` stays authoritative exclusively in local/shadow.
    const durableSnapshot = await getDurableGoldenSnapshot()
    return durableSnapshot
      ? evaluateDurableGoldenBooleanFlag(durableSnapshot, flag, localValue)
      : undefined
  },
  observeShadow: recordShadowObservation,
  getDefault: (flag) => DEFAULT_FLAGS[flag],
  reportAuthority: recordAuthorityObservation,
})

export async function isEnabled(flag: FlagKey): Promise<boolean> {
  return evaluateEnabledFlag(flag)
}

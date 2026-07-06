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
export type FlagKey = 'checkout.stripe_enabled' | 'domain.paywall_enabled' | 'pdp_redesign' | 'events.quantity_enabled' | 'shipping.envia_enabled' | 'promoter.enabled' | 'ml.connect_enabled' | 'ml.import_enabled' | 'ml.publish_enabled' | 'ml.sync_enabled' | 'ml.sync_paywall_enabled' | 'ml.orders_enabled' | 'subdomain.paywall_enabled' | 'seller_agent.connector_url_enabled' | 'promoter.transfer_enabled' | 'ops.profit_enabled'

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
 *  - ENABLEMENT (`ops.profit_enabled`): default `false` (epic profit-analyzer,
 *    Sprint 1). The seller profit/margins surface: `/shop/manage/profit` 404s
 *    while OFF, and the backend's ledger writes + profit read API are no-ops —
 *    the whole epic ships dark. The ledger is append-only and the backfill
 *    route heals any flag-off gap, so flipping ON later loses nothing. Flip ON
 *    once Daniel's COGS → sale → margin-row smoke passes.
 */
const DEFAULT_FLAGS: Record<FlagKey, boolean> = {
  'checkout.stripe_enabled': true,
  'domain.paywall_enabled': false,
  'pdp_redesign': true,
  'events.quantity_enabled': false,
  'shipping.envia_enabled': false,
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
  'ops.profit_enabled': false,
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

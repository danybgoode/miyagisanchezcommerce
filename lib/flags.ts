/**
 * lib/flags.ts
 *
 * The platform's feature-flag / kill-switch layer, backed by Flagsmith
 * (SaaS, project "miyagisanchezmarketplace"). See the spike decision:
 * Roadmap/00-ideas/2. readyforscope/spikeflagsmith.md.
 *
 * Design rules (non-negotiable — from the spike):
 *  1. FAIL-OPEN. Every read falls back to DEFAULT_FLAGS. Flagsmith being
 *     unreachable, slow, or missing the flag must NEVER break a request —
 *     especially checkout. Kill-switches default to ENABLED (feature stays on).
 *  2. SERVER-ONLY, environment-level. v1 is admin-only: no per-identity traits,
 *     no per-shop segments. We evaluate the environment's flags, in-process.
 *  3. LOCAL EVALUATION. The SDK fetches the environment document and evaluates
 *     in-memory (~0 ms per request, refreshed every 60 s) — so flag reads add no
 *     latency to the request path and request volume != Flagsmith API volume.
 *
 * Runtime: Node only (the SDK is not Edge-compatible). Call this from route
 * handlers / server components — and from middleware ONLY when the middleware
 * runs on the Node runtime (`export const config = { runtime: 'nodejs' }`), never
 * from Edge middleware. `middleware.ts` opts into the Node runtime specifically so
 * the subdomain paywall gate (epic 07 · subdomain-pricing) can read a flag here.
 */
import 'server-only'
import { Flagsmith, DefaultFlag } from 'flagsmith-nodejs'

/** The flags this app knows about. Add a key here + to DEFAULT_FLAGS to extend. */
export type FlagKey = 'checkout.stripe_enabled' | 'domain.paywall_enabled' | 'pdp_redesign' | 'events.quantity_enabled' | 'shipping.envia_enabled' | 'promoter.enabled' | 'ml.connect_enabled' | 'ml.import_enabled' | 'ml.publish_enabled' | 'subdomain.paywall_enabled'

/**
 * Fail-open defaults. Returned whenever Flagsmith can't be consulted (no key,
 * network error, flag absent).
 *
 * Two polarities live here — both fail-open, but to opposite values:
 *  - KILL-SWITCH (`checkout.stripe_enabled`): default `true`. The feature keeps
 *    working if the flag service is down (disabling is the deliberate action).
 *  - ENABLEMENT (`domain.paywall_enabled`): default `false`. The gate stays OFF
 *    (today's free custom-domain behavior) if Flagsmith is unreachable — so a
 *    flag outage can never trap a seller behind a paywall. Enabling is the
 *    deliberate action (flip on in Flagsmith once the grandfather backfill ran).
 *  - KILL-SWITCH (`pdp_redesign`): default `true`. The "decide, then act" PDP
 *    redesign (epic 01) stays live if Flagsmith is down; flipping it OFF reverts
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
 *  - ENABLEMENT (`subdomain.paywall_enabled`): default `false`. The subdomain SKU
 *    paywall (epic 07 · subdomain-pricing). Default OFF ⇒ today's free-for-all —
 *    every `<slug>.miyagisanchez.com` serves white-label as it always has, so a
 *    flag outage can never trap a seller behind a paywall or break a live
 *    subdomain. Enabling is the deliberate act: flip ON only AFTER the grandfather
 *    backfill has stamped existing shops. Read in the Node-runtime middleware gate
 *    (US-1); flipping OFF is the instant rollback for the universal subdomain surface.
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
  'subdomain.paywall_enabled': false,
}

const ENV_KEY = process.env.FLAGSMITH_ENVIRONMENT_KEY

// Constructed once at module load. Module evaluation is single-threaded, so this
// sidesteps the check-then-set race a lazy getter would have — where concurrent
// first requests on a cold instance each build a client and leak its 60 s polling
// timer. `null` when no server-side key is configured (local dev / preview
// without the secret) → isEnabled() simply runs on DEFAULT_FLAGS.
const client: Flagsmith | null = ENV_KEY
  ? new Flagsmith({
      environmentKey: ENV_KEY,
      enableLocalEvaluation: true,
      // Refresh the Environment Document every 5 min, not the SDK default 60 s. Each
      // refresh is one Flagsmith API call; every warm server instance polls on this
      // timer regardless of traffic, so 60 s blew the free tier with zero users
      // (~43k calls/mo vs ~8.6k at 300 s). These flags are deliberate kill-switches —
      // a ~5 min flip-propagation delay is fine.
      environmentRefreshIntervalSeconds: 300,
      // Fail FAST on the checkout path: if Flagsmith hangs, give up after ~2 s and
      // fall back to defaults rather than blocking the request. The SDK default is
      // 3 retries × 10 s timeout (+ 1 s delays) ≈ 33 s — unacceptable on checkout.
      requestTimeoutSeconds: 2,
      retries: 0,
      // Per-flag fail-open inside the SDK, in case a flag is missing from the env.
      defaultFlagHandler: (flagKey: string) =>
        new DefaultFlag(null, DEFAULT_FLAGS[flagKey as FlagKey] ?? true),
    })
  : null

/**
 * Is a feature enabled? Never throws — returns the fail-open default on any
 * error or when Flagsmith isn't configured.
 */
export async function isEnabled(flag: FlagKey): Promise<boolean> {
  const fallback = DEFAULT_FLAGS[flag]
  if (!client) return fallback
  try {
    const flags = await client.getEnvironmentFlags()
    return flags.isFeatureEnabled(flag)
  } catch {
    // Flagsmith unreachable / timed out / malformed → fail open.
    return fallback
  }
}

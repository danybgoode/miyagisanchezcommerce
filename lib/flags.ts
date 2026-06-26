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
 * handlers / server components, NOT from middleware (Edge).
 */
import 'server-only'
import { Flagsmith, DefaultFlag } from 'flagsmith-nodejs'

/** The flags this app knows about. Add a key here + to DEFAULT_FLAGS to extend. */
export type FlagKey = 'checkout.stripe_enabled' | 'domain.paywall_enabled' | 'pdp_redesign' | 'events.quantity_enabled' | 'shipping.envia_enabled'

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
 */
const DEFAULT_FLAGS: Record<FlagKey, boolean> = {
  'checkout.stripe_enabled': true,
  'domain.paywall_enabled': false,
  'pdp_redesign': true,
  'events.quantity_enabled': false,
  'shipping.envia_enabled': false,
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
      environmentRefreshIntervalSeconds: 60,
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

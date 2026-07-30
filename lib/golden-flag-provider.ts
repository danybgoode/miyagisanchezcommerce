/**
 * Server-only bridge to Golden Beans' snapshot-backed flag provider.
 *
 * `flag_read` is a distinct, revocable credential: never reuse the telemetry
 * ingest key here and never expose either key to a browser bundle. Construction
 * and refresh are intentionally non-blocking; callers keep their local result
 * whenever a snapshot is unavailable or stale.
 */
import 'server-only'
import {
  createFlagProvider,
  type FlagProvider,
  type FlagResolutionReason,
} from '@golden-beans/sdk'
import { parseGoldenFlagEnvironment } from '@/lib/flag-provider-mode'
import { createFlagProviderRequestRefreshGate } from '@/lib/flag-provider-request-refresh'
import { scheduleDurableGoldenSnapshot } from '@/lib/golden-flag-mirror-store'
import { trackGoldenFlagEvaluation } from '@/lib/growth-engine'

export type GoldenBooleanEvaluation = {
  value: boolean
  snapshotVersion: number
  flagVersion?: number
  variant?: string
  reason: FlagResolutionReason
}

let provider: FlagProvider | undefined
let started = false
const requestRefreshGate = createFlagProviderRequestRefreshGate()
let configuration:
  | {
      baseUrl: string
      flagReadKey: string
      environment: string
    }
  | undefined

function getProvider(): FlagProvider | undefined {
  // Read configuration lazily. This keeps the adapter safe for runtimes that
  // load env after module evaluation and for isolated test setup.
  const baseUrl = process.env.GROWTH_ENGINE_URL?.replace(/\/+$/, '')
  const flagReadKey = process.env.GOLDEN_BEANS_FLAG_READ_KEY
  const environment = parseGoldenFlagEnvironment(
    process.env.GOLDEN_BEANS_FLAG_ENVIRONMENT,
  )
  if (!baseUrl || !flagReadKey || !environment) {
    // Runtime configuration is normally immutable, but releasing the timer
    // makes a removed credential fail closed even in an unusual dynamic setup.
    try {
      provider?.shutdown()
    } catch {
      // A flag check must never fail because cleanup did.
    }
    provider = undefined
    started = false
    requestRefreshGate.reset()
    configuration = undefined
    return undefined
  }

  if (
    provider &&
    (configuration?.baseUrl !== baseUrl ||
      configuration.flagReadKey !== flagReadKey ||
      configuration.environment !== environment)
  ) {
    try {
      provider.shutdown()
    } catch {
      // Replacing a rotated credential must not affect a flag decision.
    }
    provider = undefined
    started = false
    requestRefreshGate.reset()
  }

  if (!provider) {
    provider = createFlagProvider({
      baseUrl,
      flagReadKey,
      environment,
      refreshIntervalMs: 60_000,
      maxStaleMs: 300_000,
      refreshTimeoutMs: 2_000,
    })
    configuration = { baseUrl, flagReadKey, environment }
  }

  if (!started) {
    started = true
    requestRefreshGate.markAttempt()
    // A snapshot is an optimisation only. Never make a request wait for it and
    // never allow an unexpected transport failure to become an unhandled reject.
    // SDK initialize arms its own bounded periodic refresh before attempting
    // the first fetch, so a failed cold fetch recovers on that timer. Keeping
    // `started` true prevents every request from creating a retry storm.
    void provider.initialize().catch(() => undefined)
  } else if (requestRefreshGate.takeIfDue()) {
    // Cloud Run can throttle the SDK's periodic timer between requests. Kick
    // the same deduplicated refresh from live traffic, but never await it: this
    // request keeps resolving synchronously from the accepted snapshot/LKG.
    void provider.refresh().catch(() => undefined)
  }

  return provider
}

/**
 * Resolve from the most recent Golden Beans snapshot, if one is safe to use.
 * The SDK returns the supplied default while not ready/stale, so callers can
 * preserve their existing local decision without a second failure mode.
 */
export function evaluateGoldenBooleanFlag(
  flagKey: string,
  defaultValue: boolean,
): GoldenBooleanEvaluation | undefined {
  try {
    const currentProvider = getProvider()
    if (!currentProvider) return undefined

    const snapshot = currentProvider.getSnapshot()
    if (!snapshot) return undefined
    scheduleDurableGoldenSnapshot(snapshot)

    const details = currentProvider.resolveBooleanEvaluation(
      flagKey,
      defaultValue,
    )
    if (details.flagVersion !== undefined && details.variant) {
      void trackGoldenFlagEvaluation({
        flagKey,
        flagVersion: details.flagVersion,
        variant: details.variant,
        reason: details.reason,
        snapshotVersion: snapshot.snapshotVersion,
        environment: snapshot.environment,
      })
    }
    return {
      value: details.value,
      snapshotVersion: snapshot.snapshotVersion,
      flagVersion: details.flagVersion,
      variant: details.variant,
      reason: details.reason,
    }
  } catch {
    // The caller keeps its local result on every unexpected provider failure.
    return undefined
  }
}

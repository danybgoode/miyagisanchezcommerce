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
} from '@golden-frijoles/sdk'
import {
  parseGoldenFlagEnvironment,
  type GoldenFlagEnvironment,
} from '@/lib/flag-provider-mode'
import { createFlagProviderRequestRefreshGate } from '@/lib/flag-provider-request-refresh'
import { scheduleDurableGoldenSnapshot } from '@/lib/golden-flag-mirror-store'
import { trackGoldenFlagEvaluation } from '@/lib/growth-engine'
import {
  routeGoldenFlagReadKey,
  type GoldenFlagReadKeyRoute,
} from '@/lib/golden-flag-read-key-routing'

export type GoldenBooleanEvaluation = {
  value: boolean
  snapshotVersion: number
  flagVersion?: number
  variant?: string
  reason: FlagResolutionReason
}

type ProviderState = {
  provider: FlagProvider | undefined
  started: boolean
  initialization: Promise<void> | undefined
  requestRefreshGate: ReturnType<typeof createFlagProviderRequestRefreshGate>
  configuration:
    | {
        baseUrl: string
        flagReadKey: string
        environment: string
      }
    | undefined
}

function createProviderState(): ProviderState {
  return {
    provider: undefined,
    started: false,
    initialization: undefined,
    requestRefreshGate: createFlagProviderRequestRefreshGate(),
    configuration: undefined,
  }
}

const primaryProviderState = createProviderState()
const partnersRecruitingProviderState = createProviderState()

function resetProviderState(state: ProviderState): void {
  try {
    state.provider?.shutdown()
  } catch {
    // A flag check must never fail because cleanup did.
  }
  state.provider = undefined
  state.started = false
  state.initialization = undefined
  state.requestRefreshGate.reset()
  state.configuration = undefined
}

function configuredProvider(
  state: ProviderState,
  configuration: {
    baseUrl: string
    flagReadKey: string
    environment: GoldenFlagEnvironment
  },
): FlagProvider {
  if (
    state.provider &&
    (state.configuration?.baseUrl !== configuration.baseUrl ||
      state.configuration.flagReadKey !== configuration.flagReadKey ||
      state.configuration.environment !== configuration.environment)
  ) {
    resetProviderState(state)
  }

  if (!state.provider) {
    state.provider = createFlagProvider({
      ...configuration,
      refreshIntervalMs: 60_000,
      maxStaleMs: 300_000,
      refreshTimeoutMs: 2_000,
    })
    state.configuration = configuration
  }

  if (!state.started) {
    state.started = true
    state.requestRefreshGate.markAttempt()
    // A snapshot is an optimisation only. Never make a request wait for it and
    // never allow an unexpected transport failure to become an unhandled reject.
    // SDK initialize arms its own bounded periodic refresh before attempting
    // the first fetch, so a failed cold fetch recovers on that timer. Keeping
    // `started` true prevents every request from creating a retry storm.
    try {
      state.initialization = state.provider.initialize()
        .then(() => undefined)
        .catch(() => undefined)
    } catch {
      state.initialization = Promise.resolve()
    }
  } else if (state.requestRefreshGate.takeIfDue()) {
    // Cloud Run can throttle the SDK's periodic timer between requests. Kick
    // the same deduplicated refresh from live traffic, but never await it: this
    // request keeps resolving synchronously from the accepted snapshot/LKG.
    void state.provider.refresh().catch(() => undefined)
  }

  return state.provider
}

function getProvider(flagKey: string):
  | {
      provider: FlagProvider
      route: GoldenFlagReadKeyRoute
      state: ProviderState
    }
  | undefined {
  // Read configuration lazily. This keeps the adapter safe for runtimes that
  // load env after module evaluation and for isolated test setup.
  const baseUrl = process.env.GROWTH_ENGINE_URL?.replace(/\/+$/, '')
  const environment = parseGoldenFlagEnvironment(
    process.env.GOLDEN_BEANS_FLAG_ENVIRONMENT,
  )
  const route = routeGoldenFlagReadKey(flagKey, {
    GOLDEN_BEANS_FLAG_READ_KEY: process.env.GOLDEN_BEANS_FLAG_READ_KEY,
    GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY:
      process.env.GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY,
  })
  if (!baseUrl || !environment) {
    // The URL and environment are shared prerequisites. If either disappears,
    // neither provider can refresh safely, so release both timers and snapshots.
    resetProviderState(primaryProviderState)
    resetProviderState(partnersRecruitingProviderState)
    return undefined
  }

  if (
    route.resetScopedProvider &&
    partnersRecruitingProviderState.configuration
  ) {
    // Removing the scoped credential must also release its refresh timer. The
    // reset applies even when later traffic checks only primary flags; the
    // partner flag immediately falls back to the established primary provider.
    resetProviderState(partnersRecruitingProviderState)
  }

  if (!route.flagReadKey) {
    resetProviderState(primaryProviderState)
    return undefined
  }

  const state = route.providerSlot === 'partners-recruiting-v3'
    ? partnersRecruitingProviderState
    : primaryProviderState
  return {
    provider: configuredProvider(state, {
      baseUrl,
      flagReadKey: route.flagReadKey,
      environment,
    }),
    route,
    state,
  }
}

function evaluateSelectedProvider(
  selected: {
    provider: FlagProvider
    route: GoldenFlagReadKeyRoute
  },
  flagKey: string,
  defaultValue: boolean,
): GoldenBooleanEvaluation | undefined {
  const snapshot = selected.provider.getSnapshot()
  if (!snapshot) return undefined
  scheduleDurableGoldenSnapshot(snapshot, selected.route.providerSlot)

  const details = selected.provider.resolveBooleanEvaluation(
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
    const selected = getProvider(flagKey)
    if (!selected) return undefined
    return evaluateSelectedProvider(selected, flagKey, defaultValue)
  } catch {
    // The caller keeps its local result on every unexpected provider failure.
    return undefined
  }
}

/**
 * A new provider slot and its durable lane can both be empty on the first
 * production request. Await only the SDK's already-started, bounded initial
 * refresh; concurrent requests share that promise and no retry loop is added.
 */
export async function recoverGoldenBooleanFlag(
  flagKey: string,
  defaultValue: boolean,
): Promise<GoldenBooleanEvaluation | undefined> {
  try {
    const selected = getProvider(flagKey)
    if (!selected) return undefined
    await selected.state.initialization
    return evaluateSelectedProvider(selected, flagKey, defaultValue)
  } catch {
    return undefined
  }
}

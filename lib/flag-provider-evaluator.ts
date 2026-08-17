import type { FlagProviderMode } from './flag-provider-mode'
import type {
  FlagAuthorityObservation,
  FlagDecisionSource,
} from './flag-authority-observation'

export type BooleanFlagEvaluation = {
  value: boolean
  snapshotVersion: number
  flagVersion?: number
  reason: string
}

export type FlagProviderEvaluatorDependencies<K extends string> = {
  readLocal: (flag: K) => Promise<boolean>
  getMode: (flag: K) => FlagProviderMode
  evaluateGolden: (flag: K, localValue: boolean) => BooleanFlagEvaluation | undefined
  recoverGolden?: (
    flag: K,
    localValue: boolean,
  ) => Promise<BooleanFlagEvaluation | undefined>
  readDurableGolden: (
    flag: K,
    localValue: boolean,
  ) => Promise<BooleanFlagEvaluation | undefined>
  observeShadow: (input: {
    flagKey: K
    defaultValue: boolean
    localValue: boolean
    goldenValue: boolean
    snapshotVersion: number
    flagVersion?: number
    reason: string
  }) => void
  getDefault: (flag: K) => boolean
  reportAuthority?: (observation: FlagAuthorityObservation<K>) => void
}

/**
 * Shared orchestration behind the public `isEnabled()` seam.
 *
 * Keeping this composition pure makes every provider mode testable without
 * loading credentials or a database client. Transport, cache and mirror
 * implementations stay server-only and are injected by `lib/flags.ts`.
 */
export function createFlagProviderEvaluator<K extends string>(
  dependencies: FlagProviderEvaluatorDependencies<K>,
): (flag: K) => Promise<boolean> {
  return async (flag: K): Promise<boolean> => {
    const report = (
      authority: FlagProviderMode,
      source: FlagDecisionSource,
      localValue: boolean,
      evaluation?: BooleanFlagEvaluation,
    ) => {
      try {
        dependencies.reportAuthority?.({
          flagKey: flag,
          authority,
          source,
          snapshotVersion: evaluation?.snapshotVersion,
          flagVersion: evaluation?.flagVersion,
          reason: evaluation?.reason,
          matchesLocal: evaluation ? evaluation.value === localValue : undefined,
        })
      } catch {
        // Operational reporting is never part of the decision.
      }
    }

    let localValue = dependencies.getDefault(flag)
    try {
      localValue = await dependencies.readLocal(flag)
    } catch {
      // A local-store failure retains the established compile-time polarity.
    }

    let mode: FlagProviderMode = 'local'
    try {
      mode = dependencies.getMode(flag)
    } catch {
      // Invalid cutover configuration must preserve local authority.
    }
    if (mode === 'local') {
      report(mode, 'local', localValue)
      return localValue
    }

    let golden: BooleanFlagEvaluation | undefined
    try {
      golden = dependencies.evaluateGolden(flag, localValue)
    } catch {
      // A provider adapter is an optional control-plane dependency.
    }

    if (!golden) {
      if (mode !== 'golden') {
        report(mode, 'fallback', localValue)
        return localValue
      }
      try {
        const durable = await dependencies.readDurableGolden(flag, localValue)
        if (durable) {
          report(mode, 'durable', localValue, durable)
          return durable.value
        }
      } catch {
        // The established local/default polarity below remains authoritative.
      }
      try {
        const recovered = await dependencies.recoverGolden?.(flag, localValue)
        if (recovered) {
          report(mode, 'golden', localValue, recovered)
          return recovered.value
        }
      } catch {
        // Initial recovery is bounded and optional; defaults remain the final fallback.
      }
      report(mode, 'fallback', localValue)
      return localValue
    }

    if (mode === 'shadow') {
      try {
        dependencies.observeShadow({
          flagKey: flag,
          defaultValue: dependencies.getDefault(flag),
          localValue,
          goldenValue: golden.value,
          snapshotVersion: golden.snapshotVersion,
          flagVersion: golden.flagVersion,
          reason: golden.reason,
        })
      } catch {
        // Evidence collection must never affect a feature decision.
      }
      report(mode, 'local', localValue, golden)
      return localValue
    }

    report(mode, 'golden', localValue, golden)
    return golden.value
  }
}

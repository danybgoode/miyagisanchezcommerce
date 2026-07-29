import type { FlagProviderMode } from './flag-provider-mode'

export type BooleanFlagEvaluation = {
  value: boolean
  snapshotVersion: number
  flagVersion?: number
  reason: string
}

export type FlagProviderEvaluatorDependencies<K extends string> = {
  readLocal: (flag: K) => Promise<boolean>
  getMode: () => FlagProviderMode
  evaluateGolden: (flag: K, localValue: boolean) => BooleanFlagEvaluation | undefined
  readDurableGolden: (flag: K, localValue: boolean) => Promise<boolean | undefined>
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
    let localValue = dependencies.getDefault(flag)
    try {
      localValue = await dependencies.readLocal(flag)
    } catch {
      // A local-store failure retains the established compile-time polarity.
    }

    const mode = dependencies.getMode()
    if (mode === 'local') return localValue

    let golden: BooleanFlagEvaluation | undefined
    try {
      golden = dependencies.evaluateGolden(flag, localValue)
    } catch {
      // A provider adapter is an optional control-plane dependency.
    }

    if (!golden) {
      if (mode !== 'golden') return localValue
      try {
        return (await dependencies.readDurableGolden(flag, localValue)) ?? localValue
      } catch {
        return localValue
      }
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
      return localValue
    }

    return golden.value
  }
}

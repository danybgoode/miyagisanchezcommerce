import type {
  FlagDecisionObservation,
  FlagDecisionSource,
} from './flag-decision-observation'

export type BooleanFlagEvaluation = {
  value: boolean
  snapshotVersion: number
  flagVersion?: number
  reason: string
}

export type FlagProviderEvaluatorDependencies<K extends string> = {
  evaluateGolden: (flag: K, defaultValue: boolean) => BooleanFlagEvaluation | undefined
  recoverGolden?: (
    flag: K,
    defaultValue: boolean,
  ) => Promise<BooleanFlagEvaluation | undefined>
  readDurableGolden: (
    flag: K,
    defaultValue: boolean,
  ) => Promise<BooleanFlagEvaluation | undefined>
  getDefault: (flag: K) => boolean
  reportDecision?: (observation: FlagDecisionObservation<K>) => void
}

/**
 * Shared orchestration behind the public `isEnabled()` seam — ONE authority: Golden Frijoles.
 *
 * flag-provider-mandate S2.2 deleted the `local`/`shadow` modes and the `GOLDEN_BEANS_FLAG_CUTOVER`
 * manifest that chose between them. The hazard that closed: the manifest parser resolved any
 * malformed OR UNSET value to `local`, so one env-var typo silently moved every commerce decision
 * back onto `platform_flags` with no error anywhere. There is now nothing to fall back to and
 * nothing to mis-parse.
 *
 * The chain, in order, and why each rung exists:
 *  1. the live snapshot — Golden deciding;
 *  2. the durable mirror — the OUTAGE fallback, kept deliberately: removing it once made a cold
 *     instance serve a compile default and 404 a live `/us/operators` request (LEARNINGS);
 *  3. one bounded wait for the provider's already-started initial fetch — a cold, unseeded lane;
 *  4. the compile-time default — the fail-safe polarity (`killswitch` ON, `enablement` OFF).
 *
 * Every decision reports its `source`, and that record is the only production signal that Golden
 * is not deciding: from ~2026-08-27 to 2026-09-22 the read key had EXPIRED (401) and every decision
 * came from `durable` while the console looked healthy. Kept pure so every rung is testable without
 * credentials or a database; the I/O lives in `lib/flags.ts`.
 */
export function createFlagProviderEvaluator<K extends string>(
  dependencies: FlagProviderEvaluatorDependencies<K>,
): (flag: K) => Promise<boolean> {
  return async (flag: K): Promise<boolean> => {
    const report = (source: FlagDecisionSource, evaluation?: BooleanFlagEvaluation) => {
      try {
        dependencies.reportDecision?.({
          flagKey: flag,
          // A snapshot that does not DEFINE the flag answers with the default we passed in
          // (reason 'DEFAULT') — the value is right, but Golden did not decide it. Report it as
          // such, so this record stays an honest "is Golden deciding?" signal.
          source: evaluation?.reason === 'DEFAULT' ? 'default' : source,
          snapshotVersion: evaluation?.snapshotVersion,
          flagVersion: evaluation?.flagVersion,
          reason: evaluation?.reason,
        })
      } catch {
        // Operational reporting is never part of the decision.
      }
    }

    let defaultValue = false
    try {
      defaultValue = dependencies.getDefault(flag)
    } catch {
      // Unreachable through the typed seam; if it ever happens, stay closed rather than throw.
    }

    try {
      const golden = dependencies.evaluateGolden(flag, defaultValue)
      if (golden) {
        report('golden', golden)
        return golden.value
      }
    } catch {
      // The provider adapter must never break a request; fall to the mirror.
    }

    try {
      const durable = await dependencies.readDurableGolden(flag, defaultValue)
      if (durable) {
        report('durable', durable)
        return durable.value
      }
    } catch {
      // A mirror read failure falls to recovery, then to the compile default.
    }

    try {
      const recovered = await dependencies.recoverGolden?.(flag, defaultValue)
      if (recovered) {
        report('golden', recovered)
        return recovered.value
      }
    } catch {
      // Initial recovery is bounded and optional.
    }

    report('default')
    return defaultValue
  }
}

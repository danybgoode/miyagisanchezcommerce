/**
 * Pure validation and evaluation for Miyagi's durable Golden Beans snapshot.
 *
 * The database mirror is an outage fallback, never a second control plane: it
 * only accepts snapshots that the SDK contract already validates, and the
 * stored version can only move forward in SQL.
 */
import {
  evaluateFlag,
  parseFlagSnapshot,
  type FlagResolutionReason,
  type FlagSnapshot,
} from '@golden-beans/sdk'
import type { GoldenFlagEnvironment } from '@/lib/flag-provider-mode'

export type DurableGoldenBooleanEvaluation = {
  value: boolean
  snapshotVersion: number
  flagVersion?: number
  reason: FlagResolutionReason
}

export function parseDurableGoldenSnapshot(
  input: unknown,
  environment: GoldenFlagEnvironment,
): FlagSnapshot | undefined {
  const parsed = parseFlagSnapshot(input)
  if (!parsed.ok || parsed.snapshot.environment !== environment) return undefined
  return parsed.snapshot
}

/** Evaluates entirely locally from a previously validated durable snapshot. */
export function evaluateDurableGoldenBooleanFlag(
  snapshot: FlagSnapshot,
  flagKey: string,
  defaultValue: boolean,
): DurableGoldenBooleanEvaluation {
  const details = evaluateFlag({
    flag: snapshot.flags.find((flag) => flag.key === flagKey),
    defaultValue,
    expectedType: 'boolean',
  })
  return {
    value: details.value,
    snapshotVersion: snapshot.snapshotVersion,
    flagVersion: details.flagVersion,
    reason: details.reason,
  }
}

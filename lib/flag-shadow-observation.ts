/**
 * Bounded, PII-free shadow comparison reporting.
 *
 * A process emits at most one record for a flag/snapshot pair. The record is
 * deliberately limited to control-plane values: it never includes request,
 * user, shop, credential, or flag-definition content.
 */
export type FlagShadowObservation = {
  flagKey: string
  defaultValue: boolean
  localValue: boolean
  goldenValue: boolean
  snapshotVersion: number
  flagVersion?: number
  reason: string
}

export function createFlagShadowObserver(
  write: (observation: FlagShadowObservation) => void,
  maxEntries = 512,
) {
  const observed = new Set<string>()

  return (observation: FlagShadowObservation): boolean => {
    const key = `${observation.snapshotVersion}:${observation.flagKey}`
    if (observed.has(key)) return false
    if (observed.size >= maxEntries) {
      const oldest = observed.values().next().value
      if (oldest) observed.delete(oldest)
    }
    observed.add(key)
    write(observation)
    return true
  }
}

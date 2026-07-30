import type { FlagAuthority } from './flag-cutover'

export type FlagDecisionSource = 'local' | 'golden' | 'durable' | 'fallback'

/** Control-plane-only record. No request, actor, shop or credential data is accepted. */
export type FlagAuthorityObservation<K extends string = string> = {
  flagKey: K
  authority: FlagAuthority
  source: FlagDecisionSource
  snapshotVersion?: number
  flagVersion?: number
  reason?: string
  matchesLocal?: boolean
}

/** Bounded once-per-authority/snapshot/source reporter for operational cutover evidence. */
export function createFlagAuthorityObserver<K extends string>(
  write: (observation: FlagAuthorityObservation<K>) => void,
  maxEntries = 1_024,
) {
  const observed = new Set<string>()

  return (observation: FlagAuthorityObservation<K>): boolean => {
    const key = [
      observation.authority,
      observation.snapshotVersion ?? 'none',
      observation.source,
      observation.flagKey,
    ].join(':')
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

import {
  parseFlagProviderMode,
  type FlagProviderMode,
} from './flag-provider-mode'

export type FlagAuthority = FlagProviderMode
export type FlagCutoverSource = 'manifest' | 'legacy' | 'default' | 'invalid'
export type FlagCutoverInvalidReason =
  | 'empty'
  | 'malformed_entry'
  | 'missing_all'
  | 'duplicate_key'
  | 'unknown_key'
  | 'invalid_mode'

export type FlagCutoverStatus<K extends string> = {
  source: FlagCutoverSource
  valid: boolean
  all: FlagAuthority
  overrides: Readonly<Partial<Record<K, FlagAuthority>>>
  invalidReason?: FlagCutoverInvalidReason
}

const MODES = new Set<FlagAuthority>(['local', 'shadow', 'golden'])

function allLocal<K extends string>(
  invalidReason: FlagCutoverInvalidReason,
): FlagCutoverStatus<K> {
  return {
    source: 'invalid',
    valid: false,
    all: 'local',
    overrides: Object.freeze({}),
    invalidReason,
  }
}

/**
 * Parse the portable frontend/backend cutover contract.
 *
 * `GOLDEN_BEANS_FLAG_CUTOVER` is a comma-separated list of `key=mode`
 * entries. Exactly one `*=mode` base is required and specific keys may then
 * override it. Any malformed, duplicate or unknown entry invalidates the
 * complete manifest and returns all-local; a partial cutover is never guessed.
 *
 * The legacy global mode is read only when `rawManifest` is truly undefined.
 * An empty-but-present manifest is invalid and cannot fall through to it.
 */
export function parseFlagCutover<K extends string>(
  rawManifest: string | undefined,
  knownKeys: readonly K[],
  legacyMode: string | undefined,
): FlagCutoverStatus<K> {
  if (new Set(knownKeys).size !== knownKeys.length) return allLocal('duplicate_key')
  if (rawManifest === undefined) {
    const parsedLegacy = parseFlagProviderMode(legacyMode)
    return {
      source: legacyMode === undefined ? 'default' : 'legacy',
      valid: legacyMode === undefined || MODES.has(legacyMode as FlagAuthority),
      all: parsedLegacy,
      overrides: Object.freeze({}),
    }
  }
  if (rawManifest.trim().length === 0) return allLocal('empty')

  const known = new Set<string>(knownKeys)
  const seen = new Set<string>()
  const overrides: Partial<Record<K, FlagAuthority>> = {}
  let all: FlagAuthority | undefined

  for (const rawEntry of rawManifest.split(',')) {
    const pieces = rawEntry.split('=')
    if (pieces.length !== 2) return allLocal('malformed_entry')
    const key = pieces[0].trim()
    const rawMode = pieces[1].trim()
    if (!key || !rawMode) return allLocal('malformed_entry')
    if (seen.has(key)) return allLocal('duplicate_key')
    seen.add(key)
    if (!MODES.has(rawMode as FlagAuthority)) return allLocal('invalid_mode')
    const mode = rawMode as FlagAuthority
    if (key === '*') {
      all = mode
      continue
    }
    if (!known.has(key)) return allLocal('unknown_key')
    overrides[key as K] = mode
  }

  if (!all) return allLocal('missing_all')
  return {
    source: 'manifest',
    valid: true,
    all,
    overrides: Object.freeze(overrides),
  }
}

export function resolveFlagAuthority<K extends string>(
  status: FlagCutoverStatus<K>,
  flag: K,
): FlagAuthority {
  return status.overrides[flag] ?? status.all
}

export function summarizeFlagCutover<K extends string>(
  status: FlagCutoverStatus<K>,
  knownKeys: readonly K[],
): Readonly<Record<FlagAuthority, number>> {
  const summary: Record<FlagAuthority, number> = {
    local: 0,
    shadow: 0,
    golden: 0,
  }
  for (const key of knownKeys) summary[resolveFlagAuthority(status, key)] += 1
  return Object.freeze(summary)
}

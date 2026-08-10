export const PARTNERS_RECRUITING_V3_FLAG_KEY = 'partners.recruiting_v3_enabled'
export const PARTNERS_RECRUITING_V3_READ_KEY_ENV =
  'GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY'

type FlagReadKeyEnvironment = {
  GOLDEN_BEANS_FLAG_READ_KEY?: string
  GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY?: string
}

export type GoldenFlagReadKeyRoute = {
  flagReadKey: string | undefined
  providerSlot: 'primary' | 'partners-recruiting-v3'
  persistToDurableMirror: boolean
  resetScopedProvider: boolean
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Route only the recruiting-v3 flag to its owner-visible Golden project.
 *
 * The established production credential is bound to a legacy catalog with 43
 * active decisions. The current owner catalog intentionally starts a new,
 * independently versioned snapshot. Replacing the primary credential would
 * therefore turn every absent legacy decision into a local fallback. A scoped
 * credential preserves the existing catalog while letting this one flag remain
 * operable from the current owner UI.
 *
 * Scoped snapshots never enter the shared durable mirror: their snapshot
 * version is meaningful only inside their own project, and comparing it with
 * the primary project's version would corrupt last-known-good ordering.
 */
export function routeGoldenFlagReadKey(
  flagKey: string,
  env: FlagReadKeyEnvironment,
): GoldenFlagReadKeyRoute {
  const primary = nonBlank(env.GOLDEN_BEANS_FLAG_READ_KEY)
  const partnersRecruiting = nonBlank(
    env.GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY,
  )

  if (flagKey === PARTNERS_RECRUITING_V3_FLAG_KEY && partnersRecruiting) {
    return {
      flagReadKey: partnersRecruiting,
      providerSlot: 'partners-recruiting-v3',
      persistToDurableMirror: false,
      resetScopedProvider: false,
    }
  }

  return {
    flagReadKey: primary,
    providerSlot: 'primary',
    persistToDurableMirror: true,
    resetScopedProvider: flagKey === PARTNERS_RECRUITING_V3_FLAG_KEY,
  }
}

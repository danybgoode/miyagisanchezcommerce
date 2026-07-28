/**
 * lib/fundadoras-experiment.ts
 *
 * Tiendas Fundadoras' governed-experiment assignment. This is deliberately a
 * zero-import pure module: the registry and Miyagi must make the exact same
 * deterministic choice without a network round-trip or a feature-flag read.
 */

export const FUNDADORAS_VISITOR_COOKIE_NAME = 'fnd_sid'
export const FUNDADORAS_EXPERIMENT_KEY = 'fundadoras_promise_cta'
// Version 3. v1's registry plan declared an eligibility tag predicate
// (`campaign: vende_fundadoras`) that this emitter has no reason to send, so golden-beans
// correctly rejected every exposure as `eligibility_mismatch` and marked the results
// not-decision-ready — the governance layer catching a mis-declared plan, exactly as designed.
// A running definition is immutable, so the corrected plan is a NEW version rather than an edit,
// and this constant must track it: the analysis compares `experiment_definition_version` for
// strict equality, so an emitter one version behind is reported as `version_mismatch`.
//
// It is 3 rather than 2 because v2 fixed the eligibility predicate but kept v1's planned window,
// which still contained v1's already-emitted exposures — and `version_mismatch` is a BLOCKER, so
// those stale rows would have blocked v2 on arrival. v3 carries both fixes: no eligibility tag
// predicate, and a window that starts after the last v1 exposure so they fall out of the fact
// selection entirely rather than being counted as mismatches.
export const FUNDADORAS_EXPERIMENT_DEFINITION_VERSION = 3
export const FUNDADORAS_EXPERIMENT_ASSIGNMENT_ENTITY_TYPE = 'fundadoras_visitor'
export const FUNDADORAS_EXPERIMENT_CONTROL_VARIANT_KEY = 'control'

export const FUNDADORAS_EXPERIMENT_VARIANTS = [
  { key: 'control', weight: 1 },
  { key: 'promesa_directa', weight: 1 },
] as const

export type GovernedVariant = { key: string; weight?: number }

export interface GovernedVariantAssignment {
  assignmentEntityType: string
  assignmentEntityId: string
  experimentKey: string
  definitionVersion: number
  variants: readonly GovernedVariant[]
}

export type FundadorasExperimentVariant = (typeof FUNDADORAS_EXPERIMENT_VARIANTS)[number]['key']

/** FNV-1a 32-bit, ported exactly from golden-beans/packages/sdk/src/bucketing.ts. */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Resolve a registry-compatible weighted assignment. The code-unit sort is
 * intentional: locale-aware sorting changes the declared allocation for keys
 * that differ by case, punctuation, or accents.
 */
export function resolveGovernedVariant(assignment: GovernedVariantAssignment): string | null {
  const variants = assignment.variants
    .map((variant) => ({ key: variant.key, weight: variant.weight ?? 1 }))
    .filter((variant) => variant.key.length > 0 && variant.weight > 0)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  if (variants.length === 0) return null

  const totalWeight = variants.reduce((total, variant) => total + variant.weight, 0)
  const seed = JSON.stringify([
    assignment.assignmentEntityType,
    assignment.assignmentEntityId,
    assignment.experimentKey,
    assignment.definitionVersion,
  ])
  const point = (fnv1a32(seed) / 0x100000000) * totalWeight

  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (point < cumulative) return variant.key
  }
  return variants[variants.length - 1].key
}

export function resolveFundadorasExperimentVariant(visitorSubjectId: string): FundadorasExperimentVariant {
  return resolveGovernedVariant({
    assignmentEntityType: FUNDADORAS_EXPERIMENT_ASSIGNMENT_ENTITY_TYPE,
    assignmentEntityId: visitorSubjectId,
    experimentKey: FUNDADORAS_EXPERIMENT_KEY,
    definitionVersion: FUNDADORAS_EXPERIMENT_DEFINITION_VERSION,
    variants: FUNDADORAS_EXPERIMENT_VARIANTS,
  }) as FundadorasExperimentVariant
}

/** Only a cookie minted by middleware may assert a Fundadoras visitor subject. */
export function isFundadorasVisitorSubjectId(value: string): boolean {
  return /^fnd_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

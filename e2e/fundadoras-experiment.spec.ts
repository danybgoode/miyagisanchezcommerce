import { test, expect } from '@playwright/test'
import {
  FUNDADORAS_EXPERIMENT_ASSIGNMENT_ENTITY_TYPE,
  FUNDADORAS_EXPERIMENT_DEFINITION_VERSION,
  FUNDADORAS_EXPERIMENT_KEY,
  FUNDADORAS_EXPERIMENT_VARIANTS,
  fnv1a32,
  type GovernedVariant,
  isFundadorasVisitorSubjectId,
  resolveFundadorasExperimentVariant,
  resolveGovernedVariant,
} from '../lib/fundadoras-experiment'
import {
  buildFundadorasEventPayload,
  isPlausibleOpaqueSubjectId,
  type FundadorasEventName,
} from '../lib/fundadoras-application'

const PARITY_VECTORS = [
  // Regenerated for definition version 2 from golden-beans' own `resolveGovernedVariant`.
  // The version is part of the assignment seed, so these necessarily differ from v1's table —
  // that is the seed doing its job, not a regression.
  ['fnd_00000000-0000-4000-8000-000000000001', 'promesa_directa'],
  ['fnd_11111111-1111-4111-8111-111111111111', 'promesa_directa'],
  ['fnd_a1b2c3d4-e5f6-4a7b-8c9d-000000000000', 'control'],
  ['fnd_deadbeef-0000-4000-8000-feedface0000', 'control'],
  ['fnd_5f2c1e8a-3b4d-4c5e-9f01-2a3b4c5d6e7f', 'promesa_directa'],
  ['fnd_ffffffff-ffff-4fff-8fff-ffffffffffff', 'control'],
  ['fnd_01234567-89ab-4cde-8f01-23456789abcd', 'control'],
  ['fnd_9e107d9d-372b-4b0b-8f0a-6d3f0e4c1a2b', 'control'],
] as const

function resolveFor(
  assignmentEntityId: string,
  experimentKey = FUNDADORAS_EXPERIMENT_KEY,
  definitionVersion = FUNDADORAS_EXPERIMENT_DEFINITION_VERSION,
  variants: readonly GovernedVariant[] = FUNDADORAS_EXPERIMENT_VARIANTS,
) {
  return resolveGovernedVariant({
    assignmentEntityType: FUNDADORAS_EXPERIMENT_ASSIGNMENT_ENTITY_TYPE,
    assignmentEntityId,
    experimentKey,
    definitionVersion,
    variants,
  })
}

test.describe('Tiendas Fundadoras governed experiment (pure)', () => {
  test('matches every golden-beans parity vector exactly', () => {
    for (const [visitorSubjectId, expected] of PARITY_VECTORS) {
      expect(resolveFundadorasExperimentVariant(visitorSubjectId)).toBe(expected)
    }
  })

  test('is deterministic and includes experiment identity in its seed', () => {
    const subject = PARITY_VECTORS[0][0]
    expect(resolveFor(subject)).toBe(resolveFor(subject))

    const subjects = PARITY_VECTORS.map(([id]) => id)
    // Compare against a version that is NOT the live one, so this stays a real assertion when the
    // live definition version moves (it was 1, it is now 2).
    const otherVersion = FUNDADORAS_EXPERIMENT_DEFINITION_VERSION + 1
    expect(subjects.some((id) => resolveFor(id, FUNDADORAS_EXPERIMENT_KEY, otherVersion) !== resolveFor(id))).toBe(true)
    expect(subjects.some((id) => resolveFor(id, 'fundadoras_promise_cta_v2') !== resolveFor(id))).toBe(true)
  })

  test('normalizes weights and sorts by code unit before allocation', () => {
    const subject = PARITY_VECTORS[1][0]
    const sorted = [
      { key: 'control', weight: 1 },
      { key: 'promesa_directa', weight: 3 },
    ]
    const unsorted = [
      { key: 'promesa_directa', weight: 3 },
      { key: 'control', weight: 1 },
      { key: 'disabled', weight: 0 },
      { key: 'negative', weight: -1 },
      { key: '', weight: 10 },
    ]
    expect(resolveFor(subject, FUNDADORAS_EXPERIMENT_KEY, 1, unsorted)).toBe(
      resolveFor(subject, FUNDADORAS_EXPERIMENT_KEY, 1, sorted),
    )
    expect(resolveFor(subject, FUNDADORAS_EXPERIMENT_KEY, 1, [])).toBeNull()
  })

  test('orders variant keys by code unit, never locale collation', () => {
    const subject = PARITY_VECTORS[2][0]
    const seed = JSON.stringify([
      FUNDADORAS_EXPERIMENT_ASSIGNMENT_ENTITY_TYPE,
      subject,
      FUNDADORAS_EXPERIMENT_KEY,
      FUNDADORAS_EXPERIMENT_DEFINITION_VERSION,
    ])
    const expected = (fnv1a32(seed) / 0x100000000) * 2 < 1 ? 'aB' : 'a_b'
    // Must use the SAME version the seed above was built with, or this asserts nothing.
    expect(resolveFor(subject, FUNDADORAS_EXPERIMENT_KEY, FUNDADORAS_EXPERIMENT_DEFINITION_VERSION, [
      { key: 'a_b', weight: 1 },
      { key: 'aB', weight: 1 },
    ])).toBe(expected)
  })

  test('keeps context and the relationship userId in their separate id spaces', () => {
    const visitorSubjectId = PARITY_VECTORS[0][0]
    for (const event of [
      'fundadoras_view',
      'fundadoras_cta',
      'fundadoras_application_start',
      'fundadoras_validation_failed',
    ] as FundadorasEventName[]) {
      const payload = buildFundadorasEventPayload(event, visitorSubjectId, visitorSubjectId, {}, 'promesa_directa')
      expect(payload.context).toEqual({ version: 1, subject: { type: 'fundadoras_visitor', id: visitorSubjectId } })
    }

    const relationshipId = 'relationship_opaque_id'
    const accepted = buildFundadorasEventPayload(
      'fundadoras_application_accepted',
      relationshipId,
      visitorSubjectId,
      {},
      'promesa_directa',
    )
    expect(accepted.userId).toBe(relationshipId)
    expect(accepted.context).toEqual({ version: 1, subject: { type: 'fundadoras_visitor', id: visitorSubjectId } })
  })

  test('allowlists tags and overwrites a forged client variant with the computed one', () => {
    const visitorSubjectId = PARITY_VECTORS[0][0]
    const payload = buildFundadorasEventPayload('fundadoras_view', visitorSubjectId, visitorSubjectId, {
      utm_source: 'founder-newsletter',
      email: 'leak@example.com',
      phone: '5512345678',
      businessName: 'LEAK',
      variant: 'forged',
      experiment_definition_version: '999',
    }, 'promesa_directa')

    expect(payload.tags).toEqual({
      utm_source: 'founder-newsletter',
      variant: 'promesa_directa',
      // The SERVER's live version always wins over the client's forged '999'.
      experiment_definition_version: FUNDADORAS_EXPERIMENT_DEFINITION_VERSION,
    })
    expect(JSON.stringify(payload)).not.toContain('leak@example.com')
    expect(JSON.stringify(payload)).not.toContain('5512345678')
    expect(JSON.stringify(payload)).not.toContain('LEAK')
  })

  test('rejects malformed, oversized, and whitespace visitor subjects', () => {
    const valid = PARITY_VECTORS[0][0]
    expect(isFundadorasVisitorSubjectId(valid)).toBe(true)
    expect(isPlausibleOpaqueSubjectId(valid)).toBe(true)
    expect(isFundadorasVisitorSubjectId(` ${valid}`)).toBe(false)
    expect(isPlausibleOpaqueSubjectId(` ${valid}`)).toBe(false)
    expect(isFundadorasVisitorSubjectId(`fnd_${'a'.repeat(200)}`)).toBe(false)
    expect(isPlausibleOpaqueSubjectId(`fnd_${'a'.repeat(200)}`)).toBe(false)
    expect(isFundadorasVisitorSubjectId('fnd_not-a-uuid')).toBe(false)
  })
})

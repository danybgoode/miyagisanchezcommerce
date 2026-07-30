import { expect, test } from '@playwright/test'
import {
  parseFlagCutover,
  resolveFlagAuthority,
  summarizeFlagCutover,
} from '../lib/flag-cutover'
import {
  createFlagAuthorityObserver,
  type FlagAuthorityObservation,
} from '../lib/flag-authority-observation'

const KEYS = [
  'content.overrides_enabled',
  'catalog.inventory_channels_enabled',
  'checkout.stripe_enabled',
] as const

test.describe('portable per-flag cutover manifest', () => {
  test('uses legacy global mode only when the manifest is truly absent', () => {
    const legacy = parseFlagCutover(undefined, KEYS, 'shadow')
    expect(legacy).toMatchObject({
      source: 'legacy',
      valid: true,
      all: 'shadow',
      overrides: {},
    })
    expect(resolveFlagAuthority(legacy, 'checkout.stripe_enabled')).toBe('shadow')

    const defaulted = parseFlagCutover(undefined, KEYS, undefined)
    expect(defaulted).toMatchObject({ source: 'default', valid: true, all: 'local' })

    const malformedLegacy = parseFlagCutover(undefined, KEYS, 'GOLDEN')
    expect(malformedLegacy).toMatchObject({
      source: 'legacy',
      valid: false,
      all: 'local',
    })
  })

  test('supports an explicit all-keys base plus trimmed per-key stages', () => {
    const status = parseFlagCutover(
      ' *=shadow , content.overrides_enabled=golden, checkout.stripe_enabled = local ',
      KEYS,
      'golden',
    )
    expect(status).toMatchObject({
      source: 'manifest',
      valid: true,
      all: 'shadow',
      overrides: {
        'content.overrides_enabled': 'golden',
        'checkout.stripe_enabled': 'local',
      },
    })
    expect(resolveFlagAuthority(status, 'content.overrides_enabled')).toBe('golden')
    expect(resolveFlagAuthority(status, 'catalog.inventory_channels_enabled')).toBe('shadow')
    expect(resolveFlagAuthority(status, 'checkout.stripe_enabled')).toBe('local')
    expect(summarizeFlagCutover(status, KEYS)).toEqual({
      local: 1,
      shadow: 1,
      golden: 1,
    })
  })

  for (const [name, raw, invalidReason] of [
    ['empty but present', '', 'empty'],
    ['whitespace only', '   ', 'empty'],
    ['missing all-keys sentinel', 'content.overrides_enabled=golden', 'missing_all'],
    ['unknown key', '*=shadow,unknown.flag=golden', 'unknown_key'],
    ['duplicate key', '*=shadow,content.overrides_enabled=golden,content.overrides_enabled=local', 'duplicate_key'],
    ['duplicate sentinel', '*=shadow,*=golden', 'duplicate_key'],
    ['invalid mode', '*=remote', 'invalid_mode'],
    ['missing equals', '*=shadow,content.overrides_enabled', 'malformed_entry'],
    ['extra equals', '*=shadow,content.overrides_enabled=golden=nope', 'malformed_entry'],
    ['empty entry', '*=shadow,', 'malformed_entry'],
  ] as const) {
    test(`${name} invalidates the whole manifest to all-local`, () => {
      const status = parseFlagCutover(raw, KEYS, 'golden')
      expect(status).toMatchObject({
        source: 'invalid',
        valid: false,
        all: 'local',
        overrides: {},
        invalidReason,
      })
      expect(summarizeFlagCutover(status, KEYS)).toEqual({
        local: KEYS.length,
        shadow: 0,
        golden: 0,
      })
    })
  }

  test('a duplicate known-key inventory fails closed before interpretation', () => {
    const status = parseFlagCutover(
      '*=golden',
      ['content.overrides_enabled', 'content.overrides_enabled'] as const,
      undefined,
    )
    expect(status).toMatchObject({
      source: 'invalid',
      valid: false,
      all: 'local',
      invalidReason: 'duplicate_key',
    })
  })
})

test('authority reporting is bounded, deduplicated and accepts control-plane fields only', () => {
  const records: FlagAuthorityObservation<(typeof KEYS)[number]>[] = []
  const report = createFlagAuthorityObserver<(typeof KEYS)[number]>(
    (observation) => records.push(observation),
    2,
  )
  const first = {
    flagKey: 'content.overrides_enabled',
    authority: 'shadow',
    source: 'local',
    snapshotVersion: 40,
    flagVersion: 1,
    reason: 'STATIC',
    matchesLocal: true,
  } as const

  expect(report(first)).toBe(true)
  expect(report({ ...first, matchesLocal: false })).toBe(false)
  expect(report({ ...first, source: 'golden' })).toBe(true)
  expect(
    report({
      ...first,
      flagKey: 'checkout.stripe_enabled',
      snapshotVersion: 41,
    }),
  ).toBe(true)
  expect(report(first)).toBe(true)
  expect(records).toHaveLength(4)

  expect(Object.keys(records[0]).sort()).toEqual([
    'authority',
    'flagKey',
    'flagVersion',
    'matchesLocal',
    'reason',
    'snapshotVersion',
    'source',
  ])
})

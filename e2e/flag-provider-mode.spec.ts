import { expect, test } from '@playwright/test'
import { parseFlagProviderMode, parseGoldenFlagEnvironment } from '../lib/flag-provider-mode'
import { createFlagShadowObserver, type FlagShadowObservation } from '../lib/flag-shadow-observation'
import { evaluateDurableGoldenBooleanFlag, parseDurableGoldenSnapshot } from '../lib/golden-flag-mirror'

const durableSnapshot = {
  contractVersion: 1,
  environment: 'production',
  snapshotVersion: 7,
  flags: [
    {
      key: 'checkout.stripe_enabled',
      definitionVersion: 3,
      definition: {
        valueType: 'boolean',
        description: 'Durable mirror test fixture.',
        defaultVariantKey: 'off',
        variants: [
          { key: 'off', value: false },
          { key: 'on', value: true },
        ],
        rules: [],
      },
    },
  ],
}

test.describe('Golden Beans flag-provider migration mode', () => {
  test('defaults to local for absent, malformed, and differently-cased configuration', () => {
    expect(parseFlagProviderMode(undefined)).toBe('local')
    expect(parseFlagProviderMode('')).toBe('local')
    expect(parseFlagProviderMode('SHADOW')).toBe('local')
    expect(parseFlagProviderMode('remote')).toBe('local')
  })

  test('accepts only the deliberate local, shadow, and golden stages', () => {
    expect(parseFlagProviderMode('local')).toBe('local')
    expect(parseFlagProviderMode('shadow')).toBe('shadow')
    expect(parseFlagProviderMode('golden')).toBe('golden')
  })

  test('requires an explicit valid Golden Beans environment', () => {
    expect(parseGoldenFlagEnvironment(undefined)).toBeUndefined()
    expect(parseGoldenFlagEnvironment('prod')).toBeUndefined()
    expect(parseGoldenFlagEnvironment('development')).toBe('development')
    expect(parseGoldenFlagEnvironment('preview')).toBe('preview')
    expect(parseGoldenFlagEnvironment('production')).toBe('production')
  })

  test('records one PII-free observation per flag and Golden snapshot', () => {
    const records: FlagShadowObservation[] = []
    const observe = createFlagShadowObserver((observation) => records.push(observation), 2)
    const base: FlagShadowObservation = {
      flagKey: 'checkout.stripe_enabled',
      defaultValue: true,
      localValue: true,
      goldenValue: false,
      snapshotVersion: 3,
      flagVersion: 11,
      reason: 'STATIC',
    }

    expect(observe(base)).toBe(true)
    expect(observe({ ...base, goldenValue: true })).toBe(false)
    expect(observe({ ...base, snapshotVersion: 4 })).toBe(true)
    expect(observe({ ...base, snapshotVersion: 5 })).toBe(true)
    expect(observe(base)).toBe(true) // the bounded observer evicts its oldest record
    expect(records).toEqual([
      base,
      { ...base, snapshotVersion: 4 },
      { ...base, snapshotVersion: 5 },
      base,
    ])
  })

  test('uses only a valid matching-environment snapshot as the durable fallback', () => {
    const snapshot = parseDurableGoldenSnapshot(durableSnapshot, 'production')
    expect(snapshot).toBeDefined()
    expect(evaluateDurableGoldenBooleanFlag(snapshot!, 'checkout.stripe_enabled', true)).toMatchObject({
      value: false,
      snapshotVersion: 7,
      flagVersion: 3,
      reason: 'STATIC',
    })
    expect(parseDurableGoldenSnapshot(durableSnapshot, 'preview')).toBeUndefined()
    expect(parseDurableGoldenSnapshot({ ...durableSnapshot, snapshotVersion: -1 }, 'production')).toBeUndefined()
  })
})

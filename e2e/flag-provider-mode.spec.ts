import { expect, test } from '@playwright/test'
import { parseFlagProviderMode } from '../lib/flag-provider-mode'
import { createFlagShadowObserver, type FlagShadowObservation } from '../lib/flag-shadow-observation'

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
})

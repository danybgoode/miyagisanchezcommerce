import { expect, test } from '@playwright/test'
import { createFlagProvider, type FlagProvider, type FlagSnapshot } from '@golden-beans/sdk'
import { parseFlagProviderMode, parseGoldenFlagEnvironment } from '../lib/flag-provider-mode'
import { createFlagShadowObserver, type FlagShadowObservation } from '../lib/flag-shadow-observation'
import { createFlagProviderEvaluator } from '../lib/flag-provider-evaluator'
import {
  evaluateDurableGoldenBooleanFlag,
  parseDurableGoldenSnapshot,
  retainNewestGoldenSnapshot,
} from '../lib/golden-flag-mirror'

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
} satisfies FlagSnapshot

type TestFlag = 'checkout.stripe_enabled' | 'domain.paywall_enabled'

const testDefaults: Record<TestFlag, boolean> = {
  'checkout.stripe_enabled': true,
  'domain.paywall_enabled': false,
}

function providerEvaluation(provider: FlagProvider, flag: TestFlag, localValue: boolean) {
  const snapshot = provider.getSnapshot()
  if (!snapshot) return undefined
  const result = provider.resolveBooleanEvaluation(flag, localValue)
  return {
    value: result.value,
    snapshotVersion: snapshot.snapshotVersion,
    flagVersion: result.flagVersion,
    reason: result.reason,
  }
}

function snapshotResponse(snapshot: FlagSnapshot): Response {
  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: { 'content-type': 'application/json', etag: `"${snapshot.snapshotVersion}"` },
  })
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

  test('the public decision seam preserves local behavior in local and shadow modes', async () => {
    const observed: FlagShadowObservation[] = []
    let mode: 'local' | 'shadow' = 'local'
    let goldenCalls = 0
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      readLocal: async (flag) => testDefaults[flag],
      getMode: () => mode,
      evaluateGolden: (_flag, localValue) => {
        goldenCalls += 1
        return {
          value: !localValue,
          snapshotVersion: 8,
          flagVersion: 4,
          reason: 'STATIC',
        }
      },
      readDurableGolden: async () => undefined,
      observeShadow: (observation) => observed.push(observation),
      getDefault: (flag) => testDefaults[flag],
    })

    expect(await isEnabled('checkout.stripe_enabled')).toBe(true)
    expect(await isEnabled('domain.paywall_enabled')).toBe(false)
    expect(goldenCalls).toBe(0)

    mode = 'shadow'
    expect(await isEnabled('checkout.stripe_enabled')).toBe(true)
    expect(await isEnabled('domain.paywall_enabled')).toBe(false)
    expect(goldenCalls).toBe(2)
    expect(observed).toEqual([
      expect.objectContaining({
        flagKey: 'checkout.stripe_enabled',
        defaultValue: true,
        localValue: true,
        goldenValue: false,
      }),
      expect.objectContaining({
        flagKey: 'domain.paywall_enabled',
        defaultValue: false,
        localValue: false,
        goldenValue: true,
      }),
    ])
  })

  test('golden mode changes the decision without a provider request per evaluation', async () => {
    let fetchCalls = 0
    const provider = createFlagProvider({
      baseUrl: 'https://flags.example',
      flagReadKey: 'test-read-key',
      environment: 'production',
      refreshIntervalMs: 0,
      fetchImpl: async () => {
        fetchCalls += 1
        return snapshotResponse(durableSnapshot)
      },
    })
    expect((await provider.initialize()).ok).toBe(true)
    expect(fetchCalls).toBe(1)

    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      readLocal: async (flag) => testDefaults[flag],
      getMode: () => 'golden',
      evaluateGolden: (flag, localValue) => providerEvaluation(provider, flag, localValue),
      readDurableGolden: async () => undefined,
      observeShadow: () => undefined,
      getDefault: (flag) => testDefaults[flag],
    })

    expect(await isEnabled('checkout.stripe_enabled')).toBe(false)
    expect(await isEnabled('checkout.stripe_enabled')).toBe(false)
    expect(fetchCalls).toBe(1)
    provider.shutdown()
  })

  test('one evaluator stages different per-flag authorities and reports the exact snapshot source', async () => {
    const reports: Array<Record<string, unknown>> = []
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      readLocal: async (flag) => testDefaults[flag],
      getMode: (flag) => (flag === 'checkout.stripe_enabled' ? 'local' : 'golden'),
      evaluateGolden: (flag, localValue) =>
        flag === 'domain.paywall_enabled'
          ? {
              value: !localValue,
              snapshotVersion: 40,
              flagVersion: 1,
              reason: 'STATIC',
            }
          : undefined,
      readDurableGolden: async () => undefined,
      observeShadow: () => undefined,
      getDefault: (flag) => testDefaults[flag],
      reportAuthority: (report) => reports.push(report),
    })

    expect(await isEnabled('checkout.stripe_enabled')).toBe(true)
    expect(await isEnabled('domain.paywall_enabled')).toBe(true)
    expect(reports).toEqual([
      {
        flagKey: 'checkout.stripe_enabled',
        authority: 'local',
        source: 'local',
        snapshotVersion: undefined,
        flagVersion: undefined,
        reason: undefined,
        matchesLocal: undefined,
      },
      {
        flagKey: 'domain.paywall_enabled',
        authority: 'golden',
        source: 'golden',
        snapshotVersion: 40,
        flagVersion: 1,
        reason: 'STATIC',
        matchesLocal: false,
      },
    ])
  })

  test('mode and reporting failures never escape the public decision seam', async () => {
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      readLocal: async (flag) => testDefaults[flag],
      getMode: () => {
        throw new Error('bad manifest adapter')
      },
      evaluateGolden: () => {
        throw new Error('unreachable')
      },
      readDurableGolden: async () => {
        throw new Error('unreachable')
      },
      observeShadow: () => {
        throw new Error('unreachable')
      },
      getDefault: (flag) => testDefaults[flag],
      reportAuthority: () => {
        throw new Error('reporter outage')
      },
    })

    await expect(isEnabled('checkout.stripe_enabled')).resolves.toBe(true)
    await expect(isEnabled('domain.paywall_enabled')).resolves.toBe(false)
  })

  test('golden authority returns a durable snapshot before local/default fallback', async () => {
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      readLocal: async (flag) => testDefaults[flag],
      getMode: () => 'golden',
      evaluateGolden: () => undefined,
      readDurableGolden: async () => ({
        value: false,
        snapshotVersion: 39,
        flagVersion: 1,
        reason: 'STATIC',
      }),
      observeShadow: () => undefined,
      getDefault: (flag) => testDefaults[flag],
    })

    await expect(isEnabled('checkout.stripe_enabled')).resolves.toBe(false)
  })

  for (const failure of ['timeout', 'malformed', 'stale'] as const) {
    test(`keeps both established default polarities when the provider is ${failure}`, async () => {
      let now = 1_000
      const provider = createFlagProvider({
        baseUrl: 'https://flags.example',
        flagReadKey: 'test-read-key',
        environment: 'production',
        refreshIntervalMs: 0,
        refreshTimeoutMs: 5,
        maxStaleMs: 300_000,
        now: () => now,
        fetchImpl:
          failure === 'timeout'
            ? async () => new Promise<Response>(() => undefined)
            : async () =>
                failure === 'malformed'
                  ? new Response('{"not":"a snapshot"}', {
                      status: 200,
                      headers: { 'content-type': 'application/json' },
                    })
                  : snapshotResponse(durableSnapshot),
      })
      await provider.initialize()
      if (failure === 'stale') now += 300_001

      const isEnabled = createFlagProviderEvaluator<TestFlag>({
        readLocal: async (flag) => testDefaults[flag],
        getMode: () => 'golden',
        evaluateGolden: (flag, localValue) => providerEvaluation(provider, flag, localValue),
        readDurableGolden: async () => undefined,
        observeShadow: () => undefined,
        getDefault: (flag) => testDefaults[flag],
      })

      expect(await isEnabled('checkout.stripe_enabled')).toBe(true)
      expect(await isEnabled('domain.paywall_enabled')).toBe(false)
      provider.shutdown()
    })
  }

  test('a durable mirror can move forward but never roll back or rewrite an equal version', () => {
    const older = { ...durableSnapshot, snapshotVersion: 6 }
    const newer = { ...durableSnapshot, snapshotVersion: 8 }
    const divergentEqual = {
      ...durableSnapshot,
      flags: [],
    }

    expect(retainNewestGoldenSnapshot(durableSnapshot, older)).toBe(durableSnapshot)
    expect(retainNewestGoldenSnapshot(durableSnapshot, divergentEqual)).toBe(durableSnapshot)
    expect(retainNewestGoldenSnapshot(durableSnapshot, newer)).toBe(newer)
    expect(retainNewestGoldenSnapshot(undefined, durableSnapshot)).toBe(durableSnapshot)
  })
})

import { expect, test } from '@playwright/test'
import { createFlagProvider, type FlagProvider, type FlagSnapshot } from '@golden-frijoles/sdk'
import { parseGoldenFlagEnvironment } from '../lib/golden-flag-environment'
import { createFlagProviderEvaluator } from '../lib/flag-provider-evaluator'
import {
  createFlagDecisionObserver,
  type FlagDecisionObservation,
} from '../lib/flag-decision-observation'
import { createFlagProviderRequestRefreshGate } from '../lib/flag-provider-request-refresh'
import {
  evaluateDurableGoldenBooleanFlag,
  parseDurableGoldenSnapshot,
  retainNewestGoldenSnapshot,
} from '../lib/golden-flag-mirror'

/**
 * flag-provider-mandate S2.2 — the ONE-authority evaluator behind `isEnabled()`.
 *
 * Golden live → durable mirror → one bounded initial fetch → compile default. There is no
 * `local`/`shadow` mode and no env var that can move a decision onto `platform_flags`: the specs
 * below pin the order, both fail-safe polarities under every provider failure, and that every
 * decision reports where it came from (the only signal that exposed the expired production key).
 */

const snapshot = {
  contractVersion: 1,
  environment: 'production',
  snapshotVersion: 7,
  flags: [
    {
      key: 'checkout.stripe_enabled',
      definitionVersion: 3,
      definition: {
        valueType: 'boolean',
        description: 'Evaluator fixture.',
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

// The two established polarities: a killswitch fails ON, an enablement fails OFF.
const defaults: Record<TestFlag, boolean> = {
  'checkout.stripe_enabled': true,
  'domain.paywall_enabled': false,
}

const hit = (value: boolean, snapshotVersion = 7) => ({
  value,
  snapshotVersion,
  flagVersion: 1,
  reason: 'STATIC',
})

function providerEvaluation(provider: FlagProvider, flag: TestFlag, defaultValue: boolean) {
  const current = provider.getSnapshot()
  if (!current) return undefined
  const result = provider.resolveBooleanEvaluation(flag, defaultValue)
  return {
    value: result.value,
    snapshotVersion: current.snapshotVersion,
    flagVersion: result.flagVersion,
    reason: result.reason,
  }
}

function snapshotResponse(body: FlagSnapshot): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', etag: `"${body.snapshotVersion}"` },
  })
}

test.describe('flag evaluator · one authority (Golden)', () => {
  test('a live Golden answer wins and is reported as golden — even against the compile default', async () => {
    const decisions: FlagDecisionObservation<TestFlag>[] = []
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      evaluateGolden: () => hit(false),
      readDurableGolden: async () => {
        throw new Error('must not be read when live Golden answered')
      },
      getDefault: (flag) => defaults[flag],
      reportDecision: (observation) => decisions.push(observation),
    })

    await expect(isEnabled('checkout.stripe_enabled')).resolves.toBe(false)
    expect(decisions).toEqual([
      { flagKey: 'checkout.stripe_enabled', source: 'golden', snapshotVersion: 7, flagVersion: 1, reason: 'STATIC' },
    ])
  })

  test('the live read receives the COMPILE default — there is no local store left to consult', async () => {
    const seen: boolean[] = []
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      evaluateGolden: (_flag, defaultValue) => {
        seen.push(defaultValue)
        return undefined
      },
      readDurableGolden: async (_flag, defaultValue) => {
        seen.push(defaultValue)
        return undefined
      },
      getDefault: (flag) => defaults[flag],
    })

    await isEnabled('checkout.stripe_enabled')
    await isEnabled('domain.paywall_enabled')
    expect(seen).toEqual([true, true, false, false])
  })

  test('the order is live → durable → bounded recovery → default, each rung only on a miss', async () => {
    const calls: string[] = []
    const decisions: FlagDecisionObservation<TestFlag>[] = []
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      evaluateGolden: () => {
        calls.push('live')
        return undefined
      },
      readDurableGolden: async () => {
        calls.push('durable')
        return undefined
      },
      recoverGolden: async () => {
        calls.push('recover')
        return undefined
      },
      getDefault: (flag) => defaults[flag],
      reportDecision: (observation) => decisions.push(observation),
    })

    await expect(isEnabled('domain.paywall_enabled')).resolves.toBe(false)
    expect(calls).toEqual(['live', 'durable', 'recover'])
    expect(decisions.map((d) => d.source)).toEqual(['default'])
  })

  test('the durable mirror answers an outage before the default, and is reported as durable', async () => {
    const decisions: FlagDecisionObservation<TestFlag>[] = []
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      evaluateGolden: () => undefined,
      readDurableGolden: async () => hit(true, 39),
      recoverGolden: async () => {
        throw new Error('recovery must not run when the mirror answered')
      },
      getDefault: (flag) => defaults[flag],
      reportDecision: (observation) => decisions.push(observation),
    })

    await expect(isEnabled('domain.paywall_enabled')).resolves.toBe(true)
    expect(decisions.map((d) => [d.source, d.snapshotVersion])).toEqual([['durable', 39]])
  })

  test('a cold unseeded instance takes the bounded recovery before the compile default', async () => {
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      evaluateGolden: () => undefined,
      readDurableGolden: async () => undefined,
      recoverGolden: async () => hit(true, 4),
      getDefault: (flag) => defaults[flag],
    })

    await expect(isEnabled('domain.paywall_enabled')).resolves.toBe(true)
  })

  test('every dependency throwing still resolves to the fail-safe polarity, never a rejection', async () => {
    const boom = () => {
      throw new Error('boom')
    }
    const isEnabled = createFlagProviderEvaluator<TestFlag>({
      evaluateGolden: boom,
      readDurableGolden: async () => boom(),
      recoverGolden: async () => boom(),
      getDefault: (flag) => defaults[flag],
      reportDecision: boom,
    })

    await expect(isEnabled('checkout.stripe_enabled')).resolves.toBe(true)
    await expect(isEnabled('domain.paywall_enabled')).resolves.toBe(false)
  })

  for (const failure of ['timeout', 'malformed', 'stale', 'unauthorized'] as const) {
    test(`a real SDK provider that is ${failure} keeps both polarities`, async () => {
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
            : async () => {
                if (failure === 'malformed')
                  return new Response('{"not":"a snapshot"}', {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  })
                // The EXACT production failure of 2026-08-27 → 2026-09-22: an expired read key.
                if (failure === 'unauthorized')
                  return new Response('{"ok":false,"error":"Invalid flag read credential"}', {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                  })
                return snapshotResponse(snapshot)
              },
      })
      await provider.initialize()
      if (failure === 'stale') now += 300_001

      const decisions: FlagDecisionObservation<TestFlag>[] = []
      const isEnabled = createFlagProviderEvaluator<TestFlag>({
        evaluateGolden: (flag, defaultValue) => providerEvaluation(provider, flag, defaultValue),
        readDurableGolden: async () => undefined,
        getDefault: (flag) => defaults[flag],
        reportDecision: (observation) => decisions.push(observation),
      })

      expect(await isEnabled('checkout.stripe_enabled')).toBe(true)
      expect(await isEnabled('domain.paywall_enabled')).toBe(false)
      // An unhealthy provider is never reported as Golden deciding.
      expect(decisions.every((d) => d.source === 'default')).toBe(true)
      provider.shutdown()
    })
  }
})

test.describe('flag decision observer', () => {
  test('writes once per snapshot/source/flag, so steady traffic adds nothing', () => {
    const written: FlagDecisionObservation[] = []
    const observe = createFlagDecisionObserver((observation) => written.push(observation))
    const golden = { flagKey: 'pdp_redesign', source: 'golden' as const, snapshotVersion: 44 }

    expect(observe(golden)).toBe(true)
    expect(observe(golden)).toBe(false)
    expect(observe({ ...golden, source: 'durable' })).toBe(true)
    expect(observe({ ...golden, snapshotVersion: 45 })).toBe(true)
    expect(written).toHaveLength(3)
  })

  test('is bounded — the oldest key is evicted past the cap', () => {
    const observe = createFlagDecisionObserver(() => undefined, 2)
    observe({ flagKey: 'a', source: 'golden' })
    observe({ flagKey: 'b', source: 'golden' })
    observe({ flagKey: 'c', source: 'golden' })
    expect(observe({ flagKey: 'a', source: 'golden' })).toBe(true)
  })
})

test.describe('durable mirror + provider plumbing', () => {
  test('uses only a valid matching-environment snapshot as the durable fallback', () => {
    const parsed = parseDurableGoldenSnapshot(snapshot, 'production')
    expect(parsed).toBeDefined()
    expect(evaluateDurableGoldenBooleanFlag(parsed!, 'checkout.stripe_enabled', true)).toMatchObject({
      value: false,
      snapshotVersion: 7,
      flagVersion: 3,
      reason: 'STATIC',
    })
    expect(parseDurableGoldenSnapshot(snapshot, 'preview')).toBeUndefined()
    expect(parseDurableGoldenSnapshot({ ...snapshot, snapshotVersion: -1 }, 'production')).toBeUndefined()
  })

  test('a durable mirror can move forward but never roll back or rewrite an equal version', () => {
    const older = { ...snapshot, snapshotVersion: 6 }
    const newer = { ...snapshot, snapshotVersion: 8 }
    const divergentEqual = { ...snapshot, flags: [] }

    expect(retainNewestGoldenSnapshot(snapshot, older)).toBe(snapshot)
    expect(retainNewestGoldenSnapshot(snapshot, divergentEqual)).toBe(snapshot)
    expect(retainNewestGoldenSnapshot(snapshot, newer)).toBe(newer)
    expect(retainNewestGoldenSnapshot(undefined, snapshot)).toBe(snapshot)
  })

  test('the environment must be explicit — never inferred', () => {
    expect(parseGoldenFlagEnvironment('production')).toBe('production')
    expect(parseGoldenFlagEnvironment('preview')).toBe('preview')
    for (const value of [undefined, '', 'Production', 'prod', 'staging'])
      expect(parseGoldenFlagEnvironment(value)).toBeUndefined()
  })

  test('request refresh gate is bounded, due-driven, and resettable', () => {
    let current = 1_000
    const gate = createFlagProviderRequestRefreshGate(60_000, () => current)

    expect(gate.takeIfDue()).toBe(false)
    gate.markAttempt()
    current += 59_999
    expect(gate.takeIfDue()).toBe(false)
    current += 1
    expect(gate.takeIfDue()).toBe(true)
    expect(gate.takeIfDue()).toBe(false)
    current += 60_000
    expect(gate.takeIfDue()).toBe(true)
    gate.reset()
    expect(gate.takeIfDue()).toBe(false)
  })
})

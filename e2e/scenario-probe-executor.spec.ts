import { expect, test } from '@playwright/test'
import type {
  ScenarioProvider,
  ScenarioProviderResolution,
  ScenarioSnapshot,
} from '@golden-frijoles/sdk'
import { executeScenarioProbe } from '../lib/scenario-probe-executor'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const LEASE_ID = '22222222-2222-4222-8222-222222222222'

function snapshot(): ScenarioSnapshot {
  return {
    contractVersion: 1,
    environment: 'production',
    revision: 7,
    generatedAt: '2026-07-29T20:00:00.000Z',
    scenarios: [
      {
        scenarioKey: 'miyagi_probe',
        scenarioVersion: 2,
        runId: RUN_ID,
        runRevision: 3,
        targetKey: 'miyagi.internal.probe',
        cohort: 'internal',
        startAt: '2026-07-29T19:59:00.000Z',
        expiresAt: '2026-07-29T20:01:00.000Z',
        limits: {
          requestCap: 3,
          concurrencyCap: 1,
          leaseTtlSeconds: 10,
        },
        guardrails: {
          abortAfterFailures: 1,
          maxErrorRateBasisPoints: 5_000,
        },
        flag: {
          key: 'resilience.miyagi_probe',
          definitionVersion: 4,
          definition: {
            valueType: 'json',
            description: 'Fixture.',
            defaultVariantKey: 'control',
            variants: [{ key: 'control', value: { kind: 'none' } }],
            rules: [],
          },
        },
      },
    ],
  }
}

function provider(
  resolution: ScenarioProviderResolution,
  overrides: Partial<ScenarioProvider> = {},
): ScenarioProvider {
  return {
    // Renamed by SDK 0.4.0 (D2). This is the PROVIDER's identity, not wire material —
    // unlike the `x-golden-beans-*` headers and signing envelopes, which are signed
    // and deliberately keep their original names (D3).
    metadata: { name: 'golden-frijoles-scenarios' },
    initialize: async () => ({
      ok: true,
      changed: false,
      notModified: true,
      revision: 7,
    }),
    refresh: async () => ({
      ok: true,
      changed: false,
      notModified: true,
      revision: 7,
    }),
    shutdown() {},
    getStatus: () => ({
      state: 'READY',
      revision: 7,
      environment: 'production',
    }),
    getSnapshot: snapshot,
    resolveScenario: () => resolution,
    reserveExecution: async () => ({
      ok: true,
      operation: 'reserve',
      leaseId: LEASE_ID,
      runRevision: 3,
      expiresAt: '2026-07-29T20:00:10.000Z',
      admitted: true,
      reason: 'ADMITTED',
    }),
    settleExecution: async () => ({
      ok: true,
      operation: 'settle',
      leaseId: LEASE_ID,
      runRevision: 3,
      runStatus: 'running',
      activeLeaseCount: 0,
      successCount: 1,
      failureCount: 0,
      settled: true,
      reason: 'SETTLED',
    }),
    ...overrides,
  }
}

test('no active scenario is a no-op and never asks for an execution lease', async () => {
  let reservations = 0
  const result = await executeScenarioProbe({
    provider: provider(
      { value: { kind: 'none' }, reason: 'PROVIDER_NOT_READY' },
      {
        getSnapshot: () => undefined,
        reserveExecution: async () => {
          reservations += 1
          throw new Error('must not reserve')
        },
      },
    ),
    now: () => 100,
  })
  expect(result).toEqual({
    status: 200,
    body: {
      ok: true,
      applied: 'none',
      reason: 'PROVIDER_NOT_READY',
      latencyMs: 0,
    },
  })
  expect(reservations).toBe(0)
})

test('a closed delay reserves globally, delays once, settles and builds canonical telemetry', async () => {
  let clock = 100
  const delays: number[] = []
  const settlements: Array<{
    runId: string
    leaseId: string
    succeeded: boolean
  }> = []
  const result = await executeScenarioProbe({
    provider: provider(
      {
        value: { kind: 'delay', delayMs: 25 },
        reason: 'MATCH',
        scenarioKey: 'miyagi_probe',
        scenarioVersion: 2,
        runId: RUN_ID,
        runRevision: 3,
        flagVersion: 4,
        variant: 'delay',
        cohort: 'internal',
      },
      {
        settleExecution: async (runId, leaseId, succeeded) => {
          settlements.push({ runId, leaseId, succeeded })
          return {
            ok: true,
            operation: 'settle',
            leaseId,
            runRevision: 3,
            runStatus: 'running',
            activeLeaseCount: 0,
            successCount: 1,
            failureCount: 0,
            settled: true,
            reason: 'SETTLED',
          }
        },
      },
    ),
    now: () => clock,
    delay: async (milliseconds) => {
      delays.push(milliseconds)
      clock += milliseconds
    },
  })

  expect(delays).toEqual([25])
  expect(settlements).toEqual([
    { runId: RUN_ID, leaseId: LEASE_ID, succeeded: true },
  ])
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({
    ok: true,
    applied: 'delay',
    latencyMs: 25,
    settlement: 'SETTLED',
  })
  expect(result.telemetry).toMatchObject({
    scenarioKey: 'miyagi_probe',
    runId: RUN_ID,
    targetKey: 'miyagi.internal.probe',
    leaseId: LEASE_ID,
    arm: 'fault',
    faultKind: 'delay',
    failed: false,
    subject: { type: 'synthetic_probe', id: 'miyagi-readiness' },
    flag: {
      key: 'resilience.miyagi_probe',
      definitionVersion: 4,
      variant: 'delay',
      snapshotVersion: 7,
    },
  })
})

test('an active control arm reserves and settles without applying a fault', async () => {
  let succeeded: boolean | undefined
  let delayCalls = 0
  const result = await executeScenarioProbe({
    provider: provider(
      {
        value: { kind: 'none' },
        reason: 'MATCH',
        scenarioKey: 'miyagi_probe',
        scenarioVersion: 2,
        runId: RUN_ID,
        runRevision: 3,
        flagVersion: 4,
        variant: 'control',
        cohort: 'internal',
      },
      {
        settleExecution: async (_runId, leaseId, outcome) => {
          succeeded = outcome
          return {
            ok: true,
            operation: 'settle',
            leaseId,
            runRevision: 3,
            runStatus: 'running',
            activeLeaseCount: 0,
            successCount: 1,
            failureCount: 0,
            settled: true,
            reason: 'SETTLED',
          }
        },
      },
    ),
    now: () => 100,
    delay: async () => {
      delayCalls += 1
    },
  })

  expect(delayCalls).toBe(0)
  expect(succeeded).toBe(true)
  expect(result).toMatchObject({
    status: 200,
    body: {
      ok: true,
      applied: 'none',
      reason: 'MATCH',
      settlement: 'SETTLED',
    },
    telemetry: {
      arm: 'control',
      faultKind: 'none',
      failed: false,
    },
  })
})

test('the allow-listed synthetic error settles as a failure and returns only its fixed code', async () => {
  let succeeded: boolean | undefined
  const result = await executeScenarioProbe({
    provider: provider(
      {
        value: { kind: 'synthetic_error', errorCode: 'GB_RESILIENCE_503' },
        reason: 'MATCH',
        scenarioKey: 'miyagi_probe',
        scenarioVersion: 2,
        runId: RUN_ID,
        runRevision: 3,
        flagVersion: 4,
        variant: 'synthetic_error',
        cohort: 'internal',
      },
      {
        settleExecution: async (_runId, leaseId, outcome) => {
          succeeded = outcome
          return {
            ok: true,
            operation: 'settle',
            leaseId,
            runRevision: 4,
            runStatus: 'aborted',
            activeLeaseCount: 0,
            successCount: 0,
            failureCount: 1,
            settled: true,
            reason: 'SETTLED',
          }
        },
      },
    ),
    now: () => 100,
  })
  expect(succeeded).toBe(false)
  expect(result.status).toBe(503)
  expect(result.body).toEqual({
    ok: false,
    applied: 'synthetic_error',
    reason: 'MATCH',
    latencyMs: 0,
    runId: RUN_ID,
    runRevision: 4,
    settlement: 'SETTLED',
    code: 'GB_RESILIENCE_503',
  })
  expect(result.telemetry?.failed).toBe(true)
})

test('an unexpected application failure still settles its lease as failed', async () => {
  let succeeded: boolean | undefined
  const result = await executeScenarioProbe({
    provider: provider(
      {
        value: { kind: 'delay', delayMs: 25 },
        reason: 'MATCH',
        scenarioKey: 'miyagi_probe',
        scenarioVersion: 2,
        runId: RUN_ID,
        runRevision: 3,
        flagVersion: 4,
        variant: 'delay',
        cohort: 'internal',
      },
      {
        settleExecution: async (_runId, leaseId, outcome) => {
          succeeded = outcome
          return {
            ok: true,
            operation: 'settle',
            leaseId,
            runRevision: 4,
            runStatus: 'aborted',
            activeLeaseCount: 0,
            successCount: 0,
            failureCount: 1,
            settled: true,
            reason: 'SETTLED',
          }
        },
      },
    ),
    now: () => 100,
    delay: async () => {
      throw new Error('injected application failure')
    },
  })

  expect(succeeded).toBe(false)
  expect(result).toMatchObject({
    status: 503,
    body: {
      ok: false,
      applied: 'delay',
      reason: 'APPLICATION_FAILED',
      runId: RUN_ID,
      runRevision: 4,
      settlement: 'SETTLED',
      code: 'GB_RESILIENCE_EXECUTION_FAILED',
    },
    telemetry: {
      failed: true,
    },
  })
})

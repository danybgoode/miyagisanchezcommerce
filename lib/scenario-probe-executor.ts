import type {
  ScenarioExecutionTelemetryInput,
  ScenarioProvider,
} from '@golden-frijoles/sdk'
import { MIYAGI_SCENARIO_TARGET_KEY } from '@/lib/scenario-target-contract'

const SUBJECT = {
  targetingKey: 'synthetic:miyagi-readiness',
  source: 'internal',
} as const
const TELEMETRY_SUBJECT = {
  type: 'synthetic_probe',
  id: 'miyagi-readiness',
} as const

export type ScenarioProbeResult = {
  status: 200 | 503
  body: {
    ok: boolean
    applied: 'none' | 'delay' | 'synthetic_error'
    reason: string
    latencyMs: number
    runId?: string
    runRevision?: number
    settlement?: string
    code?: 'GB_RESILIENCE_503' | 'GB_RESILIENCE_EXECUTION_FAILED'
  }
  telemetry?: ScenarioExecutionTelemetryInput
}

type ScenarioProbeDependencies = {
  provider: ScenarioProvider
  now?: () => number
  delay?: (milliseconds: number) => Promise<void>
}

function elapsedMilliseconds(now: () => number, startedAt: number): number {
  return Math.min(300_000, Math.max(0, Math.round(now() - startedAt)))
}

/**
 * The only Miyagi seam that can apply a resilience payload. Inputs are fixed here: no request
 * body, URL, header, query, target, subject or instruction can influence execution.
 */
export async function executeScenarioProbe({
  provider,
  now = Date.now,
  delay = (milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: ScenarioProbeDependencies): Promise<ScenarioProbeResult> {
  const startedAt = now()
  const snapshot = provider.getSnapshot()
  const resolution = provider.resolveScenario(
    MIYAGI_SCENARIO_TARGET_KEY,
    SUBJECT,
    startedAt,
  )
  if (
    !snapshot ||
    !('runId' in resolution) ||
    !resolution.runId ||
    !resolution.runRevision ||
    !resolution.scenarioKey ||
    !resolution.scenarioVersion ||
    !resolution.flagVersion ||
    !resolution.variant ||
    !resolution.cohort
  ) {
    return {
      status: 200,
      body: {
        ok: true,
        applied: 'none',
        reason: resolution.reason,
        latencyMs: elapsedMilliseconds(now, startedAt),
      },
    }
  }
  const entry = snapshot.scenarios.find(
    (candidate) =>
      candidate.runId === resolution.runId &&
      candidate.targetKey === MIYAGI_SCENARIO_TARGET_KEY,
  )
  if (!entry) {
    return {
      status: 200,
      body: {
        ok: true,
        applied: 'none',
        reason: 'SNAPSHOT_ENTRY_MISSING',
        latencyMs: elapsedMilliseconds(now, startedAt),
      },
    }
  }

  const reservation = await provider.reserveExecution(
    resolution.runId,
    resolution.runRevision,
  )
  if (!reservation.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        applied: 'none',
        reason: reservation.errorCode,
        latencyMs: elapsedMilliseconds(now, startedAt),
        runId: resolution.runId,
        runRevision: resolution.runRevision,
      },
    }
  }
  if (!reservation.admitted) {
    return {
      status: 200,
      body: {
        ok: true,
        applied: 'none',
        reason: reservation.reason,
        latencyMs: elapsedMilliseconds(now, startedAt),
        runId: resolution.runId,
        runRevision: reservation.runRevision,
      },
    }
  }

  let applicationFailed = resolution.value.kind === 'synthetic_error'
  if (resolution.value.kind === 'delay') {
    try {
      await delay(resolution.value.delayMs)
    } catch {
      applicationFailed = true
    }
  }
  const settlement = await provider.settleExecution(
    resolution.runId,
    reservation.leaseId,
    !applicationFailed,
  )
  const latencyMs = elapsedMilliseconds(now, startedAt)
  const telemetry: ScenarioExecutionTelemetryInput = {
    scenarioKey: resolution.scenarioKey,
    scenarioVersion: resolution.scenarioVersion,
    runId: resolution.runId,
    runRevision: resolution.runRevision,
    targetKey: MIYAGI_SCENARIO_TARGET_KEY,
    leaseId: reservation.leaseId,
    cohort: resolution.cohort,
    environment: snapshot.environment,
    arm: resolution.value.kind === 'none' ? 'control' : 'fault',
    faultKind: resolution.value.kind,
    failed: applicationFailed,
    latencyMs,
    subject: TELEMETRY_SUBJECT,
    flag: {
      key: entry.flag.key,
      definitionVersion: entry.flag.definitionVersion,
      variant: resolution.variant,
      reason: resolution.reason,
      snapshotVersion: snapshot.revision,
    },
    ...(entry.experiment ? { experiment: entry.experiment } : {}),
  }

  if (!settlement.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        applied: resolution.value.kind,
        reason: settlement.errorCode,
        latencyMs,
        runId: resolution.runId,
        runRevision: resolution.runRevision,
      },
      telemetry,
    }
  }
  if (applicationFailed && resolution.value.kind !== 'synthetic_error') {
    return {
      status: 503,
      body: {
        ok: false,
        applied: resolution.value.kind,
        reason: 'APPLICATION_FAILED',
        latencyMs,
        runId: resolution.runId,
        runRevision: settlement.runRevision,
        settlement: settlement.reason,
        code: 'GB_RESILIENCE_EXECUTION_FAILED',
      },
      telemetry,
    }
  }
  const syntheticError = resolution.value.kind === 'synthetic_error'
  return {
    status: syntheticError ? 503 : 200,
    body: {
      ok: !syntheticError,
      applied: resolution.value.kind,
      reason: resolution.reason,
      latencyMs,
      runId: resolution.runId,
      runRevision: settlement.runRevision,
      settlement: settlement.reason,
      ...(syntheticError ? { code: 'GB_RESILIENCE_503' as const } : {}),
    },
    telemetry,
  }
}

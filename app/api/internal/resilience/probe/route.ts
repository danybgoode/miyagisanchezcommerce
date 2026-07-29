import { after, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { getGoldenScenarioProvider } from '@/lib/golden-scenario-provider'
import { trackGoldenScenarioExecution } from '@/lib/growth-engine'
import { executeScenarioProbe } from '@/lib/scenario-probe-executor'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async () => {
  const provider = getGoldenScenarioProvider()
  if (!provider) {
    return NextResponse.json({
      ok: true,
      applied: 'none',
      reason: 'PROVIDER_NOT_CONFIGURED',
      latencyMs: 0,
    })
  }

  // This is a dedicated operator probe, not a commerce request path. Waiting for the provider's
  // bounded first refresh gives the first explicit invocation an honest result without adding
  // request-network evaluation to any real application feature.
  await provider.initialize()
  const result = await executeScenarioProbe({ provider })
  const telemetry = result.telemetry
  if (telemetry) {
    after(() => trackGoldenScenarioExecution(telemetry))
  }
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  })
})

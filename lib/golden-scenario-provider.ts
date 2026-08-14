import 'server-only'
import {
  createScenarioProvider,
  type ScenarioProvider,
} from '@golden-frijoles/sdk'
import { parseGoldenFlagEnvironment } from '@/lib/flag-provider-mode'

let provider: ScenarioProvider | undefined
let configuration: string | undefined

/**
 * The scenario transport shares the revocable project/environment `flag_read` credential, while
 * evaluation and fault selection stay synchronous and local inside the SDK.
 */
export function getGoldenScenarioProvider(): ScenarioProvider | undefined {
  const baseUrl = process.env.GROWTH_ENGINE_URL?.replace(/\/+$/, '')
  const flagReadKey = process.env.GOLDEN_BEANS_FLAG_READ_KEY
  const environment = parseGoldenFlagEnvironment(
    process.env.GOLDEN_BEANS_FLAG_ENVIRONMENT,
  )
  if (!baseUrl || !flagReadKey || !environment) {
    provider?.shutdown()
    provider = undefined
    configuration = undefined
    return undefined
  }

  const nextConfiguration = `${baseUrl}\u001f${flagReadKey}\u001f${environment}`
  if (provider && configuration !== nextConfiguration) {
    provider.shutdown()
    provider = undefined
  }
  if (!provider) {
    provider = createScenarioProvider({
      baseUrl,
      flagReadKey,
      environment,
      refreshIntervalMs: 15_000,
      maxStaleMs: 30_000,
      refreshTimeoutMs: 2_000,
      executionTimeoutMs: 2_000,
    })
    configuration = nextConfiguration
  }
  return provider
}

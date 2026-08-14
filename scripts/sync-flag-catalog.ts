import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createFlagDefinitionSyncClient } from '@golden-frijoles/sdk'
import { frontendGoldenFlagDefinitionEntries } from '../lib/golden-flag-definition-catalog'

export type FlagSyncConfig = {
  baseUrl: string
  flagSyncKey: string
}

type FlagSyncConfigResult = { ok: true; config: FlagSyncConfig } | { ok: false; error: string }
type FlagSyncEnvironment = Readonly<Record<string, string | undefined>>

/** Reads operator-only configuration without ever logging the credential. */
export function resolveFlagSyncConfig(env: FlagSyncEnvironment = process.env): FlagSyncConfigResult {
  const baseUrl = env.GROWTH_ENGINE_URL?.trim()
  if (!baseUrl) return { ok: false, error: 'GROWTH_ENGINE_URL is required' }
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, error: 'GROWTH_ENGINE_URL must use http or https' }
    }
  } catch {
    return { ok: false, error: 'GROWTH_ENGINE_URL must be a valid URL' }
  }

  const flagSyncKey = env.GOLDEN_BEANS_FLAG_SYNC_KEY?.trim()
  if (!flagSyncKey) return { ok: false, error: 'GOLDEN_BEANS_FLAG_SYNC_KEY is required' }
  return { ok: true, config: { baseUrl, flagSyncKey } }
}

export async function syncFlagCatalog(env: FlagSyncEnvironment = process.env): Promise<void> {
  const configured = resolveFlagSyncConfig(env)
  if (!configured.ok) throw new Error(configured.error)

  const result = await createFlagDefinitionSyncClient(configured.config).syncFlagDefinitions(
    frontendGoldenFlagDefinitionEntries(),
  )
  if (!result.ok) {
    const suffix = result.kind === 'http' ? ` (HTTP ${result.status})` : ''
    throw new Error(`Golden flag catalog sync failed${suffix}: ${result.error}`)
  }

  const created = result.entries.filter((entry) => entry.created).length
  const unchanged = result.entries.length - created
  console.log(`[flags:sync] synchronized ${result.entries.length} definitions (${created} created, ${unchanged} unchanged)`)
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1]
  return Boolean(invokedPath) && path.resolve(invokedPath) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  syncFlagCatalog().catch((error: unknown) => {
    console.error(error instanceof Error ? `[flags:sync] ${error.message}` : '[flags:sync] failed')
    process.exitCode = 1
  })
}

/**
 * lib/flags-mirror-view.ts
 *
 * Pure mapping from the runtime's Golden snapshot to the rows `/admin/flags` renders
 * (flag-provider-mandate S2.1). Free of `next/*`, `server-only` and React so the Playwright `api`
 * project can unit-test it with zero network.
 *
 * `/admin/flags` is a READ-ONLY MIRROR of Golden Frijoles: it shows what production is actually
 * serving, from the same credential and provider that make the runtime decisions, and it links
 * out to Golden's console — the only place a flag can be changed.
 */
import { evaluateFlag, type FlagSnapshot } from '@golden-frijoles/sdk'
import {
  FLAG_CATALOG,
  type FlagCriticality,
  type FlagPolarity,
} from './flag-catalog'

/** The one Golden project every Miyagi flag lives in, and where it is managed. */
export const GOLDEN_FLAG_PROJECT = 'miyagisanchez'
export const GOLDEN_FLAG_CONSOLE_URL = `https://goldenfrijoles.com/app/flags/${GOLDEN_FLAG_PROJECT}`

export type FlagView = {
  key: string
  /** `null` = unknown: Golden sent no metadata and this build's catalog does not know the flag. */
  polarity: FlagPolarity | null
  criticality: FlagCriticality | null
  enabled: boolean
  definitionVersion: number
  reason: string
  environment: string
  snapshotVersion: number
  /** Only used by the shared deterministic sort helper; the snapshot carries no per-flag time. */
  updated_at: string | null
  description: string
  /** In Golden's snapshot but not in this build's catalog — shown, never hidden. */
  unknownToCatalog: boolean
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * One row per boolean flag in the snapshot, valued exactly as the runtime values it: the SDK's own
 * `evaluateFlag` with an empty context, so the mirror cannot disagree with `isEnabled()`.
 * Polarity/criticality prefer Golden's metadata and fall back to the compiled catalog.
 */
export function mirrorRowsFromSnapshot(snapshot: FlagSnapshot): FlagView[] {
  const rows: FlagView[] = []
  for (const flag of snapshot.flags) {
    if (flag.definition.valueType !== 'boolean') continue
    const catalog = (FLAG_CATALOG as Record<string, (typeof FLAG_CATALOG)[keyof typeof FLAG_CATALOG]>)[flag.key]
    const details = evaluateFlag({
      flag,
      defaultValue: catalog?.default ?? false,
      expectedType: 'boolean',
    })
    const metadata = flag.definition.metadata as Record<string, unknown> | undefined
    const polarity = metadataString(metadata, 'polarity')
    const criticality = metadataString(metadata, 'criticality')
    rows.push({
      key: flag.key,
      // Never invent a classification: an operator reads polarity/criticality as risk information.
      polarity:
        polarity === 'killswitch' || polarity === 'enablement'
          ? polarity
          : (catalog?.polarity ?? null),
      criticality:
        criticality === 'low' || criticality === 'medium' || criticality === 'high'
          ? criticality
          : (catalog?.criticality ?? null),
      enabled: details.value === true,
      definitionVersion: flag.definitionVersion,
      reason: details.reason,
      environment: snapshot.environment,
      snapshotVersion: snapshot.snapshotVersion,
      updated_at: null,
      description: flag.definition.description ?? '',
      unknownToCatalog: !catalog,
    })
  }
  return rows
}

/** Catalog keys this build reads that Golden's snapshot does not define AS A BOOLEAN — each resolves
 *  to its compile default, so the page names them instead of letting them look absent-and-fine. A
 *  non-boolean definition counts as missing: `isEnabled()` cannot evaluate it either. */
export function catalogKeysMissingFromSnapshot(snapshot: FlagSnapshot): string[] {
  const present = new Set(
    snapshot.flags.filter((flag) => flag.definition.valueType === 'boolean').map((flag) => flag.key),
  )
  return Object.keys(FLAG_CATALOG).filter((key) => !present.has(key)).sort()
}

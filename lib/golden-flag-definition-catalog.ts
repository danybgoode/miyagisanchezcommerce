import type { FlagDefinition, FlagDefinitionSyncEntry } from '@golden-beans/sdk'
import { FLAG_CATALOG, FLAG_KEYS, type FlagKey } from './flag-catalog'

export const OWNED_SHOP_ONLY_DESCRIPTION =
  'Owned-shop-only buyability and publication controls. The capability is live by default; turning this flag OFF is the deliberate kill switch.'

function descriptionFor(key: FlagKey): string {
  return key === 'catalog.owned_shop_only_enabled'
    ? OWNED_SHOP_ONLY_DESCRIPTION
    : `Miyagi flag: ${key}.`
}

/**
 * Maps Miyagi's typed, frontend-owned inventory to Golden's immutable boolean
 * definition contract. This is deliberately pure: `flags:sync` is the only
 * caller allowed to send these definitions to Golden.
 */
export function goldenDefinitionFor(key: FlagKey): FlagDefinition {
  const entry = FLAG_CATALOG[key]
  return {
    valueType: 'boolean',
    description: descriptionFor(key),
    defaultVariantKey: entry.default ? 'on' : 'off',
    variants: [
      { key: 'off', value: false },
      { key: 'on', value: true },
    ],
    rules: [],
    metadata: {
      source: 'miyagi',
      polarity: entry.polarity,
      criticality: entry.criticality,
      enforcement: entry.enforcement,
    },
  }
}

/**
 * The frontend publishes frontend and shared definitions only. `ml.orders_enabled`
 * stays in the catalog for the complete admin inventory, but Medusa alone owns
 * its Golden definition.
 */
export function frontendGoldenFlagDefinitionEntries(): FlagDefinitionSyncEntry[] {
  return FLAG_KEYS
    .filter((key) => FLAG_CATALOG[key].enforcement !== 'backend')
    .sort()
    .map((key) => ({ key, definition: goldenDefinitionFor(key) }))
}

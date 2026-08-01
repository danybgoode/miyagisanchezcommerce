import { expect, test } from '@playwright/test'
import { FLAG_CATALOG, FLAG_KEYS } from '../lib/flag-catalog'
import {
  frontendGoldenFlagDefinitionEntries,
  goldenDefinitionFor,
  OWNED_SHOP_ONLY_DESCRIPTION,
} from '../lib/golden-flag-definition-catalog'
import { resolveFlagSyncConfig } from '../scripts/sync-flag-catalog'

test('frontend publishes its deterministic 40-definition fragment and omits backend-only orders', () => {
  const entries = frontendGoldenFlagDefinitionEntries()

  expect(entries).toHaveLength(40)
  expect(entries.map((entry) => entry.key)).toEqual([...entries.map((entry) => entry.key)].sort())
  expect(entries.map((entry) => entry.key)).not.toContain('ml.orders_enabled')
  expect(entries.map((entry) => entry.key)).toEqual(
    FLAG_KEYS.filter((key) => FLAG_CATALOG[key].enforcement !== 'backend').sort(),
  )
})

test('every frontend definition is a deterministic mapping of the typed catalog', () => {
  for (const key of FLAG_KEYS.filter((candidate) => FLAG_CATALOG[candidate].enforcement !== 'backend')) {
    const catalog = FLAG_CATALOG[key]
    expect(goldenDefinitionFor(key)).toEqual({
      valueType: 'boolean',
      description: key === 'catalog.owned_shop_only_enabled'
        ? OWNED_SHOP_ONLY_DESCRIPTION
        : `Miyagi flag: ${key}.`,
      defaultVariantKey: catalog.default ? 'on' : 'off',
      variants: [
        { key: 'off', value: false },
        { key: 'on', value: true },
      ],
      rules: [],
      metadata: {
        source: 'miyagi',
        polarity: catalog.polarity,
        criticality: catalog.criticality,
        enforcement: catalog.enforcement,
      },
    })
  }
})

test('owned-shop uses the shared live-by-default kill-switch definition', () => {
  expect(goldenDefinitionFor('catalog.owned_shop_only_enabled')).toEqual({
    valueType: 'boolean',
    description: 'Owned-shop-only buyability and publication controls. The capability is live by default; turning this flag OFF is the deliberate kill switch.',
    defaultVariantKey: 'on',
    variants: [
      { key: 'off', value: false },
      { key: 'on', value: true },
    ],
    rules: [],
    metadata: {
      source: 'miyagi',
      polarity: 'killswitch',
      criticality: 'high',
      enforcement: 'both',
    },
  })
})

test('sync command requires its dedicated operator credential', () => {
  expect(resolveFlagSyncConfig({})).toEqual({ ok: false, error: 'GROWTH_ENGINE_URL is required' })
  expect(resolveFlagSyncConfig({ GROWTH_ENGINE_URL: 'https://golden.example' })).toEqual({
    ok: false,
    error: 'GOLDEN_BEANS_FLAG_SYNC_KEY is required',
  })
  expect(resolveFlagSyncConfig({
    GROWTH_ENGINE_URL: 'https://golden.example/',
    GOLDEN_BEANS_FLAG_SYNC_KEY: 'operator-only-test-key',
  })).toEqual({
    ok: true,
    config: {
      baseUrl: 'https://golden.example/',
      flagSyncKey: 'operator-only-test-key',
    },
  })
})

import { expect, test } from '@playwright/test'
import type { FlagSnapshot } from '@golden-frijoles/sdk'
import {
  GOLDEN_FLAG_CONSOLE_URL,
  catalogKeysMissingFromSnapshot,
  mirrorRowsFromSnapshot,
} from '../lib/flags-mirror-view'
import { FLAG_KEYS } from '../lib/flag-catalog'

/**
 * flag-provider-mandate S2.1 — `/admin/flags` is a read-only mirror of the snapshot the runtime
 * serves. These pin that the row VALUE is the SDK's own evaluation (so the mirror cannot disagree
 * with `isEnabled()`), and that a catalog flag Golden does not define is NAMED, never silently
 * missing.
 */

function booleanFlag(key: string, defaultVariantKey: 'on' | 'off', metadata?: Record<string, string>) {
  return {
    key,
    definitionVersion: 2,
    definition: {
      valueType: 'boolean' as const,
      description: `${key} fixture`,
      defaultVariantKey,
      variants: [
        { key: 'off', value: false },
        { key: 'on', value: true },
      ],
      rules: [],
      ...(metadata ? { metadata } : {}),
    },
  }
}

const snapshot = {
  contractVersion: 1,
  environment: 'production',
  snapshotVersion: 44,
  flags: [
    booleanFlag('checkout.stripe_enabled', 'on', { polarity: 'killswitch', criticality: 'high' }),
    // No metadata: polarity/criticality must come from the compiled catalog.
    booleanFlag('shipping.envia_enabled', 'off'),
    booleanFlag('golden.only_flag', 'on'),
    // A catalog key Golden defines as a NON-boolean: isEnabled() cannot evaluate it.
    {
      key: 'pdp_redesign',
      definitionVersion: 1,
      definition: {
        valueType: 'string' as const,
        description: 'wrong type',
        defaultVariantKey: 'a',
        variants: [{ key: 'a', value: 'x' }],
        rules: [],
      },
    },
  ],
} satisfies FlagSnapshot

test.describe('flags mirror view (pure)', () => {
  test('values each row exactly as the runtime does — the served variant, not a guess', () => {
    const rows = mirrorRowsFromSnapshot(snapshot)
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
    expect(byKey['checkout.stripe_enabled']).toMatchObject({
      enabled: true,
      polarity: 'killswitch',
      criticality: 'high',
      definitionVersion: 2,
      snapshotVersion: 44,
      environment: 'production',
      unknownToCatalog: false,
    })
    expect(byKey['shipping.envia_enabled']).toMatchObject({
      enabled: false,
      polarity: 'enablement',
      unknownToCatalog: false,
    })
  })

  test('a flag Golden defines but this build does not read is shown and marked, not dropped', () => {
    const row = mirrorRowsFromSnapshot(snapshot).find((r) => r.key === 'golden.only_flag')
    // No metadata and not in the catalog: the classification is UNKNOWN, never invented.
    expect(row).toMatchObject({ enabled: true, unknownToCatalog: true, polarity: null, criticality: null })
  })

  test('catalog flags missing from Golden are named — they are running on compile defaults', () => {
    const missing = catalogKeysMissingFromSnapshot(snapshot)
    expect(missing).not.toContain('checkout.stripe_enabled')
    // Defined, but not as a boolean — still missing for isEnabled(), so still named.
    expect(missing).toContain('pdp_redesign')
    expect(missing).toHaveLength(FLAG_KEYS.length - 2)
    expect(mirrorRowsFromSnapshot(snapshot).some((r) => r.key === 'pdp_redesign')).toBe(false)
  })

  test('the console link points at the one project that decides', () => {
    expect(GOLDEN_FLAG_CONSOLE_URL).toBe('https://goldenfrijoles.com/app/flags/miyagisanchez')
  })
})

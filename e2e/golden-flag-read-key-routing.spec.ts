import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FLAG_KEYS } from '../lib/flag-catalog'
import {
  PARTNERS_RECRUITING_V3_FLAG_KEY,
  routeGoldenFlagReadKey,
} from '../lib/golden-flag-read-key-routing'
import { durableMirrorStorageForSlot } from '../lib/golden-flag-mirror-scope'
import { evaluateDurableGoldenBooleanFlag } from '../lib/golden-flag-mirror'
import type { FlagSnapshot } from '@golden-frijoles/sdk'

const ROOT = process.cwd()

test.describe('Golden read-key routing', () => {
  test('the recruiting-v3 flag alone uses its owner-visible project credential', () => {
    expect(routeGoldenFlagReadKey(PARTNERS_RECRUITING_V3_FLAG_KEY, {
      GOLDEN_BEANS_FLAG_READ_KEY: ' legacy-read ',
      GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: ' owner-read ',
    })).toEqual({
      flagReadKey: 'owner-read',
      providerSlot: 'partners-recruiting-v3',
      resetScopedProvider: false,
    })
  })

  test('every existing flag keeps the established production catalog', () => {
    const existingKeys = FLAG_KEYS.filter(
      (key) => key !== PARTNERS_RECRUITING_V3_FLAG_KEY,
    )

    for (const flagKey of existingKeys) {
      expect(routeGoldenFlagReadKey(flagKey, {
        GOLDEN_BEANS_FLAG_READ_KEY: 'legacy-read',
        GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: 'owner-read',
      }), flagKey).toEqual({
        flagReadKey: 'legacy-read',
        providerSlot: 'primary',
        resetScopedProvider: false,
      })
    }
  })

  test('removing the scoped credential requests cleanup on primary traffic too', () => {
    expect(routeGoldenFlagReadKey('checkout.stripe_enabled', {
      GOLDEN_BEANS_FLAG_READ_KEY: 'legacy-read',
    })).toEqual({
      flagReadKey: 'legacy-read',
      providerSlot: 'primary',
      resetScopedProvider: true,
    })
  })

  test('an absent or blank scoped credential preserves the primary fallback', () => {
    for (const scoped of [undefined, '', '   ']) {
      expect(routeGoldenFlagReadKey(PARTNERS_RECRUITING_V3_FLAG_KEY, {
        GOLDEN_BEANS_FLAG_READ_KEY: 'legacy-read',
        GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: scoped,
      })).toEqual({
        flagReadKey: 'legacy-read',
        providerSlot: 'primary',
        resetScopedProvider: true,
      })
    }
  })

  test('the scoped project can serve recruiting even when the primary is unavailable', () => {
    expect(routeGoldenFlagReadKey(PARTNERS_RECRUITING_V3_FLAG_KEY, {
      GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: 'owner-read',
    })).toEqual({
      flagReadKey: 'owner-read',
      providerSlot: 'partners-recruiting-v3',
      resetScopedProvider: false,
    })
  })

  test('each provider slot owns an independently versioned durable mirror lane', () => {
    expect(durableMirrorStorageForSlot('primary')).toEqual({
      table: 'golden_flag_snapshot_mirror',
      rpc: 'persist_golden_flag_snapshot',
    })
    expect(durableMirrorStorageForSlot('partners-recruiting-v3')).toEqual({
      table: 'golden_flag_scoped_snapshot_mirror',
      rpc: 'persist_scoped_golden_flag_snapshot',
      providerScope: 'partners-recruiting-v3',
    })
  })

  test('cold recruiting resolution uses its scoped durable snapshot, never the primary catalog', () => {
    const primarySnapshot = {
      contractVersion: 1,
      environment: 'production',
      snapshotVersion: 47,
      flags: [],
    } satisfies FlagSnapshot
    const recruitingSnapshot = {
      contractVersion: 1,
      environment: 'production',
      snapshotVersion: 4,
      flags: [{
        key: PARTNERS_RECRUITING_V3_FLAG_KEY,
        definitionVersion: 2,
        definition: {
          valueType: 'boolean',
          description: 'Founding operator recruiting.',
          defaultVariantKey: 'on',
          variants: [
            { key: 'off', value: false },
            { key: 'on', value: true },
          ],
          rules: [],
        },
      }],
    } satisfies FlagSnapshot

    const route = routeGoldenFlagReadKey(PARTNERS_RECRUITING_V3_FLAG_KEY, {
      GOLDEN_BEANS_FLAG_READ_KEY: 'legacy-read',
      GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: 'owner-read',
    })
    const storage = durableMirrorStorageForSlot(route.providerSlot)
    const selectedSnapshot = 'providerScope' in storage &&
      storage.providerScope === 'partners-recruiting-v3'
      ? recruitingSnapshot
      : primarySnapshot

    expect(evaluateDurableGoldenBooleanFlag(
      primarySnapshot,
      PARTNERS_RECRUITING_V3_FLAG_KEY,
      false,
    ).value).toBe(false)
    expect(evaluateDurableGoldenBooleanFlag(
      selectedSnapshot,
      PARTNERS_RECRUITING_V3_FLAG_KEY,
      false,
    ).value).toBe(true)
  })

  test('the scoped mirror migration is monotonic and service-role-only', () => {
    const sql = fs.readFileSync(
      path.join(
        ROOT,
        'supabase/migrations/20260817150000_partners_recruiting_scoped_flag_mirror.sql',
      ),
      'utf8',
    )
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS golden_flag_scoped_snapshot_mirror')
    expect(sql).toContain('PRIMARY KEY (provider_scope, environment)')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION persist_scoped_golden_flag_snapshot')
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('golden_flag_scoped_snapshot_mirror:'")
    expect(sql).toContain('IF p_snapshot_version > current_row.snapshot_version THEN')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('REVOKE ALL ON TABLE golden_flag_scoped_snapshot_mirror FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION persist_scoped_golden_flag_snapshot(TEXT, TEXT, BIGINT, JSONB) TO service_role')
  })
})

import { expect, test } from '@playwright/test'
import { classifyOverrideStoreError, OVERRIDE_STORE_UNAVAILABLE_MESSAGE } from '../lib/copy-overrides-errors'

// Pure-seam coverage for the copy-overrides store error classifier (epic 08 ·
// cms-contenido-restore-and-polish, Story 1.2). No browser, no network — proves
// the exact ambiguity that hid the Story 1.1 gap (a missing table returning the
// same generic 500 as any other failure) can never recur silently.

test.describe('classifyOverrideStoreError · store-unavailable detection', () => {
  test('Postgres undefined_table (42P01) classifies as store_unavailable', () => {
    expect(classifyOverrideStoreError({ code: '42P01', message: 'relation "platform_copy_overrides" does not exist' })).toBe(
      'store_unavailable',
    )
  })

  test('PostgREST schema-cache miss (PGRST205) classifies as store_unavailable', () => {
    expect(
      classifyOverrideStoreError({ code: 'PGRST205', message: "Could not find the table 'public.platform_copy_overrides' in the schema cache" }),
    ).toBe('store_unavailable')
  })

  test('PostgREST schema-not-exposed (PGRST106) classifies as store_unavailable', () => {
    expect(classifyOverrideStoreError({ code: 'PGRST106', message: 'The schema must be one of the following' })).toBe(
      'store_unavailable',
    )
  })

  test('a "relation ... does not exist" message classifies as store_unavailable even with an unrecognized code', () => {
    expect(classifyOverrideStoreError({ code: 'XX000', message: 'relation "public.platform_copy_overrides" does not exist' })).toBe(
      'store_unavailable',
    )
  })

  test('an unrelated Postgres error (e.g. a constraint violation) classifies as unknown', () => {
    expect(classifyOverrideStoreError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe('unknown')
  })

  test('non-object, null, and undefined inputs all classify as unknown — never throws', () => {
    expect(classifyOverrideStoreError(null)).toBe('unknown')
    expect(classifyOverrideStoreError(undefined)).toBe('unknown')
    expect(classifyOverrideStoreError('a plain string error')).toBe('unknown')
    expect(classifyOverrideStoreError({})).toBe('unknown')
  })

  test('the actionable message is es-MX and distinct from the generic save/restore/read errors', () => {
    expect(OVERRIDE_STORE_UNAVAILABLE_MESSAGE).toBe('El almacén de overrides no está disponible.')
    expect(OVERRIDE_STORE_UNAVAILABLE_MESSAGE).not.toBe('No se pudo guardar el override.')
  })
})

import { expect, test } from '@playwright/test'
import { parseCopyOverrideWriteBody, parseCopyOverrideDeleteBody } from '../lib/copy-overrides-admin'

/**
 * Pure-seam coverage for the admin copy-override write surface (epic 08 ·
 * admin-content-and-announcements, Sprint 1). No browser, no network — proves
 * the validation `POST/DELETE /api/admin/content-overrides` compose. The authed
 * 200-upsert path runs anonymous in the `api` project (→ 401), so THIS is where
 * the reject-unknown-key / reject-non-bilingual-en logic is actually asserted;
 * `admin-content-overrides-api.spec.ts` covers only the 401 gate.
 */

const KNOWN_PATHS = new Set([
  'sellerAcquisition.anchor.heroTitle',
  'sellerAcquisition.anchor.heroStats.0.value',
  'terms.title',
  'terms.sections.0.body',
])

test.describe('copy-overrides-admin · parseCopyOverrideWriteBody', () => {
  test('accepts a valid write for an es-only namespace at the es locale', () => {
    expect(parseCopyOverrideWriteBody(
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'Nuevo título' },
      KNOWN_PATHS,
    )).toEqual({ ok: true, namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'Nuevo título' })
  })

  test('accepts an en write on a bilingual-allow-listed namespace', () => {
    const r = parseCopyOverrideWriteBody(
      { namespace: 'terms', key: 'title', locale: 'en', value: 'Terms of use' },
      KNOWN_PATHS,
    )
    expect(r.ok).toBe(true)
  })

  test('accepts an array-index key path', () => {
    const r = parseCopyOverrideWriteBody(
      { namespace: 'sellerAcquisition', key: 'anchor.heroStats.0.value', locale: 'es', value: '10%' },
      KNOWN_PATHS,
    )
    expect(r.ok).toBe(true)
  })

  test('rejects an en write on a non-allow-listed namespace (AGENTS rule #5)', () => {
    const r = parseCopyOverrideWriteBody(
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'en', value: 'Sell anything' },
      KNOWN_PATHS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Este namespace no admite inglés.')
  })

  test('rejects an unknown namespace.key — the dictionary defines the universe', () => {
    const r = parseCopyOverrideWriteBody(
      { namespace: 'sellerAcquisition', key: 'anchor.doesNotExist', locale: 'es', value: 'x' },
      KNOWN_PATHS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Esa clave no existe en el diccionario.')
  })

  test('rejects an invalid locale', () => {
    const r = parseCopyOverrideWriteBody(
      { namespace: 'terms', key: 'title', locale: 'fr', value: 'x' },
      KNOWN_PATHS,
    )
    expect(r.ok).toBe(false)
  })

  test('rejects a non-string value (no coercion — a mutation rejects)', () => {
    for (const value of [42, null, undefined, true, {}] as const) {
      const r = parseCopyOverrideWriteBody({ namespace: 'terms', key: 'title', locale: 'es', value }, KNOWN_PATHS)
      expect(r.ok, String(value)).toBe(false)
    }
  })

  test('rejects missing fields / non-object bodies', () => {
    for (const body of [null, undefined, 42, 'x', [], {}, { namespace: 'terms' }] as const) {
      expect(parseCopyOverrideWriteBody(body, KNOWN_PATHS).ok, JSON.stringify(body)).toBe(false)
    }
  })
})

test.describe('copy-overrides-admin · parseCopyOverrideDeleteBody', () => {
  test('accepts a valid delete body', () => {
    expect(parseCopyOverrideDeleteBody({ namespace: 'terms', key: 'title', locale: 'es' })).toEqual({
      ok: true,
      namespace: 'terms',
      key: 'title',
      locale: 'es',
    })
  })

  test('accepts a delete for a key NOT in the dictionary (restoring an orphan must stay possible)', () => {
    const r = parseCopyOverrideDeleteBody({ namespace: 'sellerAcquisition', key: 'anchor.longGoneField', locale: 'es' })
    expect(r.ok).toBe(true)
  })

  test('rejects missing fields / non-object bodies', () => {
    for (const body of [null, undefined, 42, 'x', [], {}, { namespace: 'terms' }] as const) {
      expect(parseCopyOverrideDeleteBody(body).ok, JSON.stringify(body)).toBe(false)
    }
  })
})

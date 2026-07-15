import { expect, test } from '@playwright/test'
import { getAtPath, setAtPath, flattenNamespace, flattenDictionary } from '../lib/copy-tree'
import { applyCopyOverrides, resolveOverriddenDictionary, type OverrideRow } from '../lib/copy-overrides-merge'
import esDictionary from '../locales/es.json' with { type: 'json' }

// Pure-seam coverage for the runtime copy-override reader (epic 08 ·
// admin-content-and-announcements). No browser, no network — proves the
// FAIL-OPEN merge decision `lib/copy-overrides.ts` composes, mirroring how
// `flags-cache.spec.ts` covers `lib/flags.ts`'s fail-open decision.

const anchor = {
  heroTitle: 'Vende lo que sea en México. 0% de comisión.',
  heroStats: [
    { value: '0%', label: 'comisión de plataforma' },
    { value: '20 s', label: 'para registrarte con Google' },
  ],
}

const dict = {
  sellerAcquisition: { anchor },
  terms: {
    title: 'Terminos de uso',
    sections: [{ title: 'Marketplace sin comisiones', body: 'texto original' }],
  },
}

test.describe('copy-tree · getAtPath / setAtPath', () => {
  test('reads a nested string leaf and an array-index leaf', () => {
    expect(getAtPath(dict.sellerAcquisition, 'anchor.heroTitle')).toBe(anchor.heroTitle)
    expect(getAtPath(dict.sellerAcquisition, 'anchor.heroStats.0.value')).toBe('0%')
  })

  test('returns undefined for an unknown or mismatched path', () => {
    expect(getAtPath(dict.sellerAcquisition, 'anchor.nope')).toBeUndefined()
    expect(getAtPath(dict.sellerAcquisition, 'anchor.heroStats.9.value')).toBeUndefined()
    expect(getAtPath(dict.sellerAcquisition, 'anchor.heroStats.0.nope')).toBeUndefined()
  })

  test('setAtPath immutably replaces a string leaf, including inside an array', () => {
    const next = setAtPath(anchor, 'heroTitle', 'Nuevo título')
    expect(next.heroTitle).toBe('Nuevo título')
    expect(anchor.heroTitle).toBe('Vende lo que sea en México. 0% de comisión.') // original untouched

    const nextArr = setAtPath(anchor, 'heroStats.0.value', '5%')
    expect(nextArr.heroStats[0].value).toBe('5%')
    expect(anchor.heroStats[0].value).toBe('0%') // original untouched
  })

  test('setAtPath is a no-op (same reference) on an unknown path or a non-string leaf', () => {
    expect(setAtPath(anchor, 'nope', 'x')).toBe(anchor)
    expect(setAtPath(anchor, 'heroStats', 'x')).toBe(anchor) // heroStats is an array, not a string
  })
})

test.describe('copy-tree · flattenNamespace / flattenDictionary', () => {
  test('flattens nested objects and arrays into dot-paths', () => {
    const flat = flattenNamespace('sellerAcquisition', dict.sellerAcquisition)
    const byKey = Object.fromEntries(flat.map((e) => [e.key, e.value]))
    expect(byKey['anchor.heroTitle']).toBe(anchor.heroTitle)
    expect(byKey['anchor.heroStats.0.value']).toBe('0%')
    expect(byKey['anchor.heroStats.1.label']).toBe('para registrarte con Google')
  })

  test('flattenDictionary covers every namespace', () => {
    const flat = flattenDictionary(dict)
    const namespaces = new Set(flat.map((e) => e.namespace))
    expect(namespaces).toEqual(new Set(['sellerAcquisition', 'terms']))
    expect(flat.find((e) => e.namespace === 'terms' && e.key === 'sections.0.title')?.value).toBe('Marketplace sin comisiones')
  })
})

test.describe('applyCopyOverrides · fail-open merge', () => {
  test('an override wins over the compile-time default', () => {
    const overrides: OverrideRow[] = [
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'Vende gratis, hoy.' },
    ]
    const result = applyCopyOverrides(dict, overrides, 'es')
    expect(result.sellerAcquisition.anchor.heroTitle).toBe('Vende gratis, hoy.')
    expect(dict.sellerAcquisition.anchor.heroTitle).toBe(anchor.heroTitle) // original untouched
  })

  test('an override applies inside an array leaf', () => {
    const overrides: OverrideRow[] = [
      { namespace: 'sellerAcquisition', key: 'anchor.heroStats.0.value', locale: 'es', value: '10%' },
    ]
    const result = applyCopyOverrides(dict, overrides, 'es')
    expect(result.sellerAcquisition.anchor.heroStats[0].value).toBe('10%')
    expect(result.sellerAcquisition.anchor.heroStats[1].value).toBe('20 s') // untouched sibling
  })

  test('falls back to the compile-time value on an unknown namespace or key', () => {
    const overrides: OverrideRow[] = [
      { namespace: 'doesNotExist', key: 'x', locale: 'es', value: 'y' },
      { namespace: 'sellerAcquisition', key: 'anchor.doesNotExist', locale: 'es', value: 'y' },
    ]
    const result = applyCopyOverrides(dict, overrides, 'es')
    expect(result).toEqual(dict)
  })

  test('locale handling — an override for a different locale never applies', () => {
    const overrides: OverrideRow[] = [
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'en', value: 'Sell anything.' },
    ]
    const result = applyCopyOverrides(dict, overrides, 'es')
    expect(result.sellerAcquisition.anchor.heroTitle).toBe(anchor.heroTitle)
  })

  test('empty overrides is a true no-op (same values, no unnecessary clone churn on unaffected namespaces)', () => {
    const result = applyCopyOverrides(dict, [], 'es')
    expect(result).toEqual(dict)
    expect(result.terms).toBe(dict.terms) // untouched namespace keeps its reference
  })
})

test.describe('resolveOverriddenDictionary · injectable-deps core (flag-OFF / no-overrides fallback)', () => {
  test('flag OFF returns the compile-time dictionary unchanged and never reads overrides', async () => {
    let overridesCalled = false
    const result = await resolveOverriddenDictionary(
      {
        isEnabled: async () => false,
        getOverrides: async () => {
          overridesCalled = true
          return [{ namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'nunca visible' }]
        },
        getDictionary: async () => dict as never,
      },
      'es',
    )
    expect(result).toBe(dict)
    expect(overridesCalled).toBe(false)
  })

  test('flag ON but no overrides (Supabase down, table empty, or nothing edited) returns the dictionary unchanged', async () => {
    const result = await resolveOverriddenDictionary(
      {
        isEnabled: async () => true,
        getOverrides: async () => [], // getOverrides() itself never throws — this is its fail-open shape
        getDictionary: async () => dict as never,
      },
      'es',
    )
    expect(result).toBe(dict)
  })

  test('flag ON with a real override applies it', async () => {
    const result = await resolveOverriddenDictionary(
      {
        isEnabled: async () => true,
        getOverrides: async () => [
          { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'Editado en vivo' },
        ],
        getDictionary: async () => dict as never,
      },
      'es',
    )
    expect((result as typeof dict).sellerAcquisition.anchor.heroTitle).toBe('Editado en vivo')
  })

  // admin-content-and-announcements S2.2 — proves a `home.*` override renders, against the
  // REAL compiled dictionary (not a synthetic fixture like `dict` above), so this fails loud
  // if the `home` namespace is ever renamed/restructured without updating the homepage's
  // `getOverriddenDictionary('es').home` read (app/(site)/page.tsx).
  test('a home.* override applies against the real dictionary, unaffected namespaces untouched', async () => {
    const result = await resolveOverriddenDictionary(
      {
        isEnabled: async () => true,
        getOverrides: async () => [
          { namespace: 'home', key: 'hero.heading', locale: 'es', value: 'Promoción de temporada — envíos gratis.' },
        ],
        getDictionary: async () => esDictionary as never,
      },
      'es',
    )
    const home = (result as typeof esDictionary).home
    expect(home.hero.heading).toBe('Promoción de temporada — envíos gratis.')
    expect(home.hero.badges).toEqual(esDictionary.home.hero.badges) // sibling key unaffected
    expect(home.selection.heading).toBe(esDictionary.home.selection.heading) // sibling section unaffected
  })
})
